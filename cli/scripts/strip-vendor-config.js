#!/usr/bin/env node
/**
 * Strip upstream cloud/plus config values from the vendored bundle.
 *
 * @excalidraw/excalidraw dist bakes a global config object with URLs/keys
 * for excalidraw.com cloud services (backend v2, libraries, Excalidraw+,
 * official AI, official collab WS, Firebase). The CLI only calls
 * exportToCanvas/exportToSvg — none of these are used, and the Firebase
 * apiKey trips GitHub secret scanning. Scrub every value we don't use
 * (keep the keys, empty the values, so no code path reads undefined).
 *
 * Run after every esbuild rebuild of vendor/excalidraw-export.cjs.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const bundle = path.join(__dirname, "..", "vendor", "excalidraw-export.cjs");
let src = fs.readFileSync(bundle, "utf8");

const scrubs = [
  // double-quoted URL/flag values
  [/VITE_APP_BACKEND_V2_GET_URL: "[^"]*"/, 'VITE_APP_BACKEND_V2_GET_URL: ""'],
  [/VITE_APP_BACKEND_V2_POST_URL: "[^"]*"/, 'VITE_APP_BACKEND_V2_POST_URL: ""'],
  [/VITE_APP_LIBRARY_URL: "[^"]*"/, 'VITE_APP_LIBRARY_URL: ""'],
  [/VITE_APP_LIBRARY_BACKEND: "[^"]*"/, 'VITE_APP_LIBRARY_BACKEND: ""'],
  [/VITE_APP_PLUS_LP: "[^"]*"/, 'VITE_APP_PLUS_LP: ""'],
  [/VITE_APP_PLUS_APP: "[^"]*"/, 'VITE_APP_PLUS_APP: ""'],
  [/VITE_APP_AI_BACKEND: "[^"]*"/, 'VITE_APP_AI_BACKEND: ""'],
  [/VITE_APP_WS_SERVER_URL: "[^"]*"/, 'VITE_APP_WS_SERVER_URL: ""'],
  [/VITE_APP_ENABLE_TRACKING: "[^"]*"/, 'VITE_APP_ENABLE_TRACKING: ""'],
  [/VITE_APP_ENABLE_ESLINT: "[^"]*"/, 'VITE_APP_ENABLE_ESLINT: ""'],
  [/VITE_APP_DEBUG_ENABLE_TEXT_CONTAINER_BOUNDING_BOX: "[^"]*"/, 'VITE_APP_DEBUG_ENABLE_TEXT_CONTAINER_BOUNDING_BOX: ""'],
  [/VITE_APP_COLLAPSE_OVERLAY: "[^"]*"/, 'VITE_APP_COLLAPSE_OVERLAY: ""'],
  // single-quoted Firebase config (apiKey included)
  [/VITE_APP_FIREBASE_CONFIG: '[^']*'/, "VITE_APP_FIREBASE_CONFIG: '{}'"],
  // template-literal RSA public key (multi-line)
  [/VITE_APP_PLUS_EXPORT_PUBLIC_KEY: `[^`]*`/s, 'VITE_APP_PLUS_EXPORT_PUBLIC_KEY: ""'],
];

let total = 0;
for (const [re, to] of scrubs) {
  const n = (src.match(re) || []).length;
  src = src.replace(re, to);
  total += n;
}

// Guard: no residual API-key-shaped strings, no residual non-empty upstream
// config values (UI-internal hardcoded strings like docs.excalidraw.com /
// link.excalidraw.com in embed lists are part of official UI code, not config)
const apiKeyLeft = (src.match(/AIzaSy[A-Za-z0-9_-]+/g) || []).length;
const cfgLeft = (src.match(/VITE_APP_[A-Z0-9_]+: "[^"]+"/g) || []).length;

fs.writeFileSync(bundle, src);
console.log(`✓ scrubbed ${total} upstream config values (apiKey left: ${apiKeyLeft}, non-empty config values left: ${cfgLeft})`);
if (apiKeyLeft !== 0 || cfgLeft !== 0) {
  console.error("FATAL: residual upstream config patterns remain");
  process.exit(1);
}
