/**
 * Lightweight Mermaid → Excalidraw elements converter.
 *
 * Design rationale: @excalidraw/mermaid-to-excalidraw needs a full browser
 * DOM (DOMPurify, SVG getBBox) and fails under plain Node/jsdom. Rather than
 * dragging a headless browser into the CLI, we parse the subset that
 * text-to-diagram actually produces — flowchart (TD/LR/BT/RL) and
 * sequenceDiagram — and lay them out with a simple longest-path grid.
 *
 * Zero dependencies. Output uses the minimal element field set that
 * restoreElements accepts (see builder.js).
 */
"use strict";

const b = require("./builder");
const { measureTextWidth } = require("./metrics");

const NODE_W = 160;
const NODE_H = 64;
const GAP_X = 100;
const GAP_Y = 110;
const COLORS = {
  fill: "#dbeafe",
  stroke: "#3b82f6",
  decisionFill: "#fef3c7",
  decisionStroke: "#f59e0b",
  termFill: "#dcfce7",
  termStroke: "#22c55e",
};

// ── helpers ────────────────────────────────────────────────────────────────

function textWidth(s, size = 16) {
  return measureTextWidth(s, size);
}

function stripQuotes(s) {
  return s.replace(/^["']|["']$/g, "").trim();
}

// ── flowchart parsing ───────────────────────────────────────────────────────

const NODE_RE =
  /^([A-Za-z0-9_]+)\s*(\[\[.*?\]\]|\[.*?\]|\(\(.*?\)\)|\(.*?\)|\{.*?\}|\[.*\]|\(.*\)|\{.*\})?/;

function parseNodeSpec(spec) {
  // spec like: A[text] | B{text} | C((text)) | D(text) | E[[text]] | F
  const m = String(spec).match(
    /^([A-Za-z0-9_]+)\s*(?:(\[\[)(.*?)(\]\])|(\[)(.*?)(\])|(\(\()(.*?)(\)\))|(\()(.*?)(\))|(\{)(.*?)(\})|(\[)(.*)(\])|(\()(.*)(\))|(\{)(.*)(\}))?$/,
  );
  if (!m) return null;
  const id = m[1];
  let text = null;
  let shape = "rect";
  if (m[3] !== undefined) {
    text = m[3];
    shape = "subproc";
  } else if (m[6] !== undefined) {
    text = m[6];
    shape = "rect";
  } else if (m[9] !== undefined) {
    text = m[9];
    shape = "circle";
  } else if (m[12] !== undefined) {
    text = m[12];
    shape = "rounded";
  } else if (m[15] !== undefined) {
    text = m[15];
    shape = "diamond";
  } else if (m[18] !== undefined) {
    text = m[18];
    shape = "rect";
  } else if (m[21] !== undefined) {
    text = m[21];
    shape = "rounded";
  } else if (m[24] !== undefined) {
    text = m[24];
    shape = "diamond";
  }
  return { id, text: text !== null ? stripQuotes(text) : id, shape };
}

const EDGE_RE = /^([A-Za-z0-9_]+)\s*(--|==|\.-|-->|==>|\.->|---|--x|--o)(.*)$/;

// 节点 spec:ID 或 ID 带形状定义(如 B[用户输入账号密码]、D{验证是否通过?})
const NODE_SPEC_RE =
  /^([A-Za-z0-9_]+)\s*(\[\[.*?\]\]|\[.*?\]|\(\(.*?\)\)|\(.*?\)|\{.*?\})?/;

function splitEdgeChain(rest) {
  // rest like: --> B --> C | -->|label| B[text] | -- label --> B | ==> B
  const parts = [];
  let s = rest.trim();
  while (s.length > 0) {
    // 1. arrow kind
    const am = s.match(/^(-->|==>|\.->|---|--x|--o|--|==|\.-)/);
    if (!am) break;
    const kind = am[1];
    s = s.slice(am[0].length).trim();
    // 2. label: |label| or "text" between dashes (-- label -->)
    let label = null;
    const pipe = s.match(/^\|([^|]*)\|/);
    if (pipe) {
      label = stripQuotes(pipe[1]);
      s = s.slice(pipe[0].length).trim();
    } else {
      // -- label --> : a second arrow follows after some text
      const long = s.match(/^(.+?)\s+(-->|==>|\.->|---|--x|--o|--|==|\.-)/);
      if (long && long[1].trim()) {
        // only treat as label if there's a following arrow and current kind is a plain --
        if (kind === "--" || kind === "==" || kind === ".-") {
          label = stripQuotes(long[1].trim());
          s = s.slice(long[0].length).trim();
        }
      }
    }
    // 3. target node spec
    const tm = s.match(NODE_SPEC_RE);
    if (!tm) break;
    parts.push({ kind, label, targetSpec: tm[0].trim() });
    s = s.slice(tm[0].length).trim();
  }
  return { parts, remaining: s };
}

function parseFlowchart(lines, direction) {
  const nodes = new Map(); // id -> {id,text,shape}
  const edges = []; // {from,to,label,dashed,bold}
  const order = []; // node ids in first-seen order

  const ensureNode = (spec) => {
    const n = parseNodeSpec(spec);
    if (!n) return null;
    if (!nodes.has(n.id)) {
      nodes.set(n.id, n);
      order.push(n.id);
    } else if (n.text !== n.id) {
      // later definition may carry a label for an already-seen id
      nodes.get(n.id).text = n.text;
    }
    return n.id;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/%%.*$/, "").trim();
    if (!line || /^subgraph\b/i.test(line) || line === "end") continue;
    if (/^(flowchart|graph)\b/i.test(line)) continue; // header

    // pure node definition: "A[text]"（整行都是节点 spec 才算纯定义——
    // 不能用 "形状括号 + $ 锚点" 判断，惰性 .*? 会为满足 $ 吞掉行尾，
    // 把 "A[x] --> B[y]" 整行误判为纯定义）
    const firstFull = line.match(NODE_SPEC_RE);
    if (firstFull && firstFull[0].trim() === line) {
      ensureNode(line);
      continue;
    }

    // edge chain: "A[text] --> B --> C"  or  "A -->|label| B{text}"
    const first = line.match(NODE_SPEC_RE);
    if (!first) continue;
    const fromId = ensureNode(first[0].trim());
    const rest = line.slice(first[0].length).trim();
    const { parts, remaining } = splitEdgeChain(rest);
    if (parts.length === 0) continue;
    let cur = fromId;
    for (const p of parts) {
      const toId = ensureNode(p.targetSpec);
      if (cur && toId && cur !== toId) {
        edges.push({
          from: cur,
          to: toId,
          label: p.label,
          dashed: p.kind === ".->" || p.kind === ".-",
          bold: p.kind === "==>" || p.kind === "==",
        });
      }
      cur = toId;
    }
    // trailing node spec not consumed as edge target (e.g. "A --> B" already handled)
    void remaining;
  }

  return { nodes, edges, order };
}

// ── layout (longest-path layering) ─────────────────────────────────────────

function computeLevels(nodeIds, edges) {
  const level = new Map();
  const parents = new Map(); // node -> set of parent ids
  for (const id of nodeIds) level.set(id, 0);
  for (const e of edges) {
    if (!parents.has(e.to)) parents.set(e.to, new Set());
    parents.get(e.to).add(e.from);
  }
  // iterative longest-path (bounded to avoid cycles)
  let changed = true;
  let guard = 0;
  while (changed && guard < nodeIds.length * 2) {
    changed = false;
    guard++;
    for (const e of edges) {
      const lFrom = level.get(e.from);
      const lTo = level.get(e.to);
      if (lFrom !== undefined && lTo !== undefined && lFrom + 1 > lTo) {
        level.set(e.to, lFrom + 1);
        changed = true;
      }
    }
  }
  return level;
}

function layoutFlowchart(parsed, direction) {
  const { nodes, edges, order } = parsed;
  const nodeIds = order.length ? order : [...nodes.keys()];
  const levels = computeLevels(nodeIds, edges);

  // group by level, keep first-seen order
  const byLevel = new Map();
  for (const id of nodeIds) {
    const l = levels.get(id) ?? 0;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l).push(id);
  }

  const pos = new Map(); // id -> {x, y, w, h}
  const horizontal = direction === "LR" || direction === "RL";
  const maxInLevel = new Map();
  for (const [l, ids] of byLevel) {
    ids.forEach((id) => {
      const n = nodes.get(id);
      const tw = textWidth(n.text || id, 16);
      const w = Math.max(NODE_W, Math.min(tw + 48, 360));
      const h = NODE_H;
      pos.set(id, { w, h });
      maxInLevel.set(l, Math.max(maxInLevel.get(l) || 0, w));
    });
  }

  // assign coordinates
  const lvlIndex = new Map(); // level -> next index
  for (const [l, ids] of byLevel) {
    let idx = 0;
    for (const id of ids) {
      const { w, h } = pos.get(id);
      const col = idx;
      idx++;
      if (horizontal) {
        pos.set(id, { ...pos.get(id), x: l * (NODE_W + GAP_Y), y: col * (NODE_H + GAP_X) });
      } else {
        pos.set(id, { ...pos.get(id), x: col * (w + GAP_X), y: l * (NODE_H + GAP_Y) });
      }
    }
  }

  return { nodes, edges, pos, horizontal };
}

