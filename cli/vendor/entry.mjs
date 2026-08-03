// Vendor entry — bundles the official export APIs into a CJS file usable
// from the CLI. Built with esbuild: npx esbuild vendor/entry.mjs --bundle
// --format=cjs --platform=node --outfile=vendor/excalidraw-export.cjs
export { exportToSvg, exportToCanvas } from "@excalidraw/excalidraw";
