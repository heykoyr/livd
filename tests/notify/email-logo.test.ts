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

  it.each([LIGHT, DARK])('%s is a transparent PNG, carrying no ground of its own', (path) => {
    const b = readFileSync(join(process.cwd(), 'public', path));
    expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(b.readUInt32BE(16)).toBe(280); // twice the 140 the sign-in email shows
    expect(b.readUInt32BE(20)).toBe(82);
    // Colour type 6 is truecolour *with* alpha. An opaque tile shipped once
    // and arrived as a white rectangle in the middle of a darkened Gmail
    // message, because a client that inverts a mail leaves its images alone.
    // The ground belongs to the template, not to the logo.
    expect(b.readUInt8(25)).toBe(6);
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
  const markup = template.slice(template.indexOf('<!doctype html>'));

  it('shows the white logo, absolute, on the canonical origin', () => {
    expect(markup).toContain(`src="${ORIGIN}${DARK}"`);
    expect(markup).not.toContain(`src="${ORIGIN}${LIGHT}"`);
  });

  it('carries one logo and names Livd for a client with images turned off', () => {
    const images = markup.match(/<img[\s\S]*?\/>/g) ?? [];

    expect(images).toHaveLength(1);
    expect(images[0]).toContain('alt="Livd"');
  });

  /**
   * The email states its own ground rather than leaving a client to decide.
   * Gmail does not honour `prefers-color-scheme`; it inverts a light message
   * itself and leaves every image untouched, which is how a logo on a light
   * tile came to sit in a dark message as a white rectangle. A white logo is
   * only right on a dark ground, so the ground has to be written down.
   */
  it('declares the dark scheme it is drawn in', () => {
    expect(markup).toContain('<meta name="color-scheme" content="dark" />');
    expect(markup).toContain('<meta name="supported-color-schemes" content="dark" />');
  });

  it('is dark in the markup, not by a media query a client may ignore', () => {
    expect(markup).not.toContain('prefers-color-scheme');
    // The canvas, the card and the body copy, as the dark theme declares them.
    expect(markup).toContain('background-color:#0d0e0d');
    expect(markup).toContain('background-color:#161816');
    expect(markup).toContain('color:#f2f1ed');
  });

  it('leaves no light-theme colour behind to fight the ground', () => {
    for (const light of ['#fbfaf8', '#ffffff', '#e5e1d9', '#17191a', '#5c5f5b', '#12312a']) {
      expect(markup, `${light} is a light-theme value`).not.toContain(light);
    }
  });

  it('links only through Supabase’s token hash, never a hand-built token', () => {
    // Four uses: the VML button, the anchor, and the fallback link, which
    // carries it as both its href and the text somebody pastes. What the link
    // is and why is `tests/auth/sign-in-template.test.ts`.
    expect(markup.match(/token_hash={{ \.TokenHash }}/g) ?? []).toHaveLength(4);
  });
});
