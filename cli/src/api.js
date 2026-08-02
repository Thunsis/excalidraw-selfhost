/**
 * ws-server API client — login + scenes CRUD + user-data.
 * Node >= 18 (global fetch). Zero dependencies.
 */
"use strict";

const config = require("./config");

let cachedToken = null;

async function login(username) {
  const res = await fetch(`${config.wsApi}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`login failed (HTTP ${res.status}): ${body.error || res.statusText}`);
  }
  const data = await res.json();
  cachedToken = data.token;
  return data;
}

async function getToken(username) {
  if (!cachedToken) {
    await login(username);
  }
  return cachedToken;
}

async function request(username, method, path, body) {
  const token = await getToken(username);
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${config.wsApi}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`${method} ${path} failed (HTTP ${res.status}): ${errBody.error || res.statusText}`);
  }
  return res.json();
}

module.exports = {
  login,
  request,
  /** scenes */
  listScenes: (u) => request(u, "GET", "/api/scenes"),
  getScene: (u, id) => request(u, "GET", `/api/scenes/${id}`),
  createScene: (u, { name, elements, appState }) =>
    request(u, "POST", "/api/scenes", { name, elements, appState }),
  updateScene: (u, id, patch) => request(u, "PUT", `/api/scenes/${id}`, patch),
  deleteScene: (u, id) => request(u, "DELETE", `/api/scenes/${id}`),
  /** user-data (library / ttd chats) */
  getUserData: (u, key) => request(u, "GET", `/api/user-data/${key}`),
  putUserData: (u, key, value) =>
    request(u, "PUT", `/api/user-data/${key}`, { value }),
};
