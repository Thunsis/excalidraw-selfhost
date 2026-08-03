# Architecture & Design Notes

Implementation details behind the README — how the CLI pipeline works, why
certain diagrams are unsupported, how the frontend cloud UX is wired, and how
everything is verified. You don't need any of this to use the project; read
it when you want to modify or extend it.

---

## 1. CLI pipeline — pure Node, official packages only

`cli/` + `bin/excalidraw` (symlinked into `~/.npm-global/bin`). Zero browser
dependency: conversion and PNG export both run the **exact same official
packages the in-app AI uses** — no custom converters, no custom fields.

### 1.1 Mermaid → Excalidraw conversion

1. **jsdom simulates a DOM** — mermaid rendering needs one. Same environment
   mermaid's own CI uses.
2. `@excalidraw/mermaid-to-excalidraw@2.2.2` `parseMermaidToExcalidraw` runs
   the real mermaid render and reads node coordinates/sizes from the SVG DOM.
3. `@excalidraw/element@0.18.0-ffcb67b` (npm, same version the frontend pins)
   `convertToExcalidrawElements` completes the elements (fonts, bindings,
   fill, z-order, wrapping — all decided by the official library).
4. Outside a DOM, the official escape hatch `setCustomTextMetricsProvider`
   provides text width estimation (only affects estimated box width, never
   element fields).

The official converter has hard limits (see §3) — the CLI fails loudly
instead of silently saving a raster image.

### 1.2 PNG export

`excalidraw export <id> out.png --png` → `cli/src/png.js`:

- Official `exportToCanvas` (esbuild-bundled from `@excalidraw/excalidraw`
  into `cli/vendor/excalidraw-export.cjs`, rebuilt via
  `npx esbuild vendor/entry.mjs --bundle --format=cjs --platform=node` — must
  have `react`/`react-dom` installed or the bundle loses exportToCanvas).
- jsdom's `HTMLCanvasElement` is given a real Canvas 2D via
  `canvas@npm:@napi-rs/canvas` (npm alias). jsdom 24 resolves the canvas
  implementation by `require("canvas")` directly — the alias is what makes
  the renderer real.
- PNG bytes come from `canvas.toDataURL("image/png")`.

**Known environment quirks (all fixed in `cli/src/official.js` ensureDom):**

- **Double-instance trap**: `require("canvas")` (alias, separate module copy)
  and `require("@napi-rs/canvas")` are two instances with **two GlobalFonts
  registries**. Fonts must be registered on the alias instance or fillText
  silently draws nothing.
- **Font slices must be merged via `GlobalFonts.loadFontsFromDir(fonts/ttf/)`** —
  per-file `registerFromPath` with the same family name overwrites, leaving
  only the last slice's glyphs (silent blank text).
- The mermaid measurement polyfill must **skip the `getContext` stub when the
  real canvas is attached**, or it shadows the real render context (all-black
  image).
- `document.fonts` needs a stub with `has()` (newer `loadFontFaces` uses
  `has`, not `check`); returning `true` skips FontFace loading — fonts are
  resolved from the canvas GlobalFonts registry instead.
- `exportToCanvas` requires `files: new Map()` (null crashes on `files.has`)
  and `appState.exportPadding / exportBackground / viewBackgroundColor /
  exportScale`.

### 1.3 Fonts

- **Excalifont** (handwritten, SIL OFL) ships as 7 woff2 unicode slices in
  `cli/fonts/`; `npm run fonts` (`cli/scripts/convert-fonts.js`, wawoff2)
  converts them to ttf in `fonts/ttf/` for canvas rasterization.
- **Real font metrics, no magic coefficients**: `cli/src/metrics.js` reads
  the system Trebuchet MS hmtx table via opentype.js (mermaid's default
  font-stack head) for text width measurement; CJK codepoints use 1em square
  (browser falls back to a CJK font). Fallback 0.5em only when no font file
  exists.
- **In-browser CJK handwriting**: the patched frontend calls
  `Fonts.loadElementsFonts(elements)` after `updateScene` so scenes (incl.
  CLI-made ones) preload the Xiaolai handwritten CJK slices — otherwise
  Chinese text renders in system fonts. Xiaolai ships as 209 unicode-range
  slices and canvas rendering never triggers lazy loading on its own.

### 1.4 jsdom polyfills for mermaid

`ensureDom()` in `cli/src/official.js`:

- `getBoundingClientRect` (htmlLabels label divs): estimated = full-width
  char × font-size, height = font-size × 1.5, with manual max-width
  (`200px`) word wrap simulation.
