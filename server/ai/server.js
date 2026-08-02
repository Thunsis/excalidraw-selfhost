#!/usr/bin/env node
/**
 * Excalidraw 本地 AI 后端
 * 实现 Excalidraw 期望的 /v1/ai/text-to-diagram/chat-streaming SSE 接口
 * 背后调用 opencode.ai (DeepSeek V4 Flash, 免费)
 *
 * SSE 协议 (Excalidraw TTDStreamFetch):
 *   data: {"type":"content","delta":"<mermaid>"}
 *   data: {"type":"done","finishReason":"stop"}
 *   data: [DONE]
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3016);
const OPENAI_BASE = process.env.OPENAI_BASE || "https://opencode.ai/zen/go/v1";
const MODEL = process.env.MODEL || "deepseek-v4-flash";
const API_KEY = process.env.API_KEY || loadKeyFromConfig();

const SYSTEM_PROMPT = `You are a Mermaid diagram generator. The user describes a diagram they want in natural language.
Generate ONLY valid Mermaid.js code — nothing else, no markdown fences, no explanation, no commentary.
Choose the most appropriate Mermaid diagram type for the request:
- flowchart (TB/LR/TD) for processes, workflows, decision trees
- sequenceDiagram for interactions/timelines between actors
- classDiagram for object-oriented structures
- stateDiagram-v2 for state machines
- erDiagram for entity relationships
- gantt for schedules/timelines
- mindmap for hierarchical brainstorming
Use clear node labels, proper edge labels, and Chinese labels when the user writes in Chinese.
Always prefer a complete, syntactically valid diagram over a partial one.`;

function loadKeyFromConfig() {
  // 优先 OPENAI_CONFIG_FILE（通用，任意 YAML/JSON 文件里的 openai_api_key 或 opencode-go.api_key），
  // 兼容旧路径 ~/.hermes/config.yaml（本地现状）
  const configFile =
    process.env.OPENAI_CONFIG_FILE || path.join(process.env.HOME || "", ".hermes/config.yaml");
  try {
    const conf = fs.readFileSync(configFile, "utf8");
    const m =
      conf.match(/openai_api_key:\s*['"]?([^'"\n]+)/) ||
      conf.match(/opencode-go:\s*\n\s*api_key:\s*['"]?([^'"\n]+)/);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

function sendSSE(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

function parseSSELine(line, onData) {
  if (!line.startsWith("data:")) return;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return;
  try {
    onData(JSON.parse(data));
  } catch {
    /* ignore malformed */
  }
}

/**
 * 流式 Mermaid 清洗器（状态机）：
 * - outside：缓冲找 ```。超过阈值仍未找到 → 视为无围栏纯输出，切 passthrough 实时转发
 * - 找到 ```mermaid 或 ``` → 丢弃围栏前解释文字，进 inFence
 * - inFence：实时转发内容，遇到结束 ``` → 回 outside
 * - flush：inFence 残留内容补发；outside 残留（解释文字）丢弃
 */
/**
 * 流式 Mermaid 清洗器（状态机）：
 * - outside：缓冲找 ```。超过阈值仍未找到 → 视为无围栏纯输出，切 passthrough 实时转发
 * - 找到 ```（或 ```mermaid）→ 丢弃围栏前解释文字，进 inFence
 * - inFence：按行缓冲，首行语言标签（mermaid/空）剥掉；后续实时转发；遇到结束 ``` → 回 outside
 * - flush：inFence 残留补发；outside 残留（解释文字）丢弃
 * - 全程无围栏 → passthrough/flush 输出全部内容（剥裸 mermaid 前缀）
 */
