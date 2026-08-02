#!/usr/bin/env node
/**
 * Excalidraw 自部署 workspace 后端
 * 登录 + 场景云保存（SQLite + JWT）
 *
 * 端口: 3020（前端通过 Vite proxy /ws-api 访问，同源免 CORS）
 * 数据库: ~/.excalidraw-ws/data/workspace.db
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const HOME = process.env.HOME || "";
// 数据目录：env 驱动（WS_DATA_DIR），默认 ./data（相对 repo，通用）
const DATA_DIR = process.env.WS_DATA_DIR || path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "workspace.db");
const PORT = Number(process.env.PORT || 3020);
const TOKEN_TTL = "30d";

// JWT secret：env 优先，否则持久化在数据目录（重启不失效）
const SECRET_FILE = process.env.JWT_SECRET_FILE || path.join(DATA_DIR, ".jwt-secret");
function loadSecret() {
  const env = process.env.JWT_SECRET;
  if (env) return env;
  if (fs.existsSync(SECRET_FILE)) {
    return fs.readFileSync(SECRET_FILE, "utf8").trim();
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}
const JWT_SECRET = loadSecret();

// --- DB ---
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Untitled canvas',
    elements TEXT NOT NULL DEFAULT '[]',
    app_state TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS share_links (
    id TEXT PRIMARY KEY,
    payload BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS user_data (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, key)
  );
`);

// user-data 键白名单（账号化存储：TTD 聊天历史 / Library 素材库 / 未来扩展）
const USER_DATA_KEYS = new Set(["ttd_chats", "library"]);

// --- Auth middleware ---
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(payload.uid);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired, please sign in again" });
  }
}

const app = express();
app.use(express.json({ limit: "60mb" }));

// 轻量日志
app.use((req, res, next) => {
  res.on("finish", () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode}`);
  });
  next();
});

// --- Auth routes ---
app.post("/api/auth/register", (req, res) => {
  // 注册已关闭：本实例仅限内部已知账号，防止外部注册
  res.status(403).json({ error: "注册已关闭" });
});

app.post("/api/auth/login", (req, res) => {
  // 简化登录：用户名即密钥（注册已关闭，实例仅内部使用）
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: "Username is required" });
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) return res.status(401).json({ error: "User not found" });
  const token = jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, user: { id: user.id, username: user.username } });
});

app.get("/api/auth/me", auth, (req, res) => {
  res.json({ user: req.user });
});

// --- Scene routes (全部需登录) ---
app.get("/api/scenes", auth, (req, res) => {
  const rows = db.prepare(
    "SELECT id, name, created_at, updated_at FROM scenes WHERE user_id = ? ORDER BY updated_at DESC",
  ).all(req.user.id);
  res.json({ scenes: rows });
});

app.get("/api/scenes/:id", auth, (req, res) => {
  const row = db.prepare("SELECT * FROM scenes WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Canvas not found" });
  let elements = row.elements;
  let appState = row.app_state;
  try { elements = JSON.parse(row.elements); } catch {}
  try { appState = JSON.parse(row.app_state); } catch { appState = {}; }
  res.json({ id: row.id, name: row.name, elements, appState, createdAt: row.created_at, updatedAt: row.updated_at });
});

app.post("/api/scenes", auth, (req, res) => {
  const { name, elements, appState } = req.body || {};
  const info = db.prepare(
    "INSERT INTO scenes (user_id, name, elements, app_state) VALUES (?, ?, ?, ?)",
  ).run(req.user.id, name || "Untitled canvas", JSON.stringify(elements || []), JSON.stringify(appState || {}));
  res.json({ id: info.lastInsertRowid });
});

app.put("/api/scenes/:id", auth, (req, res) => {
  const { name, elements, appState } = req.body || {};
  const existing = db.prepare("SELECT id FROM scenes WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: "Canvas not found" });
  db.prepare(
    `UPDATE scenes SET
       name = COALESCE(?, name),
       elements = COALESCE(?, elements),
       app_state = COALESCE(?, app_state),
       updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  ).run(
    name ?? null,
    elements !== undefined ? JSON.stringify(elements) : null,
    appState !== undefined ? JSON.stringify(appState) : null,
    req.params.id,
    req.user.id,
  );
  res.json({ ok: true });
});

app.delete("/api/scenes/:id", auth, (req, res) => {
  const info = db.prepare("DELETE FROM scenes WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: "Canvas not found" });
  res.json({ ok: true });
});

// --- User-data routes (账号化通用存储：TTD 历史 / Library 等，全部需登录) ---
app.get("/api/user-data/:key", auth, (req, res) => {
  if (!USER_DATA_KEYS.has(req.params.key)) {
    return res.status(400).json({ error: "Unknown data key" });
  }
  const row = db
    .prepare("SELECT value FROM user_data WHERE user_id = ? AND key = ?")
    .get(req.user.id, req.params.key);
  res.json({ key: req.params.key, value: row ? JSON.parse(row.value) : null });
});

app.put("/api/user-data/:key", auth, (req, res) => {
  if (!USER_DATA_KEYS.has(req.params.key)) {
    return res.status(400).json({ error: "Unknown data key" });
  }
  const { value } = req.body || {};
  if (value === undefined || value === null) {
    return res.status(400).json({ error: "value is required" });
  }
  db.prepare(
    `INSERT INTO user_data (user_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(req.user.id, req.params.key, JSON.stringify(value));
  res.json({ ok: true });
});

// --- Share links (self-hosted replacement for json.excalidraw.com) ---
// Payload is binary (compressed + encrypted); the link's #json=id,key IS the key,
// so these routes are intentionally unauthenticated.
app.post(
  "/api/share",
  express.raw({ type: () => true, limit: "20mb" }),
  (req, res) => {
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Empty payload" });
    }
    const id = crypto.randomBytes(8).toString("base64url");
    db.prepare("INSERT INTO share_links (id, payload) VALUES (?, ?)").run(
      id,
      req.body,
    );
    res.json({ id });
  },
);

app.get("/api/share/:id", (req, res) => {
  const row = db
    .prepare("SELECT payload FROM share_links WHERE id = ?")
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "Share link not found" });
  res.type("application/octet-stream").send(row.payload);
});

app.get("/", (req, res) => res.json({ service: "excalidraw-workspace-backend", version: "1.0.0" }));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[${new Date().toISOString()}] Excalidraw workspace backend on http://127.0.0.1:${PORT} (db: ${DB_PATH})`);
});
