# excalidraw-selfhost

**Self-hosted Excalidraw+ alternative** — 登录、云场景、云素材库、AI 画图，全部自托管。

A drop-in self-hosted backend + frontend patches for [Excalidraw](https://github.com/excalidraw/excalidraw) that gives you the **Excalidraw+ experience** (sign in, cloud scenes, cloud library, AI text-to-diagram) **without the subscription** — data stays on your machine.

---

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
                                │ ws-backend     │   │ ai-backend     │   │ frontend       │
                                │ (Express+SQLite)│  │ (opencode-go)  │   │                │
                                └────────────────┘   └────────────────┘   └────────────────┘
```

- **ws-backend** (3020): JWT auth, scenes CRUD (`/api/scenes`), per-user key-value data (`/api/user-data/*` — library, TTD chats), share links. SQLite, zero config.
- **ai-backend** (3016): SSE proxy for Excalidraw's Text-to-Diagram → any OpenAI-compatible endpoint (default opencode.ai, model `deepseek-v4-flash`).
- **caddy** (3001): serves the built frontend + reverse-proxies `/ws-api` and `/ai-proxy`. HTTPS with local (self-signed) certs so cloudflared uses HTTP/2.
- **cloudflared**: optional — exposes your instance via a Cloudflare Tunnel (no open ports, no DNS setup).

## Quick start

Requires: macOS (launchd), Node ≥ 24 (better-sqlite3 ABI), a local clone of `excalidraw/excalidraw` (patched & built — see below), optionally Cloudflare Tunnel.

```bash
git clone https://github.com/Thunsis/excalidraw-selfhost.git
cd excalidraw-selfhost

cp .env.example .env        # fill in your values
./install.sh --dry-run      # generates deploy/generated/* (check them)
./install.sh                # symlinks launchd agents, ready to bootstrap
```

### Frontend (patches)

The frontend customization lives in `frontend/patches/`:

```bash
# in your excalidraw monorepo clone (pinned: v0.18.x / commit 1acf66e)
cd /path/to/excalidraw

git apply /path/to/excalidraw-selfhost/frontend/patches/custom.diff
cp -r /path/to/excalidraw-selfhost/frontend/patches/new-files/ .

yarn build                 # produces excalidraw-app/build/
```

The patch set is a **snapshot against upstream commit `1acf66e`** — if upstream moved on, expect conflicts; resolve, rebuild, and re-export with:

```bash
git diff > custom.diff     # after your changes, re-export the patch
```

> The patches pin Excalidraw to that commit for reproducible builds. Upgrading is a deliberate, documented process (see `docs/upgrade.md`).

### Auth model

Simple by design: **username IS the credential** (no password, registration closed). Suitable for private/self-hosted use. **Do not expose to the public internet** without adding real auth.

## Project layout

```
backend/        ws-backend (Express + better-sqlite3 + JWT)
ai-backend/     AI text-to-diagram SSE proxy
frontend/patches/  Excalidraw frontend customization (diff + new files)
deploy/templates/  plist + Caddyfile templates (rendered by install.sh)
install.sh      generate config + install launchd agents (idempotent)
```

## Data & backup

- SQLite at `WS_DATA_DIR` (default `backend/data/workspace.db`) — scenes, library, chat history, users.
- Backup while running: `sqlite3 workspace.db ".backup 'backup-$(date +%F).db'"` (WAL-safe).

## License

MIT — code here is independent of Excalidraw's MIT license; patches are against Excalidraw (MIT) upstream.
