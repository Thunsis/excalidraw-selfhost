# Frontend Patch Set

Customizations for the Excalidraw frontend, expressed as a **delta** against
a pinned upstream commit. This keeps the upstream repo pristine — patches are
the single source of truth.

## Contents

| File/Dir | Meaning |
|---|---|
| `excalidraw.patch` | modifications + deletions (git diff format) |
| `new/` | added files, mirroring upstream repo paths |

## Baseline

- **Upstream repo**: `excalidraw/excalidraw`
- **Pinned commit**: `1acf66e` (v0.18.x era, upstream `2026-07-28`)
- Do **not** apply to a newer checkout without expecting conflicts; upgrade
  is a deliberate process — see `docs/upgrade.md`.

## Apply

```bash
cd /path/to/excalidraw          # must be at the pinned baseline
git apply /path/to/excalidraw-selfhost/patch/excalidraw.patch
cp -R /path/to/excalidraw-selfhost/patch/new/ .
corepack yarn build             # produces excalidraw-app/build/
```

## What the patch does

- **Cloud workspace** (requires `apps/ws-server`): Sign in, cloud scenes,
  save-to-cloud, library cloud sync, AI chat history sync.
- **AI text-to-diagram** (requires `apps/ai-server`): TTD + Mermaid entries.
- **Language**: forced English (no language switcher).
- **Removals**: presentation player, wireframe-to-code, Excalidraw+ firebase
  export, floating cloud panel.

## Re-export after changes

```bash
./scripts/apply-patch.sh /path/to/excalidraw --export
```
