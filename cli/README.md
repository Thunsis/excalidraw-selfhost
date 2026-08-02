# excalidraw CLI

Programmatic access to your self-hosted Excalidraw cloud workspace — including
the full **text-to-diagram → apply → save** pipeline, from the terminal or from
an AI agent.

```
bin/excalidraw          CLI entry (node, zero dependencies)
cli/src/config.js       env/.env configuration
cli/src/api.js          ws-server REST client (login, scenes, user-data)
cli/src/ai.js           text-to-diagram SSE client (ai-server)
cli/src/mermaid.js      lightweight Mermaid → Excalidraw elements converter
cli/src/builder.js      element builders (minimal field set restoreElements accepts)
cli/src/commands.js     command implementations
```

## Install

```bash
# from the repo root
npm link ./cli          # exposes `excalidraw` on PATH
# or run directly:
./bin/excalidraw --help
```

Requires Node >= 18 (built-in `fetch`), and a running ws-server (3020) +
ai-server (3016) — exactly what `make install` sets up.

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
2. **apply** — the built-in converter (`cli/src/mermaid.js`) parses the
   Mermaid (flowchart TD/LR/BT/RL and sequenceDiagram) and lays it out into
   Excalidraw elements. Zero dependencies: the official
   `@excalidraw/mermaid-to-excalidraw` needs a browser DOM (DOMPurify/SVG
   getBBox) and cannot run in plain Node, so we ship a purpose-built subset
   converter for exactly what text-to-diagram emits;
3. **save** — `POST /api/scenes` stores the canvas in your cloud account;
   open it in the web UI like any other scene.

## Design notes

- **Zero runtime dependencies** — Node built-ins only. No npm install needed
  for the CLI itself (only `npm link` to put it on PATH).
- **No secrets in the repo** — usernames/tokens come from env or CLI flags.
- **Faithful rendering** — elements use the minimal field set verified
  end-to-end against the patched frontend (`restoreElements` accepts it and
  the canvas renders correctly).