function buildFlowchartElements(layout) {
  const { nodes, edges, pos, horizontal } = layout;
  const els = [];

  for (const id of pos.keys()) {
    const n = nodes.get(id);
    const p = pos.get(id);
    const label = n.text || id;
    const isDecision = n.shape === "diamond";
    const isTerm = n.shape === "circle" || n.shape === "subproc";
    const fill = isDecision ? COLORS.decisionFill : isTerm ? COLORS.termFill : COLORS.fill;
    const stroke = isDecision ? COLORS.decisionStroke : isTerm ? COLORS.termStroke : COLORS.stroke;

    if (n.shape === "diamond") {
      els.push(b.diamond(p.x, p.y, p.w, p.h, { fill, stroke }));
    } else if (n.shape === "circle") {
      els.push(b.ellipse(p.x, p.y, Math.max(p.w, p.h), Math.max(p.w, p.h), { fill, stroke }));
    } else {
      els.push(b.rect(p.x, p.y, p.w, p.h, { fill, stroke }));
    }
    // node label
    const lw = textWidth(label, 16);
    const lx = p.x + (p.w - lw) / 2;
    const ly = p.y + p.h / 2 - 10;
    els.push(b.text(lx, ly, label, { size: 16, color: "#1e1e1e" }));
  }

  // edges: connect boundaries (bottom→top for TD, right→left for LR)
  for (const e of edges) {
    const from = pos.get(e.from);
    const to = pos.get(e.to);
    if (!from || !to) continue;
    let x1, y1, x2, y2;
    if (horizontal) {
      x1 = from.x + from.w;
      y1 = from.y + from.h / 2;
      x2 = to.x;
      y2 = to.y + to.h / 2;
    } else {
      x1 = from.x + from.w / 2;
      y1 = from.y + from.h;
      x2 = to.x + to.w / 2;
      y2 = to.y;
    }
    const a = b.arrow(x1, y1, x2, y2, { dashed: e.dashed });
    if (e.bold) a.strokeWidth = 4;
    els.push(a);
    if (e.label) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      els.push(b.text(mx - textWidth(e.label, 12) / 2, my - 14, e.label, { size: 12, color: "#6b7280" }));
    }
  }

  return els;
}

