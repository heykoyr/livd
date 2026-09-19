/**
 * Derives every generated brand asset from its master.
 *
 * `public/brand/logo/` holds the official logo and symbol, exactly as
 * supplied; the web copies `<Logo>` renders are fitted from those. The icons
 * are still drawn from `public/brand/livd-mark.svg`. Nothing here redraws
 * either — paths are read out of the masters, so a derived file can never
 * drift from its source the way hand-exported assets always eventually do.
 *
 * Run it when the master changes, not on every build: the outputs are committed
 * so that `next build` needs no image toolchain at all.
 *
 *   node scripts/build-brand-assets.mjs
 *
 * `sharp` does the rasterising. It arrives as an optional dependency of Next's
 * image optimiser rather than as one of ours, which is fine for a design-time
 * script and would not be fine for anything in the request path.
 */

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error(
    'This script needs `sharp` to rasterise the mark. Install it with `npm i -D sharp`.',
  );
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...parts) => join(root, ...parts);

/* --- The master ------------------------------------------------------- */

const MASTER = readFileSync(p('public/brand/livd-mark.svg'), 'utf8');
const PATH = MASTER.match(/ d="([^"]+)"/)?.[1];
if (!PATH) throw new Error('No path found in public/brand/livd-mark.svg');

/** The master is drawn on a 48 unit box and fills it exactly. */
const BOX = 48;

/* --- Palette ----------------------------------------------------------
   Held here rather than read out of globals.css because these are the fixed
   values baked into raster files; `tests/design/brand-mark.test.ts` asserts
   they still match the tokens. */
const PAPER = '#FBFAF8'; // --color-canvas, light
const EVERGREEN = '#12312A'; // --color-brand, light
const SAGE = '#D8E4DE'; // --color-brand, dark

/**
 * How far to push the mark off geometric centre.
 *
 * Its area centroid sits 4.9% of the mark's own width up and to the left of
 * the bounding box's centre — the concave corner removes far more material
 * than the rounded one adds back. Centring the box therefore looks wrong.
 * Correcting the full amount over-shoots, because the eye reads the square
 * silhouette as well as the mass, so half of it is the value that tested best.
 */
const NUDGE = 0.049 / 2;

/**
 * The mark on an opaque field, which is what every raster icon needs: iOS
 * fills transparency with black, and a bare dark mark would vanish into a dark
 * browser tab strip.
 */
