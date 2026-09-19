import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LOGO_ASSETS } from '@/components/brand/logo';

/**
 * The official logo, held to the files it was supplied as.
 *
 * `public/brand/logo/` is the official artwork and nothing may edit it. What
 * the product renders are copies of it in `public/brand/fitted/`, re-issued by
 * `scripts/build-brand-assets.mjs` on a canvas fitted to the artwork. That
 * derivation is exactly where a logo can quietly go wrong — a path "tidied", a
 * canvas that shaves the tip off the symbol, a size in the component that no
 * longer matches the file — so each of those is asserted rather than trusted.
 */

// `process.cwd()` rather than `import.meta.url`: these run in jsdom, where
// import.meta.url is not a file: URL. Same reasoning as contrast.test.ts.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const MASTERS = ['livd-logo.svg', 'livd-logo-white.svg', 'livd-symbol.svg', 'livd-symbol-white.svg'];

const rootOf = (svg: string) => svg.match(/<svg\b[^>]*>/)?.[0] ?? '';
const attr = (tag: string, name: string) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1];

/** Everything that is not the root tag or the generated note: the artwork. */
const artworkOf = (svg: string) =>
  svg
    .replace(/<svg\b[^>]*>/, '')
    .replace(/\n?<!--[\s\S]*?-->/g, '')
    .trim();

/**
 * Every point a path passes through, sampled finely along its curves.
 *
 * Deliberately not the build script's analytic bounds: a second, cruder method
 * that agrees with the first is worth more than the first checking itself.
 */
function pathPoints(d: string): Array<[number, number]> {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const points: Array<[number, number]> = [];
  let i = 0;
  let command = '';
  let x = 0;
  let y = 0;
  const next = () => Number(tokens[i++]);

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i]!)) command = tokens[i++]!;
    if (command === 'M' || command === 'L') {
      [x, y] = [next(), next()];
      if (command === 'M') command = 'L';
    } else if (command === 'H') {
      x = next();
    } else if (command === 'V') {
      y = next();
    } else if (command === 'C') {
      const [x1, y1, x2, y2, x3, y3] = [next(), next(), next(), next(), next(), next()];
      for (let s = 1; s < 400; s++) {
        const t = s / 400;
        const u = 1 - t;
        points.push([
          u ** 3 * x + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x3,
          u ** 3 * y + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3,
        ]);
      }
      [x, y] = [x3, y3];
    } else if (command === 'Z') {
      continue;
    } else {
      throw new Error(`unsupported path command "${command}"`);
    }
    points.push([x, y]);
  }
  return points;
}

describe('the official files', () => {
  it.each([
    ...MASTERS,
    'livd-logo.png',
    'livd-logo@2x.png',
    'livd-logo-white.png',
    'livd-logo-white@2x.png',
    'livd-symbol.png',
    'livd-symbol@2x.png',
    'livd-symbol-white.png',
    'livd-symbol-white@2x.png',
  ])('public/brand/logo/%s is in place', (file) => {
    expect(existsSync(join(process.cwd(), 'public/brand/logo', file))).toBe(true);
  });

  it.each([
    ['livd-logo.svg', '0 0 1600 400'],
    ['livd-logo-white.svg', '0 0 1600 400'],
    ['livd-symbol.svg', '0 0 1000 1000'],
    ['livd-symbol-white.svg', '0 0 1000 1000'],
  ])('%s is still on the frame it was supplied on', (file, viewBox) => {
    // A master re-saved from an editor is the usual way artwork changes by
    // accident. The frame is the cheapest tell.
    expect(attr(rootOf(read(`public/brand/logo/${file}`)), 'viewBox')).toBe(viewBox);
  });
});

describe.each(MASTERS)('the fitted copy of %s', (file) => {
  const master = read(`public/brand/logo/${file}`);
  const copy = read(`public/brand/fitted/${file}`);
  const root = rootOf(copy);
  const [minX, minY, width, height] = (attr(root, 'viewBox') ?? '').split(' ').map(Number) as [
    number,
    number,
    number,
    number,
  ];

  it('draws exactly the artwork the master draws', () => {
    expect(artworkOf(copy)).toBe(artworkOf(master));
  });

  it('changes nothing on the root element but the canvas', () => {
    const strip = (tag: string) =>
      tag.replace(/ (width|height|viewBox)="[^"]*"/g, '');
    expect(strip(root)).toBe(strip(rootOf(master)));
  });

  it('gives the canvas the same size as its viewBox, so it renders at 1:1', () => {
    expect(Number(attr(root, 'width'))).toBe(width);
    expect(Number(attr(root, 'height'))).toBe(height);
  });

  const points = [...master.matchAll(/ d="([^"]+)"/g)].flatMap((m) => pathPoints(m[1]!));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);

  it('clips no part of the drawing', () => {
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(minX);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(minY);
    expect(Math.max(...xs)).toBeLessThanOrEqual(minX + width);
    expect(Math.max(...ys)).toBeLessThanOrEqual(minY + height);
  });

  it('leaves no margin of its own — clear space is the layout’s', () => {
    const slack = 0.01;
    expect(Math.min(...xs) - minX).toBeLessThan(slack);
    expect(Math.min(...ys) - minY).toBeLessThan(slack);
    expect(minX + width - Math.max(...xs)).toBeLessThan(slack);
    expect(minY + height - Math.max(...ys)).toBeLessThan(slack);
  });
});

describe('the files <Logo> renders', () => {
  const assets = Object.values(LOGO_ASSETS).flatMap((variant) => Object.values(variant));

  it.each(assets)('$src exists, at the size the component declares', ({ src, width, height }) => {
    const root = rootOf(read(join('public', src)));
    // The component passes these to the <img> so the browser reserves the
    // right box before the file arrives. A mismatch is a layout shift.
    expect(Number(attr(root, 'width'))).toBe(width);
    expect(Number(attr(root, 'height'))).toBe(height);
  });

  it('are all fitted copies of the official files, never anything else', () => {
    for (const { src } of assets) {
      expect(src).toMatch(/^\/brand\/fitted\/livd-(logo|symbol)(-white)?\.svg$/);
    }
  });
});
