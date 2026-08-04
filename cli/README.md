# excalidraw CLI

Programmatic access to your self-hosted Excalidraw cloud workspace — including
the full **text-to-diagram → apply → save** pipeline, from the terminal or from
an AI agent.

```
bin/excalidraw          CLI entry (node, zero dependencies)
cli/src/config.js       env/.env configuration
cli/src/api.js          ws-server REST client (login, scenes, user-data)
cli/src/ai.js           text-to-diagram SSE client (ai-server)
cli/src/official.js     official conversion pipeline (pure Node: jsdom + mermaid + m2e)
cli/src/mermaid.js      built-in fallback converter (no browser required)
cli/src/builder.js      element builders (minimal field set restoreElements accepts)
cli/src/commands.js     command implementations
```

## Install

```bash
# from the repo root
ln -sf "$(pwd)/bin/excalidraw" ~/.npm-global/bin/   # exposes `excalidraw` on PATH
# or run directly:
./bin/excalidraw --help
```

Requires Node >= 18 (built-in `fetch`), and a running ws-server (3020) +
ai-server (3016) — exactly what `make install` sets up. The official
conversion path additionally needs **mcphub** (`localhost:3000`) with the
playwright MCP server registered (headless Chrome) — the same hub every agent
already uses.

## Usage

```
excalidraw list                       # scenes (id, updated, name)
excalidraw show <id> [--json]         # scene details / raw JSON
excalidraw create <name> [file.json]  # create from elements JSON
excalidraw update <id> [--name N] [--elements f.json]
excalidraw delete <id>
excalidraw ai "<prompt>"              # text-to-diagram → apply → save 🪄
excalidraw ai "<prompt>" --dry-run    # print Mermaid only, no save
excalidraw mermaid <file.mmd>         # convert a .mmd file into a canvas
excalidraw export <id> [out.json]     # dump elements JSON
excalidraw library get|put <file.json>
excalidraw doctor                     # environment self-check
```

### Auth

Username IS the credential (no password, by design). Pass it per call with
`--username <name>` or set `EXCALIDRAW_WS_USER`.

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `WS_API` | `http://127.0.0.1:3020` | ws-server base URL |
| `AI_API` | `http://127.0.0.1:3016` | ai-server base URL |
| `EXCALIDRAW_WS_USER` | — | default cloud account username |

Values are also picked up from the repo's `.env` if present.

## The AI pipeline

`excalidraw ai "画一个购物流程"` does three things:

1. **text-to-diagram** — streams `ai-server`'s SSE endpoint
   (`/v1/ai/text-to-diagram/chat-streaming`, backed by opencode.ai
   deepseek-v4-flash) and collects the Mermaid definition;
2. **apply** — the **official pipeline** (default): the exact converter the
   frontend AI uses — `@excalidraw/mermaid-to-excalidraw@2.2.2` imported from
   esm.sh inside a headless Chrome (via mcphub → playwright MCP), then
   materialized into full Excalidraw elements (bound text, arrow bindings,
   edge labels). Pass `--local` to fall back to the built-in zero-dependency
   converter (`cli/src/mermaid.js`, flowchart/sequenceDiagram subset) when the
   browser pipeline is unavailable;
3. **save** — `POST /api/scenes` stores the canvas in your cloud account;
   open it in the web UI like any other scene.

`excalidraw doctor` verifies all four dependencies (ws-server, ai-server,
mcphub → playwright, login).

## Design notes

- **Zero runtime dependencies** — Node built-ins only. No npm install needed
  for the CLI itself (only `npm link` to put it on PATH).
- **No secrets in the repo** — usernames/tokens come from env or CLI flags.
- **Faithful rendering** — elements use the minimal field set verified
  end-to-end against the patched frontend (`restoreElements` accepts it and
  the canvas renders correctly).