function createMermaidSanitizer() {
  let state = "outside"; // outside | inFence | passthrough
  let buf = "";
  let firstFenceLine = true; // inFence 首行需检查语言标签
  let sawFence = false; // 出现过围栏 → flush 时丢弃 outside 残留（围栏后解释文字）
  let firstEmit = true; // 全局首个 emit 剥一次裸 "mermaid" 前缀

  // 剥裸前缀：仅当整体从 "mermaid" 开头
  const stripLangTag = (text) => {
    const out = firstEmit ? text.replace(/^mermaid[\s\n]*/, "") : text;
    firstEmit = false;
    return out;
  };

  const tryEnterFence = (emitFn) => {
    const idx = buf.indexOf("```");
    if (idx === -1) return false;
    const rest = buf.slice(idx + 3);
    if (rest.startsWith("mermaid") || rest.startsWith("\n") || rest.startsWith(" ") || rest === "") {
      // 围栏开始：丢弃围栏前解释文字
      state = "inFence";
      sawFence = true;
      buf = rest.replace(/^mermaid\s*/, "");
      firstFenceLine = true;
      return true;
    }
    // 不是围栏（伪出现）：当普通内容处理
    emitFn(stripLangTag(buf.slice(0, idx + 3)));
    buf = rest;
    return false;
  };

  return {
    push(chunk, emit) {
      buf += chunk;

      if (state === "outside") {
        if (tryEnterFence(emit)) return;
        // 缓冲太久没见围栏 → 无围栏纯输出，进入 passthrough
        if (buf.length > 64) {
          emit(stripLangTag(buf));
          buf = "";
          state = "passthrough";
        }
        return;
      }

      if (state === "inFence") {
        // 结束围栏
        const end = buf.indexOf("```");
        if (end !== -1) {
          let content = buf.slice(0, end);
          if (firstFenceLine) {
            content = content.replace(/^mermaid\s*/, "");
            firstFenceLine = false;
          }
          content = stripLangTag(content);
          if (content) emit(content);
          buf = "";
          state = "outside";
          return;
        }
        // 首行未完整：等换行再判断语言标签
        if (firstFenceLine) {
          const nl = buf.indexOf("\n");
          if (nl === -1) {
            if (buf.length > 64) {
              // 异常：首行超长无换行，当作内容输出
              firstFenceLine = false;
              emit(stripLangTag(buf));
              buf = "";
            }
            return;
          }
          const firstLine = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          firstFenceLine = false;
          if (firstLine.trim() === "mermaid" || firstLine.trim() === "") {
            // 语言标签行，剥掉；后续内容实时转发
            if (buf) {
              emit(stripLangTag(buf));
              buf = "";
            }
          } else {
            // 不是语言标签：原样输出（含首行）
            if (buf) {
              emit(stripLangTag(firstLine + "\n" + buf));
              buf = "";
            }
          }
          return;
        }
        // 正常内容：实时转发
        if (buf) {
          emit(stripLangTag(buf));
          buf = "";
        }
        return;
      }

      // passthrough
      if (buf) {
        emit(stripLangTag(buf));
        buf = "";
      }
    },
    flush(emit) {
      if (state === "inFence" && buf) {
        let content = buf;
        if (firstFenceLine) {
          content = content.replace(/^mermaid\s*/, "");
        }
        content = stripLangTag(content);
        if (content) emit(content);
      } else if (state === "outside" && buf && !sawFence) {
        // 全程无围栏 → 纯 Mermaid 输出，补发残留
        emit(stripLangTag(buf));
      }
      buf = "";
      state = "outside";
    },
  };
}

