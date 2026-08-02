# excalidraw-selfhost

**Self-hosted Excalidraw+ alternative** — 登录、云场景、云素材库、AI 画图，全部自托管，**禁止商用**（PolyForm Noncommercial 1.0.0）。

A drop-in self-hosted backend + frontend patches for [Excalidraw](https://github.com/excalidraw/excalidraw) that gives you the **Excalidraw+ experience** (sign in, cloud scenes, cloud library, AI text-to-diagram) **without the subscription** — data stays on your machine.

> **License**: PolyForm Noncommercial 1.0.0 — personal / non-commercial use free.
> Note: the patched Excalidraw frontend still contains MIT-licensed upstream code.

## Why

Excalidraw stores drawings in browser storage by default. Excalidraw+ (the official paid tier) adds cloud sync — but it's SaaS, and there is no official self-host path (see [excalidraw/excalidraw#1772](https://github.com/excalidraw/excalidraw/issues/1772), open since 2020 with 130+ 👍).

Existing self-host projects focus on **real-time collaboration**. This project fills the other gap: a **personal cloud workspace** — your scenes, your library, your AI assistant, on your own infra.

| Feature | excalidraw-selfhost | alswl/excalidraw-collaboration | Excalidraw+ (paid) |
|---|---|---|---|
| Sign in (username as key) | ✅ | ❌ | ✅ |
| Cloud scenes (per-user, SQLite) | ✅ | ❌ | ✅ |
| Cloud library sync | ✅ | ❌ | ✅ |
| AI text-to-diagram (self-hosted) | ✅ | ❌ | ✅ |
| Real-time collaboration | ❌ (roadmap) | ✅ | ✅ |
| Data ownership | ✅ 100% | ✅ | ❌ |

## Architecture

```
┌─────────────┐   https    ┌──────────────┐   HTTP/2   ┌───────────────┐
│   Browser   │ ─────────▶ │ cloudflared  │ ─────────▶ │ caddy (3001)  │
└─────────────┘   tunnel   └──────────────┘            └───────┬───────┘
                                          ┌────────────────────┼────────────────────┐
                                          ▼                    ▼                    ▼
                                ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
                                │ /ws-api → 3020 │   │ /ai-proxy→3016 │   │ build/ (static)│
                                │ ws-server      │   │ ai-server      │   │ frontend       │
                                │ (Express+SQLite)│  │ (opencode-go)  │   │ (patched)      │
                                └────────────────┘   └────────────────┘   └────────────────┘
```

- **ws-server** (3020): JWT auth, scenes CRUD (`/api/scenes`), per-user key-value data (`/api/user-data/*` — library, TTD chats), share links. SQLite, zero config.
- **ai-server** (3016): SSE proxy for Excalidraw's Text-to-Diagram → any OpenAI-compatible endpoint (default opencode.ai, model `deepseek-v4-flash`).
- **caddy** (3001): serves the built frontend + reverse-proxies `/ws-api` and `/ai-proxy`. HTTPS with local (self-signed) certs so cloudflared uses HTTP/2.
- **cloudflared**: optional — exposes your instance via a Cloudflare Tunnel (no open ports, no DNS setup).

## Quick start

Requires: macOS (launchd), Node ≥ 24 (better-sqlite3 ABI), a local clone of `excalidraw/excalidraw` (patched & built — see below), optionally Cloudflare Tunnel.

```bash
git clone https://github.com/Thunsis/excalidraw-selfhost.git
cd excalidraw-selfhost

cp .env.example .env            # fill in your values
make install --dry-run          # generates deploy/generated/* (check them)
make install                    # symlinks launchd agents + configs, ready to bootstrap
```

### Frontend (patch)

The frontend customization lives in `patch/` — a delta against a **pinned upstream commit** (`1acf66e`):

```bash
# in your excalidraw monorepo clone (pinned: 1acf66e)
cd /path/to/excalidraw
git apply /path/to/excalidraw-selfhost/patch/excalidraw.patch
cp -R /path/to/excalidraw-selfhost/patch/new/ .
corepack yarn build             # produces excalidraw-app/build/
```

Single-source workflow: patches are the only truth. After dev changes, re-export:

```bash
make patch-export               # re-export patches from a modified tree
make build                      # restore -> patch -> build -> restore
```

### Auth model

Simple by design: **username IS the credential** (no password, registration closed). Suitable for private/self-hosted use. **Do not expose to the public internet** without adding real auth.

## Data & privacy

- **All user data lives in SQLite** at `WS_DATA_DIR` (default `<repo>/apps/ws-server/data/`) — scenes, library, chat history, users. This directory is **gitignored** (`.gitignore: apps/ws-server/data/`) — your drawings never enter the repo or GitHub.
- JWT secret is auto-generated on first run at `<WS_DATA_DIR>/.jwt-secret` (mode 600) and persists across restarts.
- `make backup` — WAL-safe snapshot to `apps/ws-server/data/backups/`, keeps last 7.
- `make check` — healthcheck: ports + launchd + db integrity (cron-friendly, silent when healthy).

## Project layout

```
apps/            deployable applications (each with its own README)
  ws-server/     cloud workspace backend (Express + better-sqlite3 + JWT)
  ai-server/     AI text-to-diagram SSE proxy
patch/           frontend customization delta (excalidraw.patch + new/)
deploy/          platform-specific assembly (launchd / caddy / cloudflared)
scripts/         ops toolchain (install / apply-patch / build / backup / healthcheck)
docs/            architecture decisions, upgrade SOP, troubleshooting
Makefile         unified command entry (make install / build / backup / check / doctor)
```

## License

PolyForm Noncommercial 1.0.0 — see [LICENSE](LICENSE). Personal and non-commercial use is free; commercial use requires permission. The frontend patch is applied against Excalidraw (MIT) — upstream code remains MIT-licensed.
