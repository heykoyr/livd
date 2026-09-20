/**
 * Derives every generated brand asset from the official artwork.
 *
 * `public/brand/logo/` and `public/brand/favicon/` hold the official Livd
 * files exactly as supplied, and nothing here writes to either. Everything
 * this script produces is read out of them — paths copied verbatim, rasters
 * rendered from the supplied vector, the ICO packed from the supplied PNGs —
 * so a generated file can never drift from the artwork the way hand-exported
 * assets always eventually do.
 *
 * Run it when the official files change, not on every build: the outputs are
 * committed so that `next build` needs no image toolchain at all.
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
    'This script needs `sharp` to rasterise the symbol. Install it with `npm i -D sharp`.',
  );
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...parts) => join(root, ...parts);

/* --- The official files ------------------------------------------------ */

const official = (file) => readFileSync(p('public/brand/logo', file), 'utf8');

/** A file's `<path …/>` elements, exactly as they are written in it. */
const pathsOf = (svg) => svg.match(/<path\b[^>]*\/>/g) ?? [];

const SYMBOL = official('livd-symbol.svg');
const SYMBOL_WHITE = official('livd-symbol-white.svg');

/** The frame the symbol is supplied on, and the clear space it carries. */
const SYMBOL_BOX = 1000;

/**
 * The field a raster icon sits on.
 *
 * Livd's paper, matching `--color-canvas` in the light theme and the
 * manifest's `background_color`. Opaque because these are icons: iOS fills
 * transparency with black rather than ignoring it, which would put the symbol
 * in a black box on a home screen.
 */
const PAPER = '#FBFAF8';

const round = (n, dp = 4) => Number(n.toFixed(dp));

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
    const rootOf = Math.sqrt(disc);
    return [(-b + rootOf) / (2 * a), (-b - rootOf) / (2 * a)];
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
  const svg = official(master);
  const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => pathBounds(m[1]));
  if (paths.length === 0) throw new Error(`No paths found in ${master}`);

  // Outward to the thousandth, so rounding can only ever add canvas.
  const floor = (n) => Math.floor(n * 1000) / 1000;
  const ceil = (n) => Math.ceil(n * 1000) / 1000;
  const minX = floor(Math.min(...paths.map((b) => b.minX)));
  const minY = floor(Math.min(...paths.map((b) => b.minY)));
  const width = round(ceil(Math.max(...paths.map((b) => b.maxX))) - minX, 3);
  const height = round(ceil(Math.max(...paths.map((b) => b.maxY))) - minY, 3);

  const out = svg.replace(/<svg\b[^>]*>/, (rootTag) =>
    rootTag
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

/* --- The favicon -------------------------------------------------------
   The symbol, never the wordmark: at 16px a word is a smudge. It keeps the
   clear space the symbol is supplied with, which is the same framing as the
   supplied favicon-16/32/48 files — those are the identical drawing, scaled. */

/*
 * The SVG favicon, which is what every current browser actually uses.
 *
 * Both supplied symbols are in the file and a media query picks one. This is
 * the single place in the product that follows the browser's colour scheme
 * rather than the theme the visitor chose, and it has to be: a favicon is a
 * separate document drawn on the tab strip, which is the browser's surface.
 * The dark-ground file is the supplied white symbol — the mark is never
 * recoloured by a filter here or anywhere else.
 *
 * If a browser ignores the query, it renders the light-ground symbol, whose
 * paler half stays legible on a dark strip.
 */
write(
  'src/app/icon.svg',
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SYMBOL_BOX} ${SYMBOL_BOX}" role="img" aria-label="Livd">
  <style>
    .on-dark { display: none }
    @media (prefers-color-scheme: dark) {
      .on-light { display: none }
      .on-dark { display: inline }
    }
  </style>
  <g class="on-light">${pathsOf(SYMBOL).join('')}</g>
  <g class="on-dark">${pathsOf(SYMBOL_WHITE).join('')}</g>
</svg>
`),
);

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

/*
 * The legacy fallback: older browsers, search results, Windows shortcuts.
 *
 * Its payloads are the supplied favicon PNGs themselves, copied in rather than
 * re-rendered — the one place in the brand system where a raster is required
 * and a raster was supplied, so nothing needs to be redrawn at all.
 */
write(
  'src/app/favicon.ico',
  ico(
    [16, 32, 48].map((size) => ({
      size,
      data: readFileSync(p('public/brand/favicon', `favicon-${size}.png`)),
    })),
  ),
);

/* --- App icons ---------------------------------------------------------
   The symbol on the paper field, at the framing it is supplied with. Nothing
   is rescaled or nudged: the artwork is centred in its own frame, and its
   furthest corner sits 35% of the way out from the centre — inside the 40%
   radius Android's maskable safe zone allows, so one composition serves the
   home screen, the manifest and an adaptive launcher icon alike. */

const onPaper = (size) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${SYMBOL_BOX} ${SYMBOL_BOX}">
  <rect width="${SYMBOL_BOX}" height="${SYMBOL_BOX}" fill="${PAPER}"/>
  ${pathsOf(SYMBOL).join('\n  ')}
</svg>`);

