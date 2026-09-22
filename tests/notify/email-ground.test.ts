import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EMAIL_PALETTE } from '@/server/notify/shell';

/**
 * The ground a Livd email is drawn on.
 *
 * Email has no settled ground unless the message states one. Gmail does not
 * honour `prefers-color-scheme`; in dark mode it inverts a light message
 * itself, and it inverts grounds and text while leaving every image as drawn.
 * So a light email is a message whose ground the client picks and whose logo
 * cannot follow — which is exactly how a logo on a light tile came to sit in
 * a darkened message as a white rectangle.
 *
 * Both emails therefore declare the dark scheme and write its palette inline.
 * There are two of them, in two languages, one of which lives in a dashboard
 * outside this repository — so what is asserted here is that they agree: with
 * the product's dark theme, and with each other.
 */

// `process.cwd()` rather than `import.meta.url`: these run in jsdom, where
// import.meta.url is not a file: URL. Same reasoning as contrast.test.ts.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const TEMPLATE = read('supabase/templates/magic-link.html');
/** The markup only: the file opens with a comment block that discusses colour. */
const TEMPLATE_MARKUP = TEMPLATE.slice(TEMPLATE.indexOf('<!doctype html>'));

/** Each email colour, and the dark-theme token it must equal. */
const TOKENS: Array<[keyof typeof EMAIL_PALETTE, string]> = [
  ['canvas', 'canvas'],
  ['surface', 'surface'],
  ['border', 'border'],
  ['ink', 'ink'],
  ['inkMuted', 'ink-muted'],
  ['inkSubtle', 'ink-subtle'],
  ['brand', 'brand'],
  ['brandInk', 'ink-inverse'],
];

/** Every light-theme value, so a stray one cannot hide in either email. */
const LIGHT_THEME = ['#fbfaf8', '#ffffff', '#e5e1d9', '#17191a', '#5c5f5b', '#6d7069', '#12312a'];

let renderNotification: typeof import('@/server/notify/messages').renderNotification;
let saved: string | undefined;

beforeAll(async () => {
  saved = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = 'https://livd.site';
  vi.resetModules();
  ({ renderNotification } = await import('@/server/notify/messages'));
});

afterAll(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = saved;
  vi.resetModules();
});

const notification = () =>
  renderNotification({
    kind: 'review_published',
    propertyName: 'The Franklin',
    propertySlug: 'the-franklin-brooklyn',
  }).html;

describe('the email palette', () => {
  const css = read('src/app/globals.css');
  const dark = css.slice(css.indexOf("[data-theme='dark'] {"), css.indexOf('@media print'));

  it.each(TOKENS)('%s is the dark theme’s --color-%s, exactly', (key, token) => {
    const declared = dark.match(new RegExp(`--color-${token}:\\s*(#[0-9a-fA-F]{6})`))?.[1];

    expect(declared, `--color-${token} in globals.css`).toBeDefined();
    expect(EMAIL_PALETTE[key].toLowerCase()).toBe(declared!.toLowerCase());
  });
});

describe.each([
  ['the notification email', () => notification()],
  ['the sign-in template', () => TEMPLATE_MARKUP],
])('%s', (_name, html) => {
  it('declares the scheme it is already drawn in', () => {
    expect(html()).toMatch(/<meta name="color-scheme" content="dark"/);
    expect(html()).toMatch(/<meta name="supported-color-schemes" content="dark"/);
  });

  it('draws the ground and the card inline, not by a query a client may ignore', () => {
    // Hex case differs between the two — one is generated, one is hand-written.
    const markup = html().toLowerCase();

    expect(markup).toContain(EMAIL_PALETTE.canvas.toLowerCase());
    expect(markup).toContain(EMAIL_PALETTE.surface.toLowerCase());
    expect(markup).not.toContain('prefers-color-scheme');
  });

  it.each(LIGHT_THEME)('carries no light-theme %s to fight that ground', (colour) => {
    expect(html().toLowerCase()).not.toContain(colour);
  });

  it('shows the white logo, which is the one that ground calls for', () => {
    expect(html()).toContain('/brand/email/livd-logo-white.png');
    expect(html()).not.toContain('/brand/email/livd-logo.png');
  });
});

describe('both emails together', () => {
  it('state the same ground, so two Livd emails look like one sender', () => {
    const html = notification().toLowerCase();
    const template = TEMPLATE_MARKUP.toLowerCase();

    for (const value of Object.values(EMAIL_PALETTE)) {
      const colour = value.toLowerCase();
      // `surface` is the card in both; every other value appears in both too.
      expect(html, `notification email is missing ${colour}`).toContain(colour);
      expect(template, `sign-in template is missing ${colour}`).toContain(colour);
    }
  });
});
