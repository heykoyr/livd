import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The icon system, held to the official artwork.
 *
 * The symbol reaches a browser tab, a home screen and a launcher through four
 * generated files: an SVG favicon, an ICO, and two PNG app icons. They are
 * generated once by `scripts/build-brand-assets.mjs` and then committed, so
 * that `next build` needs no image toolchain — which is the right trade, and
 * also exactly the arrangement in which a redrawn symbol quietly ships
 * everywhere except the favicon, or the other way round.
 *
 * So the artwork is asserted rather than trusted: every generated file is
 * compared against the official file it came from.
 */

// `process.cwd()` rather than `import.meta.url`: these run in jsdom, where
// import.meta.url is not a file: URL. Same reasoning as contrast.test.ts.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const bytes = (rel: string) => readFileSync(join(process.cwd(), rel));

/** A file's `<path …/>` elements, exactly as written. */
const pathsOf = (svg: string) => svg.match(/<path\b[^>]*\/>/g) ?? [];

describe('the SVG favicon', () => {
  const favicon = read('src/app/icon.svg');

  it('draws the official symbol — both grounds, path for path', () => {
    expect(pathsOf(favicon)).toEqual([
      ...pathsOf(read('public/brand/logo/livd-symbol.svg')),
      ...pathsOf(read('public/brand/logo/livd-symbol-white.svg')),
    ]);
  });

  it('is the symbol and not the wordmark, which is a smudge at 16px', () => {
    for (const path of pathsOf(read('public/brand/logo/livd-logo.svg')).slice(2)) {
      expect(favicon).not.toContain(path);
    }
  });

  it('shows the white symbol on a dark tab strip — the file, not a filter', () => {
    expect(favicon).toContain('prefers-color-scheme: dark');
    expect(favicon).not.toMatch(/filter|invert|opacity/);
    // The white file's own fills, which only it declares.
    expect(favicon).toContain('#827C70');
    expect(favicon).toContain('fill="white"');
  });
});

describe('the ICO', () => {
  const ico = bytes('src/app/favicon.ico');
  const count = ico.readUInt16LE(4);

  it('holds 16, 32 and 48', () => {
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // 1 = icon, not cursor
    expect(count).toBe(3);
    expect(Array.from({ length: count }, (_, i) => ico.readUInt8(6 + i * 16) || 256)).toEqual([
      16, 32, 48,
    ]);
  });

  it('carries the supplied favicon PNGs themselves, byte for byte', () => {
    for (let i = 0; i < count; i++) {
      const size = ico.readUInt8(6 + i * 16) || 256;
      const length = ico.readUInt32LE(6 + i * 16 + 8);
      const offset = ico.readUInt32LE(6 + i * 16 + 12);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      expect(ico.subarray(offset, offset + length)).toEqual(
        bytes(`public/brand/favicon/favicon-${size}.png`),
      );
    }
  });
});

describe('the app icons', () => {
  /** PNG header: an 8 byte signature, then IHDR with width and height. */
  const pngSize = (rel: string) => {
    const b = bytes(rel);
    expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b.readUInt8(25) };
  };

  it.each([
    ['src/app/apple-icon.png', 180],
    ['public/brand/icons/livd-icon-192.png', 192],
    ['public/brand/icons/livd-icon-512.png', 512],
  ])('%s is %ipx square', (file, size) => {
    const { width, height } = pngSize(file);
    expect(width).toBe(size);
    expect(height).toBe(size);
  });

  it.each([
    'src/app/apple-icon.png',
    'public/brand/icons/livd-icon-192.png',
    'public/brand/icons/livd-icon-512.png',
  ])('%s has no alpha channel, as iOS requires of a home screen icon', (file) => {
    // PNG colour type 2 is truecolour; 6 would be truecolour with alpha.
    expect(pngSize(file).colourType).toBe(2);
  });

  it('sits on the paper field exactly as globals.css declares it', () => {
    // The field is baked into the rasters, so the value cannot be read from a
    // token at runtime. This is what keeps the two from drifting apart.
    const css = read('src/app/globals.css');
    const light = css.slice(0, css.indexOf("[data-theme='dark'] {"));
    expect(light.match(/--color-canvas:\s*(#[0-9a-fA-F]{6})/)?.[1]?.toLowerCase()).toBe('#fbfaf8');
  });
});

describe('the manifest', () => {
  it('names icons that exist', async () => {
    const { default: manifest } = await import('@/app/manifest');
    for (const icon of manifest().icons ?? []) {
      expect(() => bytes(join('public', String(icon.src)))).not.toThrow();
    }
  });

  it('offers a maskable icon as well as a plain one', async () => {
    const { default: manifest } = await import('@/app/manifest');
    const purposes = (manifest().icons ?? []).map((icon) => icon.purpose);
    expect(purposes).toContain('any');
    expect(purposes).toContain('maskable');
  });
});

describe('the icon metadata', () => {
  it('is left to the file conventions, so no tag is declared twice', () => {
    // Next wires the favicon, the Apple icon and the manifest from the files
    // in src/app/. An `icons` key in the layout's metadata would emit a second
    // set of <link> tags beside them.
    const metadata = read('src/app/layout.tsx');
    expect(metadata).not.toMatch(/^\s*icons:/m);
  });
});