/**
 * `density` renders four times larger than needed and the resize brings it
 * back down, which is cheap antialiasing. `flatten` drops the alpha channel:
 * the composition is opaque already, but iOS rejects an alpha channel on a
 * home-screen icon rather than ignoring it.
 */
const png = (size) =>
  sharp(onPaper(size), { density: 72 * 4 })
    .resize(size, size)
    .flatten({ background: PAPER })
    .png({ compressionLevel: 9 })
    .toBuffer();

/* iOS home screen. Apple applies its own corner mask and no shadow. */
write('src/app/apple-icon.png', await png(180));

/* Web app manifest icons. Referenced by `src/app/manifest.ts`. */
write('public/brand/icons/livd-icon-192.png', await png(192));
write('public/brand/icons/livd-icon-512.png', await png(512));

/* --- The email logo ----------------------------------------------------
   The one place a raster of the full logo is genuinely required: no email
   client renders SVG, and none of them would load it if they did. Drawn at
   twice the 82 × 24 it is displayed at, so it is sharp on a phone.

   Opaque, and on the ground each mode actually has. An image is the one thing
   a client that forces dark mode leaves alone while inverting everything
   around it — a transparent dark-ink logo would be left invisible on a
   blackened canvas, where a tile of the canvas's own colour cannot be. */

const NIGHT = '#0D0E0D'; // --color-canvas, dark

const emailLogo = (file, ground) =>
  sharp(readFileSync(p('public/brand/fitted', file)), { density: 72 * 4 })
    .resize({ width: 164, height: 48, fit: 'contain', background: ground })
    .flatten({ background: ground })
    .png({ compressionLevel: 9 })
    .toBuffer();

write('public/brand/email/livd-logo.png', await emailLogo('livd-logo.svg', PAPER));
write('public/brand/email/livd-logo-white.png', await emailLogo('livd-logo-white.svg', NIGHT));

/* --- The social card ---------------------------------------------------
   What a shared link previews as: one 2400 × 1260 image, served as both the
   OpenGraph and the Twitter card.

   The card is a designed, hand-made asset — Newsreader for the line, Inter
   beneath it — and it is not redrawn here. `public/brand/og/social-card-plate.png`
   is that design with the logo's space left empty, and this composites the
   official logo into it. Everything else on the card is the plate's own
   pixels, untouched.

   The placement is taken from the type it replaces, measured off the original
   card: the layout's left margin is 160, and the wordmark stood on a baseline
   at y=196 with a 50px cap height. At 84px tall the official logo's "L" is
   50.05px, and its cap line lands 16.97px below the top of its box — so a top
   of 130 puts the wordmark back on the baseline it has always had, with the
   symbol now beside it. `fit: 'contain'` scales it by its own aspect ratio:
   the logo cannot be stretched here, only fitted. */

const CARD_LOGO = { left: 160, top: 130, width: 287, height: 84 };

const cardLogo = await sharp(readFileSync(p('public/brand/fitted/livd-logo.svg')), {
  density: 72 * 4,
})
  .resize({
    ...CARD_LOGO,
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();

const card = await sharp(p('public/brand/og/social-card-plate.png'))
  .composite([{ input: cardLogo, left: CARD_LOGO.left, top: CARD_LOGO.top }])
  .png({ compressionLevel: 9 })
  .toBuffer();

/* Both file conventions, byte for byte the same image, as they were before. */
write('src/app/opengraph-image.png', card);
write('src/app/twitter-image.png', card);

console.log('done');
