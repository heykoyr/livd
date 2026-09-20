import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

/**
 * The social card — the one image every shared link previews as.
 *
 * It is a designed asset with no source file: `public/brand/og/social-card-plate.png`
 * is the design with the logo's space left empty, and `brand:build` composites
 * the official logo into it. That arrangement has exactly two ways to go
 * wrong, and both are asserted here — the card drifting from the plate
 * everywhere else on it, and the logo's space being filled with something that
 * is not the official artwork.
 */

// `process.cwd()` rather than `import.meta.url`: these run in jsdom, where
// import.meta.url is not a file: URL. Same reasoning as contrast.test.ts.
const bytes = (rel: string) => readFileSync(join(process.cwd(), rel));

/** Where the logo is composited. Mirrors `CARD_LOGO` in the build script. */
const LOGO = { left: 160, top: 130, width: 287, height: 84 };

/**
 * Enough of a PNG decoder to read the pixels back: 8-bit, non-interlaced,
 * which is what everything here is. Written out rather than pulled in, for the
 * same reason the ICO is written by hand — a dependency to read four chunks
 * would be the more complicated option.
 */
function decode(rel: string) {
  const b = bytes(rel);
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Buffer[] = [];

  for (let pos = 8; pos + 8 <= b.length; ) {
    const length = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    const body = b.subarray(pos + 8, pos + 8 + length);

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      expect(body.readUInt8(8), `${rel}: bit depth`).toBe(8);
      const colour = body.readUInt8(9);
      channels = colour === 6 ? 4 : colour === 2 ? 3 : 0;
      expect(channels, `${rel}: colour type ${colour}`).toBeGreaterThan(0);
      expect(body.readUInt8(12), `${rel}: interlaced`).toBe(0);
    } else if (type === 'IDAT') {
      parts.push(body);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const data = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));

    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? data[y * stride + i - channels]! : 0;
      const up = y > 0 ? data[(y - 1) * stride + i]! : 0;
      const upLeft = y > 0 && i >= channels ? data[(y - 1) * stride + i - channels]! : 0;
      let value = line[i]!;

      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      data[y * stride + i] = value & 0xff;
    }
  }

  const hex = (x: number, y: number) => {
    const i = y * stride + x * channels;
    return (
      '#' +
      [data[i]!, data[i + 1]!, data[i + 2]!]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    );
  };

  return { width, height, channels, stride, data, hex };
}

describe('the social card', () => {
  const card = decode('src/app/opengraph-image.png');
  const plate = decode('public/brand/og/social-card-plate.png');

  it('is the size every platform crops from', () => {
    expect([card.width, card.height]).toEqual([2400, 1260]);
    expect([plate.width, plate.height]).toEqual([2400, 1260]);
  });

  it('is the same image for OpenGraph and for Twitter', () => {
    expect(bytes('src/app/twitter-image.png')).toEqual(bytes('src/app/opengraph-image.png'));
  });

  it('leaves the rest of the design untouched, pixel for pixel', () => {
    let changed = 0;
    for (let y = 0; y < card.height; y++) {
      const insideRow = y >= LOGO.top && y < LOGO.top + LOGO.height;
      for (let x = 0; x < card.width; x++) {
        if (insideRow && x >= LOGO.left && x < LOGO.left + LOGO.width) continue;
        const i = y * card.stride + x * card.channels;
        if (card.data[i] !== plate.data[i]) changed++;
      }
    }
    expect(changed, 'pixels differing from the plate outside the logo').toBe(0);
  });

  it('carries the official logo in the space the plate leaves for it', () => {
    const found = new Set<string>();
    for (let y = LOGO.top; y < LOGO.top + LOGO.height; y++) {
      for (let x = LOGO.left; x < LOGO.left + LOGO.width; x++) found.add(card.hex(x, y));
    }

    // The symbol's two leaves and the wordmark's clay full stop, exactly as the
    // official files declare them. Type set in a font would carry none of them.
    expect(found).toContain('#242624');
    expect(found).toContain('#CECBC5');
    expect(found).toContain('#AA5329');
  });

  it('is drawn on the plate the design was cut from — paper, not white', () => {
    // The corner is the ground the whole card sits on.
    expect(card.hex(0, 0)).toBe('#FBFAF8');
  });
});
