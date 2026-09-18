// ─────────────────────────────────────────────────────────────────────────────
// tools/gen-app-assets.js
//
// One-shot generator for the Capacitor "resources" folder used by
// @capacitor/assets. Produces:
//   resources/icon.png     — 1024×1024 app icon        (orange bg + 🐾 glyph)
//   resources/splash.png   — 2732×2732 splash screen   (orange bg + 🐾 glyph)
//   resources/icon-foreground.png — 1024×1024 foreground for adaptive icon
//   resources/icon-background.png — 1024×1024 solid orange background
//
// After running this, `npx capacitor-assets generate --android` slices the
// PNGs into every required density under android/app/src/main/res/.
//
// Usage:  node tools/gen-app-assets.js
// ─────────────────────────────────────────────────────────────────────────────
const fs   = require("fs");
const path = require("path");
const sharp = require("sharp");

const OUT = path.join(__dirname, "..", "resources");
fs.mkdirSync(OUT, { recursive: true });

const BRAND_HEX      = "#E8670A"; // AFP orange (matches capacitor.config.json)
const BRAND_HEX_DARK = "#B84E00";
const WHITE          = "#FFFFFF";

function iconSvg(size, { withBg = true, glyphPct = 0.55 } = {}) {
  const glyphSize = Math.round(size * glyphPct);
  const bg = withBg
    ? `<rect width="${size}" height="${size}" fill="${BRAND_HEX}"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg}
  <text x="50%" y="50%"
        text-anchor="middle" dominant-baseline="central"
        font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif"
        font-size="${glyphSize}" fill="${WHITE}">🐾</text>
</svg>`;
}

function splashSvg(size) {
  const glyphSize = Math.round(size * 0.28);
  const titleSize = Math.round(size * 0.08);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%"  stop-color="${BRAND_HEX}"/>
      <stop offset="100%" stop-color="${BRAND_HEX_DARK}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <g fill="${WHITE}" font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif" text-anchor="middle">
    <text x="50%" y="48%" dominant-baseline="central" font-size="${glyphSize}">🐾</text>
    <text x="50%" y="72%" dominant-baseline="central" font-size="${titleSize}" font-weight="700">All For Pets</text>
  </g>
</svg>`;
}

async function writePng(file, svg) {
  await sharp(Buffer.from(svg)).png().toFile(file);
  console.log("wrote " + path.relative(process.cwd(), file));
}

(async () => {
  await writePng(path.join(OUT, "icon.png"),            iconSvg(1024));
  await writePng(path.join(OUT, "icon-foreground.png"), iconSvg(1024, { withBg: false, glyphPct: 0.65 }));
  // Solid orange background for the adaptive icon
  await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: BRAND_HEX },
  }).png().toFile(path.join(OUT, "icon-background.png"));
  console.log("wrote resources/icon-background.png");
  await writePng(path.join(OUT, "splash.png"),        splashSvg(2732));
  await writePng(path.join(OUT, "splash-dark.png"),   splashSvg(2732));
  console.log("\n✔ Asset sources generated. Now run:  npx capacitor-assets generate --android");
})().catch(err => { console.error(err); process.exit(1); });
