/**
 * Real font metrics — the measurement backbone of the pure-Node pipeline.
 *
 * mermaid's official measurement path is SVG text getBBox() (browsers return
 * the rendered font's real advance widths). jsdom has no layout, so every
 * text measurement in the pipeline funnels through measureTextWidth(). To
 * stay native, this uses REAL font data: opentype.js reads the same system
 * font the browser renders (mermaid's default stack starts with
 * "trebuchet ms") and returns the glyph's hmtx advance — the exact value the
 * browser's getBBox uses.
 *
 * A flat ~0.5em coefficient is NOT acceptable: Trebuchet MS glyphs vary
 * wildly ('W'=0.85em, 'i'=0.29em) — an average only works by luck.
 */
"use strict";

const fs = require("fs");

let metricsFont = undefined; // undefined = not tried yet, null = unavailable

/** Load the system font whose metrics match the browser's rendering. */
function loadMetricsFont() {
  if (metricsFont !== undefined) return metricsFont;
  const candidates = [
    // macOS — mermaid's default font stack starts with "trebuchet ms"
    "/System/Library/Fonts/Supplemental/Trebuchet MS.ttf",
    "/Library/Fonts/Trebuchet MS.ttf",
    // fallbacks for other OSes (mermaid uses Arial on the generic path)
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const opentype = require("opentype.js");
        metricsFont = opentype.parse(fs.readFileSync(p));
        return metricsFont;
      }
    } catch {
      /* try next candidate */
    }
  }
  metricsFont = null;
  return null;
}

/** Width of one character at a given font size, in px. */
function charWidth(ch, size) {
  const c = ch.charCodeAt(0);
  if (c === 0x20 || c === 0xa0) return size * 0.3; // space (U+0020/U+00A0)
  if (c > 0x2e80) return size; // CJK full-width square glyph (browsers fall back to a CJK face; Trebuchet has no CJK glyphs)
  const font = loadMetricsFont();
  if (font) {
    const adv = font.getAdvanceWidth(ch, size);
    if (adv > 0) return adv; // real hmtx advance of the rendered font
  }
  return size * 0.5; // last-resort heuristic (no system font found)
}

/** Width of a text run at a given font size, in px. */
function measureTextWidth(text, size) {
  let w = 0;
  for (const ch of text) w += charWidth(ch, size);
  return Math.max(w, 4);
}

/** Resolve the effective font-size for a DOM node (inline style / attr / default). */
function fontSizeOf(el) {
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
}

module.exports = { charWidth, measureTextWidth, fontSizeOf, loadMetricsFont };
