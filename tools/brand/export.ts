/**
 * BrewCult brand export pipeline.
 *
 * Rasterizes the canonical SVGs in docs/brand/ into every PNG/ICO asset the
 * product needs, writing everything into tools/brand/dist/.
 *
 * Run:  npm install && npx tsx export.ts   (inside tools/brand)
 *
 * Rules honored (docs/brand/core-mark/USAGE.md):
 *  - 16px favicon uses brewcult-mark-small.svg (lug-ear construction is
 *    MANDATORY at <=24px); 32/48 use brewcult-mark.svg (loop ear).
 *  - Two colors only: espresso #3B2A20 / cream #F4EDE3 (badge is the single
 *    sanctioned exception: pure white #FFFFFF silhouette for web-push).
 *  - App-icon canvases come from brewcult-appicon.svg (the optically-centered
 *    full-bleed master) — the standalone mark is never pasted into them.
 *  - The flat cut and the sun/rim gap are geometry of the source SVGs; this
 *    script only rasterizes, never redraws. The verify step checks output
 *    dimensions; the 16px gap is additionally checked pixel-wise below.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAND = resolve(__dirname, "../../docs/brand");
const DIST = join(__dirname, "dist");

const ESPRESSO = "#3B2A20";
const CREAM = "#F4EDE3";
const WHITE = "#FFFFFF";

const SRC = {
  appicon: join(BRAND, "core-mark/svg/brewcult-appicon.svg"),
  mark: join(BRAND, "core-mark/svg/brewcult-mark.svg"),
  markSmall: join(BRAND, "core-mark/svg/brewcult-mark-small.svg"),
  markReversed: join(BRAND, "core-mark/svg/brewcult-mark-reversed.svg"),
  lockupH: join(BRAND, "wordmark/svg/brewcult-lockup-horizontal.svg"),
};

/** Set explicit pixel width/height on an SVG string so librsvg rasterizes at that size. */
function svgAtSize(svgText: string, width: number, height: number): Buffer {
  const sized = svgText.replace(
    /<svg\b/,
    `<svg width="${width}" height="${height}"`
  );
  return Buffer.from(sized);
}

function loadSvg(path: string): string {
  return readFileSync(path, "utf8");
}

/** Rasterize an SVG file to a square transparent-background PNG buffer. */
async function rasterSquare(svgPath: string, size: number): Promise<Buffer> {
  return sharp(svgAtSize(loadSvg(svgPath), size, size)).png().toBuffer();
}

