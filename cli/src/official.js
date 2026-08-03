/**
 * Official conversion pipeline — pure Node, NO playwright / NO browser.
 *
 * The EXACT same code path the frontend AI Text-to-Diagram uses:
 *
 *   1. jsdom simulates a DOM (mermaid render needs one) → official npm package
 *      @excalidraw/mermaid-to-excalidraw@2.2.2 parseMermaidToExcalidraw
 *      (it runs the real mermaid render + reads node coords/sizes from the SVG)
 *   2. @excalidraw/element@0.18.0 (same version as the frontend)
 *      convertToExcalidrawElements → full native elements
 *
 * Everything (fonts, bindings, fill, z-order, wrapping) is decided by the
 * official library — output is what the frontend produces.
 *
 * The only environment shims: jsdom globals + an SVGElement.getBBox estimate
 * (jsdom doesn't implement it). This is measurement-only, same spirit as the
 * official setCustomTextMetricsProvider escape hatch.
 */
"use strict";

let domReady = false;

/** Install browser-ish globals via jsdom, once. */
function ensureDom() {
  if (domReady) return;
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  // Node 21+ has a built-in read-only globalThis.navigator — keep it
  if (!globalThis.navigator) {
    globalThis.navigator = dom.window.navigator;
  }
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.SVGElement = dom.window.SVGElement;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.requestAnimationFrame =
    dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame || clearTimeout;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSSStyleSheet =
    dom.window.CSSStyleSheet ||
    class CSSStyleSheet {
      constructor() {
        this.cssRules = [];
      }
      insertRule(rule, index = 0) {
        this.cssRules.splice(index, 0, rule);
        return index;
      }
      deleteRule(index) {
        this.cssRules.splice(index, 1);
      }
      replaceSync(text) {
        this.cssRules = text ? [text] : [];
      }
      replace() {
        return Promise.resolve(this);
      }
    };
  globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
  globalThis.atob = (s) => Buffer.from(s, "base64").toString("binary");

  // jsdom does not implement getBBox (mermaid measures shapes/text with it).
  // Simulate the union-bbox semantics: text nodes are measured with REAL font
  // metrics (opentype.js reading the same system font the browser renders),
  // shape nodes use their width/height attributes, groups union their
  // children. Measurement only — layout stays 100% official mermaid.
  //
  // Why real metrics instead of a ~0.5em heuristic: Trebuchet MS advance
  // widths vary wildly ('W'=0.85em, 'i'=0.29em) — a flat coefficient is only
  // right on average and drifts on real words. Reading the font's hmtx table
  // gives the exact values the browser's getBBox uses.
  const fs = require("fs");
  const path = require("path");
  let metricsFont = undefined; // undefined = not tried yet, null = unavailable
  function loadMetricsFont() {
    if (metricsFont !== undefined) return metricsFont;
    const candidates = [
      // macOS — mermaid's default font stack starts with "trebuchet ms"
      "/System/Library/Fonts/Supplemental/Trebuchet MS.ttf",
      "/Library/Fonts/Trebuchet MS.ttf",
      "/System/Library/Fonts/Supplemental/Arial.ttf",
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const opentype = require("opentype.js");
          metricsFont = opentype.parse(fs.readFileSync(p));
          return metricsFont;
        }
      } catch {}
    }
    metricsFont = null;
    return null;
  }
  const charWidth = (ch, size) => {
    const c = ch.charCodeAt(0);
    if (c === 0x20 || c === 0xa0) return size * 0.3; // space
    if (c > 0x2e80) return size; // CJK full-width (Trebuchet has no CJK glyphs; browsers fall back to a square CJK face)
    const font = loadMetricsFont();
    if (font) {
      const adv = font.getAdvanceWidth(ch, size);
      if (adv > 0) return adv; // real hmtx advance for the rendered font
    }
    return size * 0.5; // fallback heuristic when no system font found
  };
  const measureTextWidth = (text, size) => {
    let w = 0;
    for (const ch of text) w += charWidth(ch, size);
    return Math.max(w, 4);
  };
  const fontSizeOf = (el) => {
    let size = 20; // m2e DEFAULT_FONT_SIZE
    let node = el;
    while (node && node.getAttribute) {
      const inline = node.getAttribute && node.getAttribute("style");
      const m = inline && inline.match(/font-size:\s*([\d.]+)px/);
      if (m) return parseFloat(m[1]);
      const fs = node.getAttribute && node.getAttribute("font-size");
      const m2 = fs && fs.match(/([\d.]+)px?/);
      if (m2) return parseFloat(m2[1]);
      node = node.parentNode;
    }
    return size;
  };
  globalThis.SVGElement.prototype.getBBox =
    globalThis.SVGElement.prototype.getBBox ||
    function () {
      const size = fontSizeOf(this);
      // foreignObject wraps an HTML label (already accounted for in the
      // layout via getBoundingClientRect) — it has no SVG geometry.
      if (this.tagName === "foreignObject") {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      // shape with explicit dimensions (mermaid writes x/y/width/height)
      const wAttr = this.getAttribute && this.getAttribute("width");
      const hAttr = this.getAttribute && this.getAttribute("height");
      const xAttr = this.getAttribute && this.getAttribute("x");
      const yAttr = this.getAttribute && this.getAttribute("y");
      if (wAttr && hAttr && (this.tagName === "rect" || this.tagName === "ellipse" || this.tagName === "image")) {
        const w = parseFloat(wAttr) || 0;
        const h = parseFloat(hAttr) || 0;
        return { x: parseFloat(xAttr) || 0, y: parseFloat(yAttr) || 0, width: w, height: h };
      }
      // polygon (mermaid diamond/decision nodes) — derive bbox from points
      if (this.tagName === "polygon") {
        const pts = (this.getAttribute("points") || "")
          .trim()
          .split(/\s+/)
          .map((p) => p.split(",").map(parseFloat))
          .filter((p) => p.length === 2 && !isNaN(p[0]) && !isNaN(p[1]));
        if (pts.length) {
          const xs = pts.map((p) => p[0]);
          const ys = pts.map((p) => p[1]);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        }
      }
      // circle/ellipse without explicit width/height attrs (rare)
      if (this.tagName === "circle") {
        const r = parseFloat(this.getAttribute("r")) || 0;
        const cx = parseFloat(this.getAttribute("cx")) || 0;
        const cy = parseFloat(this.getAttribute("cy")) || 0;
        return { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r };
      }
      if (this.tagName === "text" || this.tagName === "tspan") {
        const w = measureTextWidth(this.textContent || "", size);
        const h = size * 1.25;
        // SVG-mode labels position text via transform translate or x/y attrs;
        // without this the bbox sits at 0,0 and inflates the group union.
        let tx = 0;
        let ty = 0;
        const tr = (this.getAttribute && this.getAttribute("transform")) || "";
        const m = tr.match(/translate\(\s*([-\d.]+)[,\s]\s*([-\d.]+)\s*\)/);
        if (m) {
          tx = parseFloat(m[1]);
          ty = parseFloat(m[2]);
        } else {
          const xa = this.getAttribute && this.getAttribute("x");
          const ya = this.getAttribute && this.getAttribute("y");
          tx = xa ? parseFloat(xa) : 0;
          ty = ya ? parseFloat(ya) - h : 0;
        }
        return { x: tx, y: ty, width: w, height: h };
      }
      // group (g) or anything else: union of children bboxes.
      // htmlLabels mode: label divs are measured via getBoundingClientRect
      // (foreignObject bbox is 0 here), SVG-mode labels are <text> with
      // transform offsets — both contribute correctly through their children.
      let minX = 0, minY = 0, maxX = 0, maxY = 0;
      let first = true;
      const kids = this.children ? [...this.children] : [];
      for (const kid of kids) {
        const b = kid.getBBox ? kid.getBBox() : null;
        if (!b || (b.width === 0 && b.height === 0 && b.x === 0 && b.y === 0)) continue;
        const x0 = b.x, y0 = b.y, x1 = b.x + b.width, y1 = b.y + b.height;
        if (first) { minX = x0; minY = y0; maxX = x1; maxY = y1; first = false; }
        else { minX = Math.min(minX, x0); minY = Math.min(minY, y0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1); }
      }
      if (first) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    };
  globalThis.SVGElement.prototype.getScreenCTM =
    globalThis.SVGElement.prototype.getScreenCTM || function () {
      return null;
    };
  globalThis.SVGElement.prototype.getTotalLength =
    globalThis.SVGElement.prototype.getTotalLength || function () {
      return 0;
    };

  // Some mermaid renderers (class diagram etc.) call getBBox on what turns out
  // to be an HTML/XHTML label element or even a Text node — browsers have no
  // getBBox there either, but jsdom layout differs enough that the code path
  // is reached. Give every Node the same text-based estimate so rendering
  // doesn't throw. (SVGElement has its own richer implementation above — this
  // is the fallback for HTML, foreignObject-inner elements and text nodes.)
  dom.window.Node.prototype.getBBox = function () {
    const text = (this.textContent || "").trim();
    if (text) {
      const size = fontSizeOf(this);
      return {
        x: 0,
        y: 0,
        width: measureTextWidth(text, size),
        height: size * 1.25,
      };
    }
    return { x: 0, y: 0, width: 0, height: 0 };
  };

  // mermaid's splitText (line wrapping) measures words with
  // SVGTextElement.getComputedTextLength — jsdom stubs it to 0, so every word
  // "fits" and long labels never wrap (nodes come out unnaturally wide).
  // Must patch the jsdom window prototype (mermaid uses window-created nodes).
  if (dom.window.SVGTextElement) {
    dom.window.SVGTextElement.prototype.getComputedTextLength = function () {
      return measureTextWidth(this.textContent || "", fontSizeOf(this));
    };
  }

  // mermaid's splitText (line wrapping) measures text with a canvas 2d
  // context.measureText — jsdom returns 0, so long labels never wrap and
  // nodes come out unnaturally wide. Provide a measuring stub.
  const OrigGetContext = dom.window.HTMLCanvasElement.prototype.getContext;
  dom.window.HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === "2d") {
      return {
        font: "20px sans-serif",
        measureText(text) {
          const m = String(this.font).match(/(\d+)px/);
          const size = m ? parseInt(m[1], 10) : 20;
          return { width: measureTextWidth(String(text), size) };
        },
        fillText() {},
        strokeText() {},
        save() {},
        restore() {},
        translate() {},
        scale() {},
        setTransform() {},
        clearRect() {},
        fillRect() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fill() {},
      };
    }
    return OrigGetContext ? OrigGetContext.call(this, type) : null;
  };

  // mermaid htmlLabels mode measures node labels with getBoundingClientRect()
  // on HTML divs — jsdom has no layout and returns all zeros. Match the
  // browser baseline measured on draw.430812.xyz: label div = glyph width
  // (CJK full-width @ font-size) × font-size*1.5 line height; when the label
  // has a max-width style and text overflows, the browser wraps (mermaid then
  // switches the div to break-spaces) — simulate that wrapping here so nodes
  // come out the same size as in a real browser.
  const win = dom.window;
  const OrigGBCR = win.Element.prototype.getBoundingClientRect;
  win.Element.prototype.getBoundingClientRect = function () {
    const text = (this.textContent || "").trim();
    if (text) {
      const size = fontSizeOf(this);
      const style = (this.getAttribute && this.getAttribute("style")) || "";
      const mw = style.match(/max-width:\s*(\d+)px/);
      const maxWidth = mw ? parseInt(mw[1], 10) : 0;
      let lines = 1;
      let cur = 0;
      let totalW = 0;
      for (const ch of text) {
        const cw = charWidth(ch, size);
        if (maxWidth > 0 && cur + cw > maxWidth && cur > 0) {
          lines++;
          cur = cw;
        } else {
          cur += cw;
        }
        totalW = Math.max(totalW, cur);
      }
      const w = maxWidth > 0 && totalW > maxWidth ? maxWidth : totalW;
      const h = size * 1.5 * lines;
      return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, width: w, height: h, toJSON() { return {}; } };
    }
    return OrigGBCR.call(this);
  };

  domReady = true;
}

