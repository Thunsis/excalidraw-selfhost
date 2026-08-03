/**
 * PNG export — official exportToCanvas (esbuild-bundled vendor) rasterized
 * by @napi-rs/canvas attached to jsdom. Pure Node: elements → canvas (official
 * @excalidraw/excalidraw exportToCanvas) → PNG bytes. This is the SAME export
 * path the frontend uses (canvas 2D rendering), not an SVG resvg workaround.
 */
"use strict";

/**
 * Render scene elements to PNG bytes.
 * @param {Array} elements full excalidraw elements (from ws-api export)
 * @param {object} [opts] { padding, background, scale }
 * @returns {Promise<Buffer>}
 */
async function elementsToPng(elements, opts = {}) {
  const { ensureDom } = require("./official");
  ensureDom({ canvas: true }); // jsdom + real Canvas 2D (@napi-rs/canvas)
  // vendor bundle reads devicePixelRatio at module init
  if (globalThis.devicePixelRatio === undefined) {
    globalThis.devicePixelRatio = 2;
  }

  const { exportToCanvas } = require("../vendor/excalidraw-export.cjs");

  const { padding = 24, background = "#ffffff", scale = 2 } = opts;

  const canvas = await exportToCanvas({
    elements,
    appState: {
      exportBackground: true,
      exportPadding: padding,
      viewBackgroundColor: background,
      exportScale: scale,
    },
    files: new Map(), // exportToCanvas calls files.has() — null crashes
    scale,
  });

  // Standard HTMLCanvasElement API — jsdom's impl rasterizes via the
  // attached @napi-rs/canvas and returns a base64 data URL.
  const dataUrl = canvas.toDataURL("image/png");
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

module.exports = { elementsToPng };
