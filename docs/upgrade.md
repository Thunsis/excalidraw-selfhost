# Upgrade Guide

Excalidraw upstream moves fast. The patch set in `frontend/patches/` is a
snapshot against a pinned commit — upgrading is a **deliberate, quarterly**
process, not something you chase weekly.

## Upgrade flow (frontend)

```bash
# 1. Restore your customized working tree (patch already applied)
cd /path/to/excalidraw
git diff --stat          # should show the customization

# 2. Pull upstream (expect conflicts — that's normal)
git fetch origin
git stash                 # or commit your work first
git checkout <new-tag>
git stash pop

# 3. Re-apply this repo's patches (conflicts are resolved by hand)
git apply /path/to/excalidraw-selfhost/frontend/patches/custom.diff
cp -r /path/to/excalidraw-selfhost/frontend/patches/new-files/ .

# 4. Resolve conflicts, rebuild, verify
yarn build
curl -s -o /dev/null -w "%{http_code}" https://your.domain/

# 5. Re-export the patch so the repo stays current
git diff > /path/to/excalidraw-selfhost/frontend/patches/custom.diff
```

## Backends (ws / ai)

Both backends are independent of the frontend version — they speak a stable
HTTP contract (`/api/*`, `/v1/ai/*`). Upgrade them whenever you like:

```bash
cd excalidraw-selfhost
git pull
./install.sh          # regenerates launchd configs
for job in ws-backend ai-backend caddy cloudflared; do
  launchctl bootout gui/$(id -u)/com.excalidraw.$job 2>/dev/null
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.excalidraw.$job.plist
done
```

> `launchctl kickstart -k` does **not** re-read the plist after a symlink
> change — use `bootout` + `bootstrap` to load fresh config.

## Verifying after upgrade

```bash
# smoke test
curl -s -o /dev/null -w "%{http_code}\n" https://your.domain/                    # 200
TOKEN=$(curl -s -X POST https://your.domain/ws-api/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"you"}' | jq -r .token)
curl -s https://your.domain/ws-api/api/scenes -H "Authorization: Bearer $TOKEN"   # 200
curl -s https://your.domain/ws-api/api/user-data/library -H "Authorization: Bearer $TOKEN"
```

## Known pitfalls

- **better-sqlite3 ABI**: must run under the same Node major it was built
  with. On this repo, that's `/usr/local/bin/node` (v24). nvm's v25 will throw
  `ERR_DLOPEN_FAILED`. Reinstall deps with the matching node if you switch.
- **304 responses**: Express ETag handling means `GET /api/user-data/*` may
  return 304 — the frontend adapter treats non-2xx as "no cloud data" and
  falls back to local IndexedDB, then pushes local → cloud. This is by design.
- **Cloud write failures are now loud**: the frontend adapter serializes
  writes and `console.warn`s on HTTP errors (previously silent — the cause of
  "last library import not saved" bugs).
