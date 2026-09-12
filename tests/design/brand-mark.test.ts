import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MARK_PATH } from '@/components/brand/mark';

/**
 * The brand mark, held to one geometry.
 *
 * The mark exists in four places at once: as the master vector, as the React
 * component the product draws with, as an SVG favicon, and as a handful of
 * committed PNGs. The rasters are generated once by
 * `scripts/build-brand-assets.mjs` and then committed, so that `next build`
 * needs no image toolchain — which is the right trade, and also exactly the
 * arrangement in which a redrawn mark quietly ships everywhere except the
 * favicon, or the other way round.
 *
 * So the geometry is asserted rather than trusted. Change the master and these
 * fail until the script has been re-run and the component updated; change the
 * component alone and they fail immediately.
 */

// `process.cwd()` rather than `import.meta.url`: these run in jsdom, where
// import.meta.url is not a file: URL. Same reasoning as contrast.test.ts.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const bytes = (rel: string) => readFileSync(join(process.cwd(), rel));

const pathOf = (svg: string) => svg.match(/ d="([^"]+)"/)?.[1];

describe('the master vector', () => {
  it('is the geometry the component draws', () => {
    expect(pathOf(read('public/brand/livd-mark.svg'))).toBe(MARK_PATH);
  });

  it('fills a 48 unit box, so consumers own the padding', () => {
    expect(read('public/brand/livd-mark.svg')).toContain('viewBox="0 0 48 48"');
  });

  it('carries no colour of its own', () => {
    expect(read('public/brand/livd-mark.svg')).toContain('currentColor');
  });
});

describe('the derived vectors', () => {
  it.each([
    ['src/app/icon.svg', 'the SVG favicon'],
    ['public/brand/livd-app-icon.svg', 'the app icon master'],
    ['public/brand/livd-app-icon-dark.svg', 'the reversed app icon'],
  ])('%s draws the same path', (file) => {
    expect(pathOf(read(file))).toBe(MARK_PATH);
  });

  it('gives the favicon a dark-mode fill, so it survives a dark tab strip', () => {
    const svg = read('src/app/icon.svg');
    expect(svg).toContain('prefers-color-scheme: dark');
    // The light fill is the brand token; the dark fill is its dark-theme remap.
    expect(svg).toContain('#12312A');
    expect(svg).toContain('#D8E4DE');
  });

  it('uses the brand and canvas tokens exactly as globals.css declares them', () => {
    const css = read('src/app/globals.css');
    const declared = (name: string, block: string) =>
      block.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();

    const darkAt = css.indexOf("[data-theme='dark'] {");
    const light = css.slice(0, darkAt);
    const dark = css.slice(darkAt);

    expect(declared('brand', light)).toBe('#12312a');
    expect(declared('brand', dark)).toBe('#d8e4de');
    expect(declared('canvas', light)).toBe('#fbfaf8');
  });
});

describe('the raster icons', () => {
  /** PNG header: an 8 byte signature, then IHDR with width and height. */
  const pngSize = (rel: string) => {
    const b = bytes(rel);
    expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b.readUInt8(25) };
  };

  it.each([
    ['src/app/apple-icon.png', 180],
    ['public/brand/livd-icon-192.png', 192],
    ['public/brand/livd-icon-512.png', 512],
    ['public/brand/livd-icon-maskable-512.png', 512],
  ])('%s is %ipx square', (file, size) => {
    const { width, height } = pngSize(file);
    expect(width).toBe(size);
    expect(height).toBe(size);
  });

  it('ships the home screen icon without an alpha channel, as iOS requires', () => {
    // PNG colour type 2 is truecolour; 6 would be truecolour with alpha.
    expect(pngSize('src/app/apple-icon.png').colourType).toBe(2);
  });

  it('ships a favicon.ico holding 16, 32 and 48', () => {
    const b = bytes('src/app/favicon.ico');
    expect(b.readUInt16LE(0)).toBe(0); // reserved
    expect(b.readUInt16LE(2)).toBe(1); // 1 = icon, not cursor
    const count = b.readUInt16LE(4);
    expect(count).toBe(3);

    const sizes = Array.from({ length: count }, (_, i) => b.readUInt8(6 + i * 16) || 256);
    expect(sizes).toEqual([16, 32, 48]);

    // Every entry must point at a real PNG payload inside the file.
    for (let i = 0; i < count; i++) {
      const length = b.readUInt32LE(6 + i * 16 + 8);
      const offset = b.readUInt32LE(6 + i * 16 + 12);
      expect(offset + length).toBeLessThanOrEqual(b.length);
      expect(b.subarray(offset, offset + 8).toString('hex')).toBe('89504e470d0a1a0a');
    }
  });
});

describe('the manifest', () => {
  it('names icons that exist', async () => {
    const { default: manifest } = await import('@/app/manifest');
    for (const icon of manifest().icons ?? []) {
      expect(() => bytes(join('public', String(icon.src)))).not.toThrow();
    }
  });
});
