/**
 * Official conversion pipeline — the EXACT same code path the frontend AI
 * Text-to-Diagram uses, no custom element writing:
 *
 *   1. browser (mcphub → playwright MCP): @excalidraw/mermaid-to-excalidraw
 *      (esm.sh CDN, needs DOM for DOMPurify/SVG) → raw skeleton
 *   2. node: @excalidraw/element@0.18.0 (npm, same version as the frontend)
 *      convertToExcalidrawElements → full native elements
 *
 * Everything (fonts, bindings, fill, z-order, wrapping) is decided by the
 * official library — output is byte-for-byte what the frontend produces.
 */
"use strict";

const mcp = require("./mcp");

const PARSER_CDN = "https://esm.sh/@excalidraw/mermaid-to-excalidraw@2.2.2";

/** Node lacks the browser global; the official package only probes it. */
globalThis.window = globalThis.window || {};

/**
 * Custom text metrics provider — the official escape hatch for non-DOM
 * environments (setCustomTextMetricsProvider is exported for exactly this).
 * Only affects the *estimated* text box size; fonts/bindings stay official.
 */
async function loadElement() {
  // @excalidraw/element is ESM-only; dynamic import works from CJS.
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

/** Browser-side: parse Mermaid into the raw skeleton (no materialization). */
function buildParseScript(mmd) {
  const mmdJson = JSON.stringify(mmd);
  return `async () => {
    const { parseMermaidToExcalidraw } = await import(${JSON.stringify(PARSER_CDN)});
    const { elements } = await parseMermaidToExcalidraw(${mmdJson}, {});
    if (!Array.isArray(elements) || elements.length === 0) {
      throw new Error("parser returned no elements");
    }
    return elements;
  }`;
}

/**
 * Convert Mermaid source to full Excalidraw elements.
 * Steps: browser parse (skeleton) → official convertToExcalidrawElements.
 */
async function convertMermaid(mmd) {
  // 1. skeleton via the official parser in a real browser
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
  const skeleton = await mcp.callTool("playwright-browser_evaluate", {
    function: buildParseScript(mmd),
  });
  if (!Array.isArray(skeleton)) {
    throw new Error(`parser returned non-array: ${String(skeleton).slice(0, 300)}`);
  }

  // 2. official element materialization (same function as the frontend TTD)
  const { convertToExcalidrawElements } = await loadElement();
  return convertToExcalidrawElements(skeleton);
}

module.exports = { convertMermaid };
