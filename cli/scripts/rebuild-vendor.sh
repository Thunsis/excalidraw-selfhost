#!/bin/bash
# Rebuild the vendored export bundle (esbuild) and scrub official cloud config.
# Prereq: cli/node_modules present (react/react-dom installed — required or
# esbuild fails with ~84 unresolved errors and exportToCanvas goes missing).
# Usage: ./rebuild-vendor.sh
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild vendor/entry.mjs --bundle --format=cjs --platform=node --outfile=vendor/excalidraw-export.cjs
node scripts/strip-vendor-config.js
echo "✓ vendor/excalidraw-export.cjs rebuilt + stripped"