// ── sequenceDiagram parsing ─────────────────────────────────────────────────

const MESSAGE_ARROWS = new Set([">>", "-->>", "->", "-->", "-\\", "--\\", "<<-", "--<<"]);

function parseSequence(lines) {
  const participants = []; // {id, name}
  const msgs = []; // {from, to, text, dashed, solid(solid arrow)}
  const pMap = new Map();

  const ensureParticipant = (id, name) => {
    if (!pMap.has(id)) {
      pMap.set(id, name || id);
      participants.push({ id, name: name || id });
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/%%.*$/, "").trim();
    if (!line || /^sequenceDiagram\b/i.test(line)) continue;

    const pm = line.match(/^(participant|actor)\s+([A-Za-z0-9_]+)(?:\s+as\s+(.+))?$/i);
    if (pm) {
      ensureParticipant(pm[2], pm[3] ? stripQuotes(pm[3].trim()) : null);
      continue;
    }
    // arrow kinds: solid(->>|->|-\)), dashed(-->>|-->|--\)), reverse(<<-|--<<)
    const mm = line.match(/^([A-Za-z0-9_]+)\s+(.+?)\s+([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (mm && MESSAGE_ARROWS.has(mm[2].trim())) {
      const from = mm[1];
      const kind = mm[2].trim();
      const to = mm[3];
      ensureParticipant(from);
      ensureParticipant(to);
      msgs.push({
        from,
        to,
        text: stripQuotes(mm[4]),
        dashed: kind.startsWith("--"),
        solid: kind.includes(">>"),
      });
    }
  }
  return { participants, msgs };
}

function buildSequenceElements(parsed) {
  const { participants, msgs } = parsed;
  const els = [];
  const P_W = 140;
  const P_H = 48;
  const GAP = 40;
  const MSG_H = 56;
  const LIFELINE_BOTTOM = P_H + 60 + msgs.length * MSG_H;

  participants.forEach((p, i) => {
    const x = i * (P_W + GAP);
    // participant box
    els.push(b.rect(x, 0, P_W, P_H, { fill: COLORS.fill, stroke: COLORS.stroke }));
    els.push(b.text(x + 10, 14, p.name, { size: 14 }));
    // lifeline
    const line = b.arrow(x + P_W / 2, P_H + 20, x + P_W / 2, LIFELINE_BOTTOM);
    line.endArrowhead = null;
    line.startArrowhead = null;
    line.strokeWidth = 1;
    line.strokeStyle = "dashed";
    line.opacity = 40;
    els.push(line);
  });

  msgs.forEach((m, i) => {
    const y = P_H + 40 + i * MSG_H;
    const fromIdx = participants.findIndex((p) => p.id === m.from);
    const toIdx = participants.findIndex((p) => p.id === m.to);
    if (fromIdx < 0 || toIdx < 0) return;
    const x1 = fromIdx * (P_W + GAP) + P_W / 2;
    const x2 = toIdx * (P_W + GAP) + P_W / 2;
    const a = b.arrow(x1, y, x2, y, { dashed: m.dashed });
    if (!m.solid) {
      a.startArrowhead = null;
      a.endArrowhead = null;
      a.strokeWidth = 1;
    }
    els.push(a);
    const tx = Math.min(x1, x2) + Math.abs(x2 - x1) / 2 - textWidth(m.text, 12) / 2;
    els.push(b.text(tx, y - 22, m.text, { size: 12, color: "#374151" }));
  });

  return els;
}

// ── entry ───────────────────────────────────────────────────────────────────

function convertMermaid(mermaidSource) {
  const lines = mermaidSource.split("\n");
  const header = lines.find((l) => /^(flowchart|graph|sequenceDiagram)\b/i.test(l.trim())) || "";
  const isSequence = /^sequenceDiagram\b/i.test(header.trim());
  const dirMatch = header.match(/\b(TD|TB|LR|RL|BT)\b/i);

  if (isSequence) {
    return buildSequenceElements(parseSequence(lines));
  }
  if (!/^(flowchart|graph)\b/i.test(header.trim())) {
    throw new Error(
      "Unsupported Mermaid type — supported: flowchart (TD/LR/BT/RL), sequenceDiagram",
    );
  }
  const direction = (dirMatch ? dirMatch[1].toUpperCase() : "TD").replace("TB", "TD");
  const parsed = parseFlowchart(lines, direction);
  if (parsed.nodes.size === 0) {
    throw new Error("No nodes found in flowchart definition");
  }
  return buildFlowchartElements(layoutFlowchart(parsed, direction));
}

module.exports = { convertMermaid };
