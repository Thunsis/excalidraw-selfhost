/**
 * Command implementations for the excalidraw CLI.
 */
"use strict";

const fs = require("fs");
const api = require("./api");
const config = require("./config");
const ai = require("./ai");
const mermaid = require("./mermaid");
const official = require("./official");

function requireUsername(opts) {
  const u = opts.username || config.username;
  if (!u) {
    throw new Error(
      "username required — pass --username <name> or set EXCALIDRAW_WS_USER",
    );
  }
  return u;
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fmtTime(ts) {
  return String(ts || "").slice(0, 16);
}

// ── commands ────────────────────────────────────────────────────────────────

async function cmdList(opts) {
  const u = requireUsername(opts);
  const data = await api.listScenes(u);
  if (opts.json) {
    console.log(JSON.stringify(data.scenes, null, 2));
    return;
  }
  for (const s of data.scenes || []) {
    console.log(`${String(s.id).padEnd(5)} ${fmtTime(s.updated_at).padEnd(16)} ${s.name}`);
  }
}

async function cmdShow(id, opts) {
  const u = requireUsername(opts);
  const scene = await api.getScene(u, id);
  const elements = Array.isArray(scene.elements) ? scene.elements : [];
  const types = {};
  for (const el of elements) {
    types[el.type] = (types[el.type] || 0) + 1;
  }
  if (opts.json) {
    console.log(JSON.stringify(scene, null, 2));
    return;
  }
  console.log(`#${scene.id}  ${scene.name}`);
  console.log(`created: ${scene.createdAt}  updated: ${scene.updatedAt}`);
  console.log(`elements: ${elements.length}`);
  for (const [t, n] of Object.entries(types)) {
    console.log(`  ${t}: ${n}`);
  }
}

async function cmdCreate(name, file, opts) {
  const u = requireUsername(opts);
  const elements = file ? readJsonFile(file) : [];
  if (!Array.isArray(elements)) {
    throw new Error("elements file must contain a JSON array");
  }
  const res = await api.createScene(u, {
    name,
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
  });
  console.log(`✅ created #${res.id}  ${name}  (${elements.length} elements)`);
}

async function cmdUpdate(id, opts) {
  const u = requireUsername(opts);
  const patch = {};
  if (opts.name !== undefined) patch.name = opts.name;
  if (opts.elements) patch.elements = readJsonFile(opts.elements);
  if (Object.keys(patch).length === 0) {
    throw new Error("nothing to update — pass --name and/or --elements");
  }
  await api.updateScene(u, id, patch);
  console.log(`✅ updated #${id}`);
}

async function cmdDelete(id, opts) {
  const u = requireUsername(opts);
  await api.deleteScene(u, id);
  console.log(`✅ deleted #${id}`);
}

async function cmdAi(prompt, opts) {
  const u = requireUsername(opts);
  if (opts.dryRun) {
    // print the Mermaid definition only, no save
    const mmd = await ai.textToDiagram(prompt);
    console.log(mmd);
    return;
  }
  const mmd = await ai.textToDiagram(prompt);
  const elements = opts.local
    ? mermaid.convertMermaid(mmd)
    : await official.convertMermaid(mmd);
  const name =
    opts.name || `AI: ${prompt.slice(0, 40).replace(/\s+/g, " ").trim()}`;
  const res = await api.createScene(u, {
    name,
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
  });
  console.log(`✅ AI canvas #${res.id}  ${name}  (${elements.length} elements)`);
  if (opts.verbose) {
    console.log("── mermaid ──");
    console.log(mmd);
  }
}

async function cmdMermaid(file, opts) {
  const u = requireUsername(opts);
  const mmd = fs.readFileSync(file, "utf8");
  const elements = opts.local
    ? mermaid.convertMermaid(mmd)
    : await official.convertMermaid(mmd);
  const name =
    opts.name || `Mermaid: ${file.replace(/\.mmd$/, "").split("/").pop()}`;
  const res = await api.createScene(u, {
    name,
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
  });
  console.log(`✅ mermaid canvas #${res.id}  ${name}  (${elements.length} elements)`);
}

async function cmdExport(id, file, opts) {
  const u = requireUsername(opts);
  const scene = await api.getScene(u, id);
  if (opts.png) {
    const { elementsToPng } = require("./png");
    const outFile = file || `scene-${id}.png`;
    const png = await elementsToPng(scene.elements);
    fs.writeFileSync(outFile, png);
    console.log(`✅ exported #${id} → ${outFile} (${scene.elements.length} elements, PNG)`);
    return;
  }
  const out = JSON.stringify(scene.elements, null, 1);
  if (file) {
    fs.writeFileSync(file, out);
    console.log(`✅ exported #${id} → ${file} (${scene.elements.length} elements)`);
  } else {
    console.log(out);
  }
}

async function cmdLibrary(action, file, opts) {
  const u = requireUsername(opts);
  if (action === "get") {
    const data = await api.getUserData(u, "library");
    const value = data.value ?? null;
    if (file) {
      fs.writeFileSync(file, JSON.stringify(value, null, 1));
      console.log(`✅ library → ${file}`);
    } else {
      console.log(JSON.stringify(value, null, 1));
    }
  } else if (action === "put") {
    if (!file) throw new Error("library put requires a JSON file");
    const value = readJsonFile(file);
    await api.putUserData(u, "library", value);
    console.log("✅ library uploaded");
  } else {
    throw new Error("library action must be get|put");
  }
}

async function cmdDoctor(opts) {
  const checks = [];
  const probe = async (name, fn) => {
    try {
      await fn();
      checks.push({ name, ok: true });
    } catch (e) {
      checks.push({ name, ok: false, err: e.message });
    }
  };
  await probe("ws-server API", async () => {
    const res = await fetch(`${config.wsApi}/api/scenes`, {
      headers: { Authorization: "Bearer invalid" },
    });
    if (res.status !== 401 && res.status !== 200) {
      throw new Error(`unexpected HTTP ${res.status}`);
    }
  });
  await probe("ai-server SSE", async () => {
    const res = await fetch(`${config.aiApi}/v1/ai/text-to-diagram/chat-streaming`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    if (res.status !== 400 && res.status !== 200) {
      throw new Error(`unexpected HTTP ${res.status}`);
    }
  });
  await probe("official converter (pure node)", async () => {
    const official = require("./official");
    const els = await official.convertMermaid(
      ["flowchart TD", "  A[OK] --> B[OK]"].join("\n"),
    );
    if (!Array.isArray(els) || els.length < 2) {
      throw new Error(`converter returned ${els.length} elements`);
    }
  });
  if (opts.username || config.username) {
    await probe("login", async () => {
      await api.login(requireUsername(opts));
    });
  }
  for (const c of checks) {
    console.log(`${c.ok ? "✅" : "❌"} ${c.name}${c.err ? ` — ${c.err}` : ""}`);
  }
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

module.exports = {
  cmdList,
  cmdShow,
  cmdCreate,
  cmdUpdate,
  cmdDelete,
  cmdAi,
  cmdMermaid,
  cmdExport,
  cmdLibrary,
  cmdDoctor,
};
