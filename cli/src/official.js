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
  // Simulate the union-bbox semantics: text nodes are measured per-char
  // (CJK full-width, latin ~0.6em), shape nodes use their width/height
  // attributes, groups union their children (offset by child x/y).
  // Measurement only — layout stays 100% official mermaid.
  const measureTextWidth = (text, size) => {
    let w = 0;
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c === 0x20 || c === 0xa0) w += size * 0.35; // space
      else if (c > 0x2e80) w += size; // CJK full-width
      else w += size * 0.6; // latin/digit
    }
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
      if (this.tagName === "text" || this.tagName === "tspan") {
        const w = measureTextWidth(this.textContent || "", size);
        return { x: 0, y: 0, width: w, height: size * 1.25 };
      }
      // group (g) or anything else: union of children bboxes
      let minX = 0, minY = 0, maxX = 0, maxY = 0;
      let first = true;
      const kids = this.children ? [...this.children] : [];
      for (const kid of kids) {
        const b = kid.getBBox ? kid.getBBox() : null;
        if (!b || (b.width === 0 && b.height === 0 && b.x === 0 && b.y === 0 && kid.tagName !== "text")) continue;
        const x0 = b.x, y0 = b.y, x1 = b.x + b.width, y1 = b.y + b.height;
        if (first) { minX = x0; minY = y0; maxX = x1; maxY = y1; first = false; }
        else { minX = Math.min(minX, x0); minY = Math.min(minY, y0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1); }
      }
      if (first) {
        const w = measureTextWidth(this.textContent || "", size);
        return { x: 0, y: 0, width: w, height: size * 1.25 };
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

  // mermaid htmlLabels mode measures node labels with getBoundingClientRect()
  // on HTML divs — jsdom has no layout and returns all zeros. Match the
  // browser baseline measured on draw.430812.xyz: label div = glyph width
  // (CJK full-width @ font-size) × font-size*1.5 line height, no extra padding
  // (mermaid adds node padding itself).
  const win = dom.window;
  const OrigGBCR = win.Element.prototype.getBoundingClientRect;
  win.Element.prototype.getBoundingClientRect = function () {
    const text = (this.textContent || "").trim();
    if (text) {
      const size = fontSizeOf(this);
      const w = measureTextWidth(text, size);
      const h = size * 1.5;
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

  const { convertToExcalidrawElements } = await loadElement();
  return convertToExcalidrawElements(elements);
}

module.exports = { convertMermaid };