function composition({ size, glyph, field = PAPER, ink = EVERGREEN }) {
  const side = size * glyph;
  const offset = (size - side) / 2 + side * NUDGE;
  const scale = side / BOX;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${field}"/>
  <g transform="translate(${round(offset)} ${round(offset)}) scale(${round(scale, 6)})"><path fill="${ink}" d="${PATH}"/></g>
</svg>`;
}

const round = (n, dp = 4) => Number(n.toFixed(dp));

/**
 * `flat` drops the alpha channel. Every composition is opaque already, but iOS
 * rejects an alpha channel on a home-screen icon rather than ignoring it, so
 * the standalone PNGs are flattened and only the ICO's payloads keep theirs —
 * its directory entries declare 32 bits per pixel.
 */
const png = (svg, size, { flat = true } = {}) => {
  const pipeline = sharp(Buffer.from(svg), { density: 1200 }).resize(size, size);
  return (flat ? pipeline.flatten({ background: PAPER }) : pipeline)
    .png({ compressionLevel: 9 })
    .toBuffer();
};

/* --- ICO --------------------------------------------------------------
   A PNG-payload ICO, which every browser since IE Vista reads. Written by
   hand because pulling a dependency in to concatenate three PNGs behind a
   22-byte header would be the more complicated option. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

/* --- Outputs ----------------------------------------------------------- */

const write = (rel, data) => {
  mkdirSync(dirname(p(rel)), { recursive: true });
  writeFileSync(p(rel), data);
  console.log(`  ${rel}  ${(data.length / 1024).toFixed(1)} kB`);
};

console.log('Livd brand assets');

/* --- The official logo, on fitted canvases ----------------------------
   `public/brand/logo/` holds the official Livd files exactly as supplied, and
   nothing here writes to it. They are exported on fixed frames: the logo on
   1600 × 400 with its artwork in the left half, the symbol centred on
   1000 × 1000. A layout cannot see a frame's empty margin, only the box, so
   the logo rendered as supplied would carry 87px of transparent canvas after
   the full stop — pushing the header navigation right, and stretching the
   home link's hit area into blank space.

   So each file is re-issued with its canvas fitted to its artwork. The root
   element's width, height and viewBox change and nothing else does: every
   <path> is copied byte for byte, and `tests/design/brand-logo.test.ts` fails
   if one ever differs, or if a fitted canvas clips a single point of the
   drawing. Clear space belongs to the layout, as it did for the type-set
   wordmark these replace. */

/**
 * The exact bounds of an SVG path, curves included.
 *
 * Only the absolute commands the official files are exported with. Anything
 * else throws rather than being skipped, because a bound computed from part of
 * a path is a canvas that crops the rest of it.
 */
function pathBounds(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = (x, y) => {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  };

  /** Where a cubic's derivative is zero on (0, 1) — its turning points. */
  const extrema = (p0, p1, p2, p3) => {
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
    const disc = b * b - 4 * a * c;
    if (disc < 0) return [];
    const root = Math.sqrt(disc);
    return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
  };
  const cubic = (p0, p1, p2, p3, t) =>
    (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;

  let i = 0;
  let command = '';
  let x = 0;
  let y = 0;
  const next = () => Number(tokens[i++]);

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    switch (command) {
      case 'M':
      case 'L':
        x = next();
        y = next();
        include(x, y);
        if (command === 'M') command = 'L'; // further pairs are line-tos
        break;
      case 'H':
        x = next();
        include(x, y);
        break;
      case 'V':
        y = next();
        include(x, y);
        break;
      case 'C': {
        const [x1, y1, x2, y2, x3, y3] = [next(), next(), next(), next(), next(), next()];
        for (const t of extrema(x, x1, x2, x3)) {
          if (t > 0 && t < 1) include(cubic(x, x1, x2, x3, t), cubic(y, y1, y2, y3, t));
        }
        for (const t of extrema(y, y1, y2, y3)) {
          if (t > 0 && t < 1) include(cubic(x, x1, x2, x3, t), cubic(y, y1, y2, y3, t));
        }
        x = x3;
        y = y3;
        include(x, y);
        break;
      }
      case 'Z':
        break;
      default:
        throw new Error(`pathBounds: unsupported path command "${command}"`);
    }
  }
  return box;
}

/** A master re-issued on a canvas fitted to its artwork. See above. */
function fitted(master) {
  const svg = readFileSync(p('public/brand/logo', master), 'utf8');
  const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => pathBounds(m[1]));
  if (paths.length === 0) throw new Error(`No paths found in ${master}`);

  // Outward to the thousandth, so rounding can only ever add canvas.
  const floor = (n) => Math.floor(n * 1000) / 1000;
  const ceil = (n) => Math.ceil(n * 1000) / 1000;
  const minX = floor(Math.min(...paths.map((b) => b.minX)));
  const minY = floor(Math.min(...paths.map((b) => b.minY)));
  const width = round(ceil(Math.max(...paths.map((b) => b.maxX))) - minX, 3);
  const height = round(ceil(Math.max(...paths.map((b) => b.maxY))) - minY, 3);

  const out = svg.replace(/<svg\b[^>]*>/, (root) =>
    root
      .replace(/ width="[^"]*"/, ` width="${width}"`)
      .replace(/ height="[^"]*"/, ` height="${height}"`)
      .replace(/ viewBox="[^"]*"/, ` viewBox="${minX} ${minY} ${width} ${height}"`) +
    `\n<!-- Generated by scripts/build-brand-assets.mjs from public/brand/logo/${master}: the same artwork, on a canvas fitted to it. Do not edit. -->`,
  );
  write(`public/brand/fitted/${master}`, Buffer.from(out));
  console.log(`    ${width} × ${height}`);
}

for (const master of ['livd-logo.svg', 'livd-logo-white.svg', 'livd-symbol.svg', 'livd-symbol-white.svg']) {
  fitted(master);
}

/*
 * The SVG favicon, which is what every current browser actually uses.
 *
 * Bare and theme-aware rather than a tile: at 16px every pixel spent on a
 * background is a pixel not spent on the mark, and the mark is itself square,
 * so a rounded tile around it reads as a window rather than as a logo.
 */
write(
  'src/app/icon.svg',
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" role="img" aria-label="Livd">
  <style>
    path { fill: ${EVERGREEN} }
    @media (prefers-color-scheme: dark) { path { fill: ${SAGE} } }
  </style>
  <path d="${PATH}"/>
</svg>
`),
);

/*
 * The legacy fallback: search results, older Safari, Windows shortcuts.
 *
 * Opaque, because it cannot carry a media query and so has to be legible in a
 * dark tab strip as well as a light one. The mark runs nearly edge to edge —
 * this is a favicon, not an app icon, and 16px has none to spare.
 */
const icoSvg = composition({ size: 256, glyph: 0.8 });
write(
  'src/app/favicon.ico',
  ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({ size, data: await png(icoSvg, size, { flat: false }) })),
    ),
  ),
);

/*
 * iOS home screen. Apple applies its own corner mask and no shadow, so the
 * artwork is a full-bleed square with the mark inset to Apple's usual optical
 * margin.
 */
const appIconSvg = composition({ size: 512, glyph: 0.64 });
write('src/app/apple-icon.png', await png(appIconSvg, 180));
write('public/brand/livd-app-icon.svg', Buffer.from(appIconSvg + '\n'));

/* Web app manifest icons. Referenced by `src/app/manifest.ts`. */
write('public/brand/livd-icon-192.png', await png(appIconSvg, 192));
write('public/brand/livd-icon-512.png', await png(appIconSvg, 512));

/*
 * Android maskable icon. The launcher may crop to a circle, so everything that
 * matters has to sit inside the middle 80% — and a square mark's corners reach
 * further than its width, hence the smaller glyph here than on the iOS icon.
 */
write('public/brand/livd-icon-maskable-512.png', await png(composition({ size: 512, glyph: 0.5 }), 512));

/* A reversed master, for dark backgrounds and future press use. */
write(
  'public/brand/livd-app-icon-dark.svg',
  Buffer.from(composition({ size: 512, glyph: 0.64, field: '#0D0E0D', ink: SAGE }) + '\n'),
);

console.log('done');
