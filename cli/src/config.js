/**
 * CLI configuration — all values overridable via env vars, nothing hardcoded.
 * Credentials (usernames, tokens) never live in this repo.
 */
"use strict";

const fs = require("fs");
const path = require("path");

/** Load .env from the selfhost repo root (key=value lines, no export). */
function loadDotEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env — env vars only */
  }
}

loadDotEnv();

module.exports = {
  /** ws-server base URL (the cloud workspace API). */
  wsApi: process.env.WS_API || "http://127.0.0.1:3020",
  /** ai-server base URL (text-to-diagram SSE). */
  aiApi: process.env.AI_API || "http://127.0.0.1:3016",
  /** Username IS the credential (no password). Required per invocation or env. */
  username: process.env.EXCALIDRAW_WS_USER || null,
};
