/**
 * text-to-diagram client — streams the ai-server SSE endpoint and
 * returns the complete Mermaid definition.
 *
 * SSE protocol (ai-server):
 *   data: {"type":"content","delta":"<mermaid>"}
 *   data: {"type":"done","finishReason":"stop"}
 *   data: [DONE]
 */
"use strict";

const config = require("./config");

async function textToDiagram(prompt) {
  const res = await fetch(
    `${config.aiApi}/v1/ai/text-to-diagram/chat-streaming`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
      }),
    },
  );
  if (!res.ok || !res.body) {
    throw new Error(`ai-server error (HTTP ${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let mermaid = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      let msg;
      try {
        msg = JSON.parse(payload);
      } catch {
        continue;
      }
      if (msg.type === "content" && typeof msg.delta === "string") {
        mermaid += msg.delta;
      } else if (msg.type === "error") {
        throw new Error(msg.message || "AI generation error");
      } else if (msg.type === "done") {
        break;
      }
    }
  }

  if (!mermaid.trim()) {
    throw new Error("AI returned empty diagram");
  }
  return mermaid.trim();
}

module.exports = { textToDiagram };