- `getBBox`: implemented with child-union semantics — rect from
  width/height attributes, **polygon from points** (diamonds!), foreignObject
  returns 0, union skips text/tspan, empty groups return 0.
- `getComputedTextLength` on `dom.window.SVGTextElement.prototype` (jsdom's
  SVGTextElement is not on the global) — feeds mermaid's word-wrap.
- `Node.prototype.getBBox` fallback for HTML/Text nodes (class diagrams call
  getBBox on label elements; would crash without it).
- `CSSStyleSheet`, `btoa/atob`, `DOMParser`, `requestAnimationFrame`.
- English width coefficient 0.5em only inside the old fallback estimator;
  CJK 1.0em, space 0.3em.
- **Process hang**: jsdom's rAF timers keep Node alive — `bin/excalidraw`
  calls `process.exit` explicitly.

## 2. Diagram type support — official converter boundaries

Verified against a real browser (playwright, verification only): the
limitations below are the official `mermaid-to-excalidraw` converter's, not
the jsdom environment's — a browser gets the same results.

| Type | CLI (pure Node) | Browser (frontend AI) |
|---|---|---|
| flowchart (TD/LR/BT/RL, 中文/English, long text, diamonds) | ✅ full, pixel-aligned with browser | ✅ full |
| sequenceDiagram | ✅ converts (line edge points null is an official quirk, renders fine) | ✅ same |
| classDiagram / erDiagram / stateDiagram / gantt | ⚠️ rejected with a clear error | ⚠️ same fallback (raster graphImage) |

Root cause: mermaid 11 changed the SVG ids the converter queries
(`classId-*`, `entity-*`, `State node element not found` …).

## 3. Verification

```bash
cd cli && node tests/regression-official.js
# 7 cases: flowchart strict (zero-size/NaN checks) + sequence known-boundary
# exemption + class/er/state/gantt downgrade-protection (must raise error)
```

Pure-Node output is additionally compared element-by-element against a real
browser run (mcphub → playwright MCP, verification channel only): shape
sizes within ~4%, y-range within ~2%.

## 4. Frontend cloud UX design

The patched frontend's cloud features rest on three decisions:

1. **One auth store** — all token reads go through a module-level store
   (`workspaceCloud.ts`: `getToken` / `setAuth` / `clearAuth`); no component
   reads localStorage directly, so sign-out can only happen through the UI
   and every consumer stays consistent by construction.
2. **Two intents, two dialogs** — `ws:open-signin` → SignInDialog (pure
   login); `ws:open-workspace` → WorkspaceDialog (cloud scenes + Open file…).
   All ~15 entry points (top bar, welcome screen, hamburger menu, Save to
   Cloud, command palette, AI tools) dispatch the right intent.
3. **Library & AI follow the login state** — login pulls cloud library & AI
   chats in; sign-out falls back to local IndexedDB and unbinds the current
   scene (canvas keeps content, stops auto-saving).

## 5. Frontend customization — patch-as-single-source

- The upstream Excalidraw repo stays **pristine (0 uncommitted changes)**;
  all customization lives as a versioned patch set:
  `patch/excalidraw.patch` + `patch/new/` (new files).
- `make build` = restore → apply patch → corepack yarn build → restore.
  `make patch-export` re-exports the patch after editing code.
- Every custom entry point replaces a native one (no self-added UI), and all
  custom UI uses native components (Dialog / MainMenu.Item / WelcomeScreen /
  Sidebar …).

## 6. Deployment topology

```
caddy (3001) ── serves excalidraw-app/build/ + reverse-proxies /ws-api, /ai-proxy
 ├── ws-server (3020)  Express + better-sqlite3 + JWT; scenes CRUD, library, AI chats
 ├── ai-server (3016)  SSE proxy: /v1/ai/text-to-diagram/chat-streaming → OpenAI-compatible endpoint
 └── cloudflared       optional tunnel: draw.430812.xyz → caddy (no open ports)
```

- All 4 processes are launchd jobs (`com.excalidraw.{ws-backend,ai-backend,caddy,cloudflared}`);
  reload = `launchctl bootout` + `bootstrap` (kickstart does not re-read plists).
- Data lives in `apps/ws-server/data/` (gitignored): workspace.db, .jwt-secret,
  backups/. `make backup` = WAL-safe snapshot, 7 generations.
- Auth model: **username is the credential** (no passwords, registration
  closed) — private self-hosting only; do not expose publicly without real
  auth.
