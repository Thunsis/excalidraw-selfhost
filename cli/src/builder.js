/**
 * Excalidraw element builders — minimal field set accepted by restoreElements
 * (verified end-to-end: POST /api/scenes → frontend renders correctly).
 * Mirrors the Python helpers from the original canvas PoC.
 */
"use strict";

let seedCounter = 0;

function randomId() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  let out = "";
  for (let i = 0; i < 20; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function baseEl(type, x, y, extra = {}) {
  const el = {
    id: randomId(),
    type,
    x,
    y,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a0",
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    ...extra,
  };
  return el;
}

function text(x, y, s, { size = 20, color = "#1e1e1e" } = {}) {
  return baseEl("text", x, y, {
    width: Math.ceil(s.length * size * 0.6),
    height: Math.ceil(size * 1.25),
    strokeColor: color,
    fontSize: size,
    fontFamily: 5, // Excalifont — CJK falls back to Xiaolai (hand-drawn), same as frontend TTD
    text: s,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    originalText: s,
    lineHeight: 1.25,
    autoResize: true,
  });
}

function rect(x, y, w, h, { fill = "transparent", stroke = "#1e1e1e", radius = true } = {}) {
  const el = baseEl("rectangle", x, y, {
    width: w,
    height: h,
    strokeColor: stroke,
    backgroundColor: fill,
  });
  return el;
}

function diamond(x, y, w, h, { fill = "transparent", stroke = "#1e1e1e" } = {}) {
  return baseEl("diamond", x, y, {
    width: w,
    height: h,
    strokeColor: stroke,
    backgroundColor: fill,
  });
}

function ellipse(x, y, w, h, { fill = "transparent", stroke = "#1e1e1e" } = {}) {
  return baseEl("ellipse", x, y, {
    width: w,
    height: h,
    strokeColor: stroke,
    backgroundColor: fill,
  });
}

function arrow(x1, y1, x2, y2, { label = null, dashed = false } = {}) {
  const el = baseEl("arrow", x1, y1, {
    width: x2 - x1,
    height: y2 - y1,
    points: [
      [0, 0],
      [x2 - x1, y2 - y1],
    ],
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    roundness: { type: 2 },
    elbowed: false,
  });
  if (dashed) {
    el.strokeStyle = "dashed";
  }
  return el;
}

module.exports = { text, rect, diamond, ellipse, arrow };
