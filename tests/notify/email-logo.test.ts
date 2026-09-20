import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The logo in email.
 *
 * Email is the one place a raster of the logo is required — no client renders
 * SVG — and the one place it is fetched from an absolute URL rather than a
 * path, because the message is read somewhere that has never visited the site.
 * Both of those are easy to get quietly wrong: a relative src resolves against
 * the mail client and loads nothing, and a file that moves leaves a broken
 * image in mail already sent.
 *
 * The sign-in template is checked as text. It is pasted into the Supabase
 * dashboard by hand, so this cannot prove what is live — only that the file
 * somebody pastes from is right.
 */

const ORIGIN = 'https://livd.site';
const LIGHT = '/brand/email/livd-logo.png';
const DARK = '/brand/email/livd-logo-white.png';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

let renderNotification: typeof import('@/server/notify/messages').renderNotification;
let saved: string | undefined;

beforeAll(async () => {
  saved = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  vi.resetModules();
  ({ renderNotification } = await import('@/server/notify/messages'));
});

afterAll(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = saved;
  vi.resetModules();
});

describe('the files email points at', () => {
  it.each([LIGHT, DARK])('%s is committed, so sent mail keeps working', (path) => {
    expect(existsSync(join(process.cwd(), 'public', path))).toBe(true);
  });

  it.each([LIGHT, DARK])('%s is a PNG with no alpha, on its own ground', (path) => {
    const b = readFileSync(join(process.cwd(), 'public', path));
    expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(b.readUInt32BE(16)).toBe(164); // twice the 82 it is displayed at
    expect(b.readUInt32BE(20)).toBe(48);
    // Colour type 2 is truecolour without alpha: a client that forces dark
    // mode inverts the ground but not the image, and a transparent dark-ink
    // logo would be left invisible on it.
    expect(b.readUInt8(25)).toBe(2);
  });
});

describe('a notification email', () => {
  it('shows the official logo, from the canonical origin', () => {
    const { html } = renderNotification({
      kind: 'review_published',
      propertyName: 'The Franklin',
      propertySlug: 'the-franklin-brooklyn',
    });

    expect(html).toContain(`src="${ORIGIN}${LIGHT}"`);
    expect(html).toContain('alt="Livd"');
  });

  it('no longer sets the wordmark as type', () => {
    const { html } = renderNotification({ kind: 'review_held', propertyName: 'The Franklin' });
    // The old shell drew it as a word plus a coloured full stop.
    expect(html).not.toContain('>Livd<span');
  });

  it('keeps naming Livd in the text part, which has no images at all', () => {
    const { text } = renderNotification({ kind: 'review_held', propertyName: 'The Franklin' });
    expect(text.split('\n')[0]).toBe('LIVD');
  });
});

describe('the sign-in template', () => {
  const template = read('supabase/templates/magic-link.html');

  it('carries both logos, absolute, on the canonical origin', () => {
    expect(template).toContain(`src="${ORIGIN}${LIGHT}"`);
    expect(template).toContain(`src="${ORIGIN}${DARK}"`);
  });

  it('swaps them on the dark scheme rather than recolouring one', () => {
    const dark = template.slice(template.indexOf('@media (prefers-color-scheme: dark)'));
    expect(dark).toContain('.livd-logo-light { display: none !important; }');
    expect(dark).toContain('.livd-logo-dark { display: block !important; }');
  });

  it('names Livd for a client with images turned off', () => {
    const images = template.match(/<img[\s\S]*?\/>/g) ?? [];

    expect(images).toHaveLength(2);
    for (const image of images) expect(image).toContain('alt="Livd"');
  });
});