async function writePng(name: string, buf: Buffer): Promise<void> {
  writeFileSync(join(DIST, name), buf);
  console.log(`  wrote ${name}`);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

async function exportAppIcons(): Promise<void> {
  // 1. icon-192 / icon-512 — full-bleed reversed master, as-is.
  for (const size of [192, 512]) {
    await writePng(`icon-${size}.png`, await rasterSquare(SRC.appicon, size));
  }
}

async function exportMaskable(): Promise<void> {
  // 2. Cream core mark centered inside the central 80% safe zone on a full
  //    espresso square, so any Android mask crop keeps the mark intact.
  for (const size of [192, 512]) {
    const markBox = Math.round(size * 0.8);
    const offset = Math.round((size - markBox) / 2);
    const mark = await rasterSquare(SRC.markReversed, markBox);
    const out = await sharp({
      create: { width: size, height: size, channels: 3, background: ESPRESSO },
    })
      .composite([{ input: mark, left: offset, top: offset }])
      .png()
      .toBuffer();
    await writePng(`maskable-${size}.png`, out);
  }
}

async function exportAppleTouch(): Promise<void> {
  // 3. apple-touch-icon-180 — appicon master, flattened, NO alpha channel.
  const buf = await sharp(svgAtSize(loadSvg(SRC.appicon), 180, 180))
    .flatten({ background: ESPRESSO })
    .removeAlpha()
    .png()
    .toBuffer();
  await writePng("apple-touch-icon-180.png", buf);
}

async function exportBadge(): Promise<void> {
  // 4. badge-96 — mark silhouette in PURE WHITE on transparency for web-push.
  //    The ear is a *stroked* circle: recolor both fill and stroke attributes
  //    in the SVG text before rasterizing, or the ear stays espresso.
  const recolored = loadSvg(SRC.mark)
    .replaceAll(`fill="${ESPRESSO}"`, `fill="${WHITE}"`)
    .replaceAll(`stroke="${ESPRESSO}"`, `stroke="${WHITE}"`);
  if (recolored.includes(ESPRESSO)) {
    throw new Error("badge recolor incomplete: espresso still present in SVG text");
  }
  const buf = await sharp(svgAtSize(recolored, 96, 96)).png().toBuffer();
  await writePng("badge-96.png", buf);
}

async function exportFavicons(): Promise<Buffer[]> {
  // 5+6. favicon PNGs and multi-size ICO. Per USAGE.md the 16px MUST come
  //      from the lug-ear small construction; 32/48 from the primary mark.
  const png16 = await rasterSquare(SRC.markSmall, 16);
  const png32 = await rasterSquare(SRC.mark, 32);
  const png48 = await rasterSquare(SRC.mark, 48);
  await writePng("favicon-16.png", png16);
  await writePng("favicon-32.png", png32);
  await writePng("favicon-48.png", png48);
  const ico = await pngToIco([png16, png32, png48]);
  writeFileSync(join(DIST, "favicon.ico"), ico);
  console.log("  wrote favicon.ico (16+32+48)");
  return [png16, png32, png48];
}

async function exportLockups(): Promise<void> {
  const lockupSvg = loadSvg(SRC.lockupH);
  const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(lockupSvg);
  if (!vb) throw new Error("lockup viewBox not found");
  const aspect = Number(vb[2]) / Number(vb[1]); // height / width

  // 7. og-1200x630 — lockup centered on cream, lockup width ≈ 60% of canvas.
  {
    const lockupW = Math.round(1200 * 0.6); // 720
    const lockupH = Math.round(lockupW * aspect);
    const lockup = await sharp(svgAtSize(lockupSvg, lockupW, lockupH)).png().toBuffer();
    const out = await sharp({
      create: { width: 1200, height: 630, channels: 3, background: CREAM },
    })
      .composite([
        {
          input: lockup,
          left: Math.round((1200 - lockupW) / 2),
          top: Math.round((630 - lockupH) / 2),
        },
      ])
      .removeAlpha()
      .png()
      .toBuffer();
    await writePng("og-1200x630.png", out);
  }

  // 8. email-header-800x240 — lockup on cream, left-aligned, 48px padding
  //    (2x asset for a ~400x120 CSS display size).
  {
    const pad = 48;
    const lockupW = 800 - pad * 2; // 704
    const lockupH = Math.round(lockupW * aspect);
    const lockup = await sharp(svgAtSize(lockupSvg, lockupW, lockupH)).png().toBuffer();
    const out = await sharp({
      create: { width: 800, height: 240, channels: 3, background: CREAM },
    })
      .composite([
        { input: lockup, left: pad, top: Math.round((240 - lockupH) / 2) },
      ])
      .removeAlpha()
      .png()
      .toBuffer();
    await writePng("email-header-800x240.png", out);
  }
}

function exportManifestIcons(): void {
  // 9. PWA manifest icons array snippet.
  const icons = [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];
  writeFileSync(join(DIST, "manifest-icons.json"), JSON.stringify({ icons }, null, 2) + "\n");
  console.log("  wrote manifest-icons.json");
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

interface Expectation {
  file: string;
  width: number;
  height: number;
  alpha?: boolean; // expected: does the file have an alpha channel?
}

const EXPECTATIONS: Expectation[] = [
  { file: "icon-192.png", width: 192, height: 192 },
  { file: "icon-512.png", width: 512, height: 512 },
  { file: "maskable-192.png", width: 192, height: 192 },
  { file: "maskable-512.png", width: 512, height: 512 },
  { file: "apple-touch-icon-180.png", width: 180, height: 180, alpha: false },
  { file: "badge-96.png", width: 96, height: 96, alpha: true },
  { file: "favicon-16.png", width: 16, height: 16, alpha: true },
  { file: "favicon-32.png", width: 32, height: 32, alpha: true },
  { file: "favicon-48.png", width: 48, height: 48, alpha: true },
  { file: "og-1200x630.png", width: 1200, height: 630, alpha: false },
  { file: "email-header-800x240.png", width: 800, height: 240, alpha: false },
];

/** Parse ICO directory: returns [width,height][] of contained images. */
function icoSizes(path: string): Array<[number, number]> {
  const b = readFileSync(path);
  if (b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) {
    throw new Error("favicon.ico: not an ICO file");
  }
  const count = b.readUInt16LE(4);
  const sizes: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const w = b[off] === 0 ? 256 : b[off];
    const h = b[off + 1] === 0 ? 256 : b[off + 1];
    sizes.push([w, h]);
  }
  return sizes;
}

/** badge-96 must be pure white: every visible pixel has r=g=b=255. */
async function checkBadgePureWhite(): Promise<string> {
  const { data, info } = await sharp(join(DIST, "badge-96.png"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a > 0 && (r !== 255 || g !== 255 || b !== 255)) {
      return `FAIL: non-white pixel rgba(${r},${g},${b},${a}) at index ${i / info.channels}`;
    }
  }
  return "ok: all visible pixels pure white";
}

/**
 * favicon-16 golden-rule check: the sun and the cup must remain separate
 * shapes, i.e. there is at least one fully-transparent horizontal gap row
 * between the lowest sun pixel and the rim, within the mark's central column
 * band. (USAGE.md rule 2: never shrink the gap below 1 rendered px.)
 */
async function checkFavicon16Gap(): Promise<string> {
  const { data, info } = await sharp(join(DIST, "favicon-16.png"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
  // Sun center column in the 202-unit viewBox is x=120-38=82/202 → px ≈ 6.5.
  const cols = [6, 7, 8];
  // Find rows in the upper half where the sun exists, then a clear row, then the rim.
  let sawSun = false;
  let sawGapAfterSun = false;
  for (let y = 0; y < info.height; y++) {
    const solid = cols.some((x) => alphaAt(x, y) > 128);
    if (solid && !sawGapAfterSun) sawSun = sawSun || true;
    if (sawSun && !solid) sawGapAfterSun = true;
    if (sawGapAfterSun && solid) {
      return "ok: sun, >=1px clear gap row, then cup — shapes separate";
    }
  }
  return sawGapAfterSun
    ? "FAIL: gap found but no cup below it"
    : "FAIL: no clear gap row between sun and cup at 16px";
}

async function verify(): Promise<boolean> {
  console.log("\nVerify:");
  const rows: string[][] = [["file", "expected", "actual", "status"]];
  let pass = true;

  for (const e of EXPECTATIONS) {
    const p = join(DIST, e.file);
    if (!existsSync(p)) {
      rows.push([e.file, `${e.width}x${e.height}`, "MISSING", "FAIL"]);
      pass = false;
      continue;
    }
    const meta = await sharp(p).metadata();
    const dimsOk = meta.width === e.width && meta.height === e.height;
    const alphaOk = e.alpha === undefined || meta.hasAlpha === e.alpha;
    const ok = dimsOk && alphaOk;
    pass = pass && ok;
    rows.push([
      e.file,
      `${e.width}x${e.height}${e.alpha === undefined ? "" : e.alpha ? " +alpha" : " no-alpha"}`,
      `${meta.width}x${meta.height}${meta.hasAlpha ? " +alpha" : " no-alpha"}`,
      ok ? "ok" : "FAIL",
    ]);
  }

  // favicon.ico entries
  const icoPath = join(DIST, "favicon.ico");
  if (!existsSync(icoPath)) {
    rows.push(["favicon.ico", "16,32,48", "MISSING", "FAIL"]);
    pass = false;
  } else {
    const sizes = icoSizes(icoPath).map(([w]) => w).sort((a, b) => a - b);
    const ok = JSON.stringify(sizes) === JSON.stringify([16, 32, 48]);
    pass = pass && ok;
    rows.push(["favicon.ico", "16,32,48", sizes.join(","), ok ? "ok" : "FAIL"]);
  }

  // manifest-icons.json parses and covers all four icon files
  const manPath = join(DIST, "manifest-icons.json");
  try {
    const man = JSON.parse(readFileSync(manPath, "utf8"));
    const ok =
      Array.isArray(man.icons) &&
      man.icons.length === 4 &&
      man.icons.every((i: { src: string }) =>
        existsSync(join(DIST, i.src.replace(/^\//, "")))
      );
    pass = pass && ok;
    rows.push(["manifest-icons.json", "4 icons, files exist", `${man.icons?.length ?? 0} icons`, ok ? "ok" : "FAIL"]);
  } catch {
    rows.push(["manifest-icons.json", "valid JSON", "unreadable", "FAIL"]);
    pass = false;
  }

  // Content checks
  const badgeCheck = await checkBadgePureWhite();
  pass = pass && badgeCheck.startsWith("ok");
  rows.push(["badge-96.png (color)", "pure #FFFFFF", badgeCheck, badgeCheck.startsWith("ok") ? "ok" : "FAIL"]);

  const gapCheck = await checkFavicon16Gap();
  pass = pass && gapCheck.startsWith("ok");
  rows.push(["favicon-16.png (gap)", "sun/cup separate", gapCheck, gapCheck.startsWith("ok") ? "ok" : "FAIL"]);

  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  for (const r of rows) {
    console.log("  " + r.map((cell, c) => cell.padEnd(widths[c])).join("  "));
  }
  return pass;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  for (const p of Object.values(SRC)) {
    if (!existsSync(p) || !statSync(p).isFile()) {
      throw new Error(`missing source SVG: ${p}`);
    }
  }
  mkdirSync(DIST, { recursive: true });

  console.log("Exporting brand assets to dist/ ...");
  await exportAppIcons();
  await exportMaskable();
  await exportAppleTouch();
  await exportBadge();
  await exportFavicons();
  await exportLockups();
  exportManifestIcons();

  const ok = await verify();
  if (!ok) {
    console.error("\nVerify FAILED — see table above.");
    process.exit(1);
  }
  console.log("\nAll assets verified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
