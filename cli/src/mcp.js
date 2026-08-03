/**
 * mcphub MCP client — streamable-http, zero dependencies (Node >= 18 fetch).
 *
 * Used for E2E verification only: drives the official conversion in a real
 * browser through mcphub → playwright MCP (headless Chrome) as a baseline to
 * compare the pure-Node output against. Credentials come from the
 * environment — never hardcode keys in source.
 */
"use strict";

const BASE = process.env.MCP_HUB_URL || "http://localhost:3000/mcp";
const KEY = process.env.MCP_HUB_KEY;
if (!KEY) {
  throw new Error(
    "MCP_HUB_KEY is required — set it in the environment (mcphub bearer key).",
  );
}

let sessionId = null;

async function mcpRequest(method, params) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${KEY}`,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`mcphub HTTP ${res.status} — is mcphub running on :3000?`);
  }
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  const text = await res.text();
  const messages = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("data:")) {
      try {
        messages.push(JSON.parse(line.slice(5).trim()));
      } catch {
        /* ignore keepalive/comment frames */
      }
    }
  }
  const msg = messages[0];
  if (msg?.error) {
    throw new Error(`MCP ${method} failed: ${msg.error.message || JSON.stringify(msg.error)}`);
  }
  return msg?.result;
}

async function init() {
  if (sessionId) return;
  await mcpRequest("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "excalidraw-cli", version: "0.1.0" },
  });
  try {
    await mcpRequest("notifications/initialized", {});
  } catch {
    // some hubs don't implement the notification — the session still works
  }
}

/**
 * Call a hub tool (name is `<server>-<tool>`, e.g. `playwright-browser_evaluate`).
 * Parses the playwright MCP "### Result\n{json}" envelope; falls back to raw
 * text when the result is not JSON.
 */
async function callTool(name, args) {
  await init();
  const result = await mcpRequest("tools/call", { name, arguments: args });
  const text = (result?.content || [])
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .join("\n");
  if (result?.isError) {
    throw new Error(`tool ${name} error: ${text.slice(0, 500)}`);
  }
  const m = text.match(/### Result\n([\s\S]*?)\n### Ran/);
  if (m) {
    try {
      return JSON.parse(m[1].trim());
    } catch {
      return m[1].trim();
    }
  }
  try {
    return JSON.parse(text.trim());
  } catch {
    return text.trim();
  }
}

module.exports = { callTool, init };
