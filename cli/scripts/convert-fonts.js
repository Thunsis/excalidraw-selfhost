/**
 * Convert the bundled Excalifont woff2 slices to ttf (resvg needs ttf/otf).
 * Run once after checkout: node scripts/convert-fonts.js
 * woff2 slices live in fonts/*.woff2, output goes to fonts/ttf/*.ttf.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { decompress } = require("wawoff2");

const fontsDir = path.join(__dirname, "..", "fonts");
const outDir = path.join(fontsDir, "ttf");

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const slices = fs
    .readdirSync(fontsDir)
    .filter((f) => f.endsWith(".woff2"))
    .sort();
  let total = 0;
  for (const f of slices) {
    const buf = fs.readFileSync(path.join(fontsDir, f));
    const ttf = await decompress(buf);
    const out = path.join(outDir, f.replace(/\.woff2$/, ".ttf"));
    fs.writeFileSync(out, Buffer.from(ttf));
    total += ttf.length;
    console.log(`✓ ${f} → ${(ttf.length / 1024).toFixed(0)}KB`);
  }
  console.log(`done: ${slices.length} slices, ${(total / 1024).toFixed(0)}KB ttf`);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