async function handleChatStreaming(req, res) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    if (messages.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "messages are required" }));
      return;
    }

    // 过滤客户端可能传的 system 消息，统一用我们的 system prompt
    const userMessages = messages.filter((m) => m.role !== "system");
    const llmMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...userMessages,
    ];

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Ratelimit-Limit": "1000",
      "X-Ratelimit-Remaining": "999",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    });

    // 客户端断开时停止上游调用（必须监听 res，不是 req！req close 在 body 读完就触发）
    const aborted = { current: false };
    res.on("close", () => {
      aborted.current = true;
    });

    try {
      const upstream = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: llmMessages,
          stream: true,
          max_tokens: 4096,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!upstream.ok || !upstream.body) {
        const errText = await upstream.text().catch(() => "");
        sendSSE(res, {
          type: "error",
          error: {
            message: `Upstream error ${upstream.status}: ${errText.slice(0, 200)}`,
            status: 500,
          },
        });
        sendSSE(res, { type: "done", finishReason: "stop" });
        res.end();
        return;
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let emitted = false;
      const sanitizer = createMermaidSanitizer();
      const emitContent = (text) => {
        if (text) {
          emitted = true;
          sendSSE(res, { type: "content", delta: text });
        }
      };

      while (!aborted.current) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          parseSSELine(line, (chunk) => {
            // 只转发 content（跳过 reasoning_content 和 cost chunk）
            const delta = chunk?.choices?.[0]?.delta;
            if (delta && typeof delta.content === "string" && delta.content) {
              sanitizer.push(delta.content, emitContent);
            }
          });
        }
      }
      sanitizer.flush(emitContent);

      sendSSE(res, { type: "done", finishReason: "stop" });
      res.write("data: [DONE]\n\n");
      res.end();
      if (!emitted) {
        console.log(
          `[${new Date().toISOString()}] Empty response for prompt: ${JSON.stringify(
            userMessages.slice(-1)[0]?.content,
          ).slice(0, 100)}`,
        );
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Stream error:`, err.message);
      try {
        sendSSE(res, {
          type: "error",
          error: { message: err.message || "Upstream failure", status: 500 },
        });
        sendSSE(res, { type: "done", finishReason: "stop" });
        res.write("data: [DONE]\n\n");
        res.end();
      } catch {
        /* res already closed */
      }
    }
  });
}

/**
 * POST /v1/ai/scene-name — 非流式场景命名
 * 输入 { texts: string[] }（画布文本元素，按画布顺序）
 * 输出 { name: string }（≤40 字符，语言跟随内容；失败 500 { error }）
 * 保存成功后由前端异步调用，不阻塞保存主流程。
 */
const SCENE_NAME_MAX = 40;

function buildSceneNamePrompt(joinedTexts) {
  const list = joinedTexts
    .split("\n")
    .filter((t) => t.trim().length > 0)
    .map((t, i) => `${i + 1}. ${t.trim()}`)
    .join("\n");
  return `You are a scene-naming assistant for a whiteboard app. The user drew a canvas containing these text elements (in order):

${list}

Create ONE concise, descriptive title for the canvas.
Rules:
- Summarize the overall topic or purpose of the drawing, not a random fragment.
- Use the same language as the content (Chinese content → Chinese title; mixed → dominant language).
- Max ${SCENE_NAME_MAX} characters.
- No quotes, no trailing punctuation, no numbering, no explanation. Reply with the title only.`;
}

async function handleSceneName(req, res) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    const texts = Array.isArray(payload.texts)
      ? payload.texts
          .filter((t) => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim().replace(/\s+/g, " "))
      : [];
    if (texts.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "texts are required", name: null }));
      return;
    }
    // 防 token 浪费：截断到 2000 字符
    let joined = "";
    for (const t of texts) {
      if ((joined + t + "\n").length > 2000) break;
      joined += t + "\n";
    }

    try {
      // 推理模型偶发空 content（reasoning 占满 max_tokens 或上游抖动）→ 自动重试
      let name = "";
      let lastErr = null;
      for (let attempt = 0; attempt < 3 && !name; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
        try {
          const upstream = await fetch(`${OPENAI_BASE}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: MODEL,
              messages: [
                { role: "system", content: buildSceneNamePrompt(joined.trim()) },
                { role: "user", content: "Name this canvas." },
              ],
              stream: false,
              // deepseek-v4-flash 是推理模型：max_tokens 太小会被思考过程占满
              // 导致 content 为空（输出全在 reasoning_content）——必须留足思考空间
              max_tokens: 1000,
              temperature: 0.3,
            }),
            signal: AbortSignal.timeout(30000),
          });

          if (!upstream.ok) {
            const errText = await upstream.text().catch(() => "");
            throw new Error(
              `Upstream error ${upstream.status}: ${errText.slice(0, 200)}`,
            );
          }

          const data = await upstream.json();
          name =
            data?.choices?.[0]?.message?.content
              ?.trim()
              .replace(/["'“”‘’。.]+$/, "") || "";
          name = name.slice(0, SCENE_NAME_MAX);
        } catch (e) {
          lastErr = e;
        }
      }

      if (!name) {
        console.error(
          `[${new Date().toISOString()}] scene-name failed after retries:`,
          lastErr?.message || "empty model output",
        );
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: lastErr?.message || "Empty model output",
            name: null,
          }),
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name }));
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] scene-name error:`,
        err.message,
      );
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message || "Upstream failure", name: null }));
    }
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/v1/ai/text-to-diagram/chat-streaming"
  ) {
    handleChatStreaming(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/ai/scene-name") {
    handleSceneName(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: `Route ${req.method}:${url.pathname} not found`, error: "Not Found", statusCode: 404 }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[${new Date().toISOString()}] Excalidraw AI backend on http://localhost:${PORT} (model: ${MODEL})`,
  );
});
