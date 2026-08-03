/**
 * Official conversion path — the exact pipeline the frontend AI uses:
 *   @excalidraw/mermaid-to-excalidraw@2.2.2 (parseMermaidToExcalidraw)
 *   + element materialization (the fields restoreElements/runtime need)
 * executed inside a real browser via mcphub → playwright MCP.
 *
 * The parser output is a minimal skeleton (shapes carry `label`, arrows carry
 * `start`/`end` id refs); materialize fills in runtime fields (seed, version,
 * boundElements, standalone text elements, arrow bindings) so the scene opens
 * and renders exactly like a native canvas.
 */
"use strict";

const mcp = require("./mcp");

const PARSER_CDN = "https://esm.sh/@excalidraw/mermaid-to-excalidraw@2.2.2";

/** Build the browser-side conversion function as a string. */
function buildConvertScript(mmd) {
  const mmdJson = JSON.stringify(mmd);
  return `async () => {
    const { parseMermaidToExcalidraw } = await import(${JSON.stringify(PARSER_CDN)});
    const { elements } = await parseMermaidToExcalidraw(${mmdJson}, {});
    if (!Array.isArray(elements) || elements.length === 0) {
      throw new Error("parser returned no elements");
    }
    const rand = () => Math.floor(Math.random() * 2 ** 31);
    const rid = () => "el" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
    const idMap = new Map();
    const mid = (id) => {
      if (!idMap.has(id)) idMap.set(id, rid());
      return idMap.get(id);
    };
    const els = [];
    const shapes = new Map();
    const arrows = [];
    let z = 0;
    const zIndex = () => "a" + (z++).toString(36);
    for (const el of elements) {
      if (el.type === "arrow") { arrows.push(el); continue; }
      const newId = mid(el.id);
      const w = el.width || 100;
      const h = el.height || 60;
      let t = null;
      const shape = {
        id: newId, type: el.type, x: el.x, y: el.y, width: w, height: h,
        angle: 0, strokeColor: el.strokeColor || "#1e1e1e",
        backgroundColor: el.backgroundColor || "transparent",
        fillStyle: "solid", strokeWidth: el.strokeWidth || 2,
        strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [],
        frameId: null, index: zIndex(), seed: rand(), version: 1,
        versionNonce: rand(), isDeleted: false, boundElements: [],
        updated: Date.now(), link: null, locked: false,
      };
      if (el.label && el.label.text) {
        const fs = el.label.fontSize || 20;
        // CJK chars are full-width (1.0em); bound text x/y = container center
        // minus half the text box (what the editor itself stores).
        const tw = Math.max(40, el.label.text.length * fs);
        const th = fs * 1.25;
        t = {
          id: rid(), type: "text",
          x: el.x + (w - tw) / 2, y: el.y + (h - th) / 2,
          width: tw, height: th,
          angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent",
          fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1,
          opacity: 100, groupIds: [], frameId: null, index: zIndex(),
          seed: rand(), version: 1, versionNonce: rand(), isDeleted: false,
          boundElements: null, updated: Date.now(), link: null, locked: false,
          fontSize: fs, fontFamily: 5, text: el.label.text,
          textAlign: "center", verticalAlign: "middle", containerId: newId,
          originalText: el.label.text, lineHeight: 1.25, autoResize: true,
        };
        shape.boundElements.push({ id: t.id, type: "text" });
      }
      shapes.set(newId, shape);
      els.push(shape);
      if (el.label && el.label.text) {
        els.push(t);
      }
    }
    for (const a of arrows) {
      const newId = mid(a.id);
      const startId = a.start && a.start.id ? mid(a.start.id) : null;
      const endId = a.end && a.end.id ? mid(a.end.id) : null;
      // Anchor points on the two bound shapes, along the center line — used
      // to place edge labels away from the shapes (parser's bbox midpoint
      // puts labels right on the diamond edge).
      const edgePoint = (from, to) => {
        const cx = from.x + from.width / 2;
        const cy = from.y + from.height / 2;
        let dx = to.x + to.width / 2 - cx;
        let dy = to.y + to.height / 2 - cy;
        if (dx === 0 && dy === 0) dx = 1;
        let t = Infinity;
        if (Math.abs(dx) > 0) t = Math.min(t, from.width / 2 / Math.abs(dx));
        if (Math.abs(dy) > 0) t = Math.min(t, from.height / 2 / Math.abs(dy));
        return { x: cx + dx * t, y: cy + dy * t };
      };
      const sShape = startId ? shapes.get(startId) : null;
      const eShape = endId ? shapes.get(endId) : null;
      // Precise anchor points (edge intersections along the center line),
      // converted to fixedPoint ratios — matches what the frontend converter
      // stores ({elementId, mode: "orbit", fixedPoint}).
      let p1 = null;
      let p2 = null;
      if (sShape && eShape && sShape !== eShape) {
        p1 = edgePoint(sShape, eShape);
        p2 = edgePoint(eShape, sShape);
      }
      const arrow = {
        id: newId, type: "arrow", x: a.x, y: a.y, width: a.width || 0, height: a.height || 0,
        angle: 0, strokeColor: a.strokeColor || "#1e1e1e",
        backgroundColor: "transparent", fillStyle: "solid",
        strokeWidth: a.strokeWidth || 2, strokeStyle: "solid", roughness: 1,
        opacity: 100, groupIds: [], frameId: null, index: zIndex(),
        seed: rand(), version: 1, versionNonce: rand(), isDeleted: false,
        boundElements: null, updated: Date.now(), link: null, locked: false,
        points: (a.points && a.points.length) ? a.points : [[0, 0], [a.width || 0, a.height || 0]],
        startBinding:
          startId && p1 && sShape
            ? {
                elementId: startId,
                mode: "orbit",
                fixedPoint: [
                  (p1.x - sShape.x) / sShape.width,
                  (p1.y - sShape.y) / sShape.height,
                ],
              }
            : null,
        endBinding:
          endId && p2 && eShape
            ? {
                elementId: endId,
                mode: "orbit",
                fixedPoint: [
                  (p2.x - eShape.x) / eShape.width,
                  (p2.y - eShape.y) / eShape.height,
                ],
              }
            : null,
        startArrowhead: null, endArrowhead: "arrow",
        roundness: { type: 2 }, elbowed: false,
      };
      if (startId && shapes.has(startId)) shapes.get(startId).boundElements.push({ id: arrow.id, type: "arrow" });
      if (endId && shapes.has(endId)) shapes.get(endId).boundElements.push({ id: arrow.id, type: "arrow" });
      if (a.label && a.label.text) {
        const atw = Math.max(30, a.label.text.length * 12);
        let lx, ly;
        if (p1 && p2) {
          lx = p1.x + (p2.x - p1.x) * 0.45;
          ly = p1.y + (p2.y - p1.y) * 0.45 - 7;
        } else {
          lx = a.x + (a.width || 0) / 2;
          ly = a.y + (a.height || 0) / 2 - 14;
        }
        const t = {
          id: rid(), type: "text",
          x: lx - atw / 2,
          y: ly,
          width: atw, height: 15,
          angle: 0, strokeColor: "#6b7280", backgroundColor: "transparent",
          fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1,
          opacity: 100, groupIds: [], frameId: null, index: zIndex(),
          seed: rand(), version: 1, versionNonce: rand(), isDeleted: false,
          boundElements: null, updated: Date.now(), link: null, locked: false,
          fontSize: 12, fontFamily: 5, text: a.label.text,
          textAlign: "center", verticalAlign: "top", containerId: null,
          originalText: a.label.text, lineHeight: 1.25, autoResize: true,
        };
        els.push(t);
      }
      els.push(arrow);
    }
    return els;
  }`;
}

/**
 * Convert Mermaid source to materialized Excalidraw elements in the browser.
 * Ensures a live page first (playwright MCP headless Chrome), then evaluates.
 */
async function convertMermaid(mmd) {
  let pageOk = false;
  try {
    const probe = await mcp.callTool("playwright-browser_evaluate", {
      function: "() => ({ ok: typeof window !== 'undefined' && !!window.location })",
    });
    pageOk = !!(probe && probe.ok);
  } catch {
    pageOk = false;
  }
  if (!pageOk) {
    await mcp.callTool("playwright-browser_navigate", {
      url: "https://draw.430812.xyz/",
    });
  }
  const result = await mcp.callTool("playwright-browser_evaluate", {
    function: buildConvertScript(mmd),
  });
  if (!Array.isArray(result)) {
    throw new Error(`official converter returned non-array: ${String(result).slice(0, 300)}`);
  }
  return result;
}

module.exports = { convertMermaid };
