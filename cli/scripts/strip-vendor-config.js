#!/usr/bin/env node
/**
 * Strip the official Firebase apiKey from the vendored bundle.
 *
 * The Firebase config (excalidraw-room-persistence) is baked into the
 * @excalidraw/excalidraw dist as a public upstream constant (also present
 * verbatim in excalidraw/excalidraw .env.production) — we don't use it
 * (CLI only calls exportToCanvas/exportToSvg; Firebase export was removed
 * from the frontend customization), but bundling it trips GitHub secret
 * scanning. Scrub the value; keep the keys so no code path reads undefined.
 *
 * Run after every esbuild rebuild of vendor/excalidraw-export.cjs.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const bundle = path.join(__dirname, "..", "vendor", "excalidraw-export.cjs");
let src = fs.readFileSync(bundle, "utf8");

const before = (src.match(/AIzaSy[A-Za-z0-9_-]+/g) || []).length;
// "apiKey":"AIzaSy..." → "apiKey":""
src = src.replace(/("apiKey"\s*:\s*")AIzaSy[A-Za-z0-9_-]+(")/g, "$1$2");
const after = (src.match(/AIzaSy[A-Za-z0-9_-]+/g) || []).length;

fs.writeFileSync(bundle, src);
console.log(`✓ stripped Firebase apiKey: ${before} → ${after}`);
if (after !== 0) {
  console.error("FATAL: residual AIzaSy patterns remain");
  process.exit(1);
}