/**
 * Custom text metrics provider — the official escape hatch for non-DOM
 * environments (setCustomTextMetricsProvider is exported for exactly this).
 * Only affects the *estimated* text box size; fonts/bindings stay official.
 */
async function loadElement() {
  const { convertToExcalidrawElements, setCustomTextMetricsProvider } =
    await import("@excalidraw/element");
  setCustomTextMetricsProvider({
    getLineWidth(text, fontString) {
      const m = String(fontString).match(/(\d+)px/);
      const size = m ? parseInt(m[1], 10) : 20;
      let w = 0;
      for (const ch of text) {
        w += ch.charCodeAt(0) > 0x2e80 ? size : size * 0.6; // CJK full-width
      }
      return Math.max(10, w);
    },
  });
  return { convertToExcalidrawElements };
}

/**
 * Convert Mermaid source to full Excalidraw elements.
 * Steps: official parser (jsdom) → official convertToExcalidrawElements.
 * Pure Node — no playwright, no mcphub, no browser.
 */
async function convertMermaid(mmd) {
  ensureDom();

  const { parseMermaidToExcalidraw } = await import(
    "@excalidraw/mermaid-to-excalidraw"
  );
  const { elements } = await parseMermaidToExcalidraw(mmd, {});
  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error("parser returned no elements");
  }

  // m2e 官方转换器对 class/er/state/gantt 等类型在 mermaid 11.12 下会降级为
  // graphImage（浏览器端同样如此）——明确告知而不是静默存一张图。
  if (elements.length === 1 && elements[0].type === "image") {
    throw new Error(
      "this mermaid diagram type is not natively supported by the official " +
        "converter (same as the frontend AI) — the scene would fall back to " +
        "an image. Try flowchart/sequence diagrams.",
    );
  }

  const { convertToExcalidrawElements } = await loadElement();
  return convertToExcalidrawElements(elements);
}

module.exports = { convertMermaid };
