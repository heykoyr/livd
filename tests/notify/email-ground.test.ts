import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EMAIL_PALETTE } from '@/server/notify/shell';

/**
 * The ground a Livd email is read on, and the logo that belongs to it.
 *
 * Both emails carry both schemes: light inline on every element, dark in a
 * `prefers-color-scheme` block. A reader on a dark device gets the dark
 * message and the white logo; a reader on a light one gets the light message
 * and the dark-ink logo.
 *
 * Gmail can be asked nothing. It supports neither that media query nor the
 * `color-scheme` meta, and in its dark theme it rewrites the message itself —
 * inverting grounds and text, never the pixels of an image. That has broken
 * the logo twice in opposite directions: a light message inverts to dark and
 * left a white tile stranded on it, and a dark message inverts to *light* and
 * left a white logo invisible on it. So the element Gmail sees is the wordmark
 * set as type, which inverts along with the ground beneath it, and the image
 * files are revealed only by the query Gmail does not answer.
 *
 * What is asserted here is that arrangement, in both emails, plus the palette
 * parity that keeps mail and product from drifting apart.
 */

// `process.cwd()` rather than `import.meta.url`: these run in jsdom, where
// import.meta.url is not a file: URL. Same reasoning as contrast.test.ts.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const TEMPLATE = read('supabase/templates/magic-link.html');
/** The markup only: the file opens with a comment block that discusses colour. */
const TEMPLATE_MARKUP = TEMPLATE.slice(TEMPLATE.indexOf('<!doctype html>'));

/** Each email colour, and the token it must equal in each theme. */
const TOKENS: Array<[keyof typeof EMAIL_PALETTE.light, string]> = [
  ['canvas', 'canvas'],
  ['surface', 'surface'],
  ['border', 'border'],
  ['ink', 'ink'],
  ['inkMuted', 'ink-muted'],
  ['inkSubtle', 'ink-subtle'],
  ['brand', 'brand'],
  ['brandInk', 'ink-inverse'],
];

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

/** Everything outside `<style>`: what a client that drops stylesheets keeps. */
const withoutStylesheet = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '');

/**
 * What such a client actually *shows*: the same, less the elements held back
 * for a scheme it never asked about. The dark logo is one of them, and it
 * carries dark ink inline so that its alt text is legible if it is ever
 * revealed — which is correct, and would otherwise read as a stray dark value.
 */
const visible = (html: string) =>
  withoutStylesheet(html).replace(/<[a-z]+[^>]*display:\s*none[^>]*>/gi, '');

/** The rules inside the dark block, which is the only place dark may appear. */
const darkBlock = (html: string) => {
  const at = html.indexOf('@media (prefers-color-scheme: dark)');
  expect(at, 'no dark scheme block').toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('}\n}', at) + 3) || html.slice(at);
};

describe('the email palette', () => {
  const css = read('src/app/globals.css');
  const darkAt = css.indexOf("[data-theme='dark'] {");
  const light = css.slice(0, darkAt);
  const dark = css.slice(darkAt, css.indexOf('@media print'));

  const declared = (block: string, token: string) =>
    block.match(new RegExp(`--color-${token}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();

  it.each(TOKENS)('light %s is the light theme’s --color-%s', (key, token) => {
    expect(EMAIL_PALETTE.light[key].toLowerCase()).toBe(declared(light, token));
  });

  it.each(TOKENS)('dark %s is the dark theme’s --color-%s', (key, token) => {
    expect(EMAIL_PALETTE.dark[key].toLowerCase()).toBe(declared(dark, token));
  });
});

describe.each([
  ['the notification email', () => notification()],
  ['the sign-in template', () => TEMPLATE_MARKUP],
])('%s', (_name, html) => {
  it('offers both schemes rather than claiming one', () => {
    expect(html()).toMatch(/<meta name="color-scheme" content="light dark"/);
    expect(html()).toMatch(/<meta name="supported-color-schemes" content="light dark"/);
  });

  it('is light inline, so a client told nothing renders the light message', () => {
    const bare = withoutStylesheet(html()).toLowerCase();

    expect(bare).toContain(EMAIL_PALETTE.light.canvas.toLowerCase());
    expect(bare).toContain(EMAIL_PALETTE.light.surface.toLowerCase());
    expect(bare).toContain(EMAIL_PALETTE.light.ink.toLowerCase());
  });

  it('keeps every dark value inside the query, and nowhere visible', () => {
    const shown = visible(html()).toLowerCase();

    for (const value of Object.values(EMAIL_PALETTE.dark)) {
      expect(shown, `${value} is applied to something the light message shows`).not.toContain(
        value.toLowerCase(),
      );
    }
  });

  it('remaps the ground, the card and the ink when the query is answered', () => {
    const block = darkBlock(html()).toLowerCase();

    expect(block).toContain(EMAIL_PALETTE.dark.canvas.toLowerCase());
    expect(block).toContain(EMAIL_PALETTE.dark.surface.toLowerCase());
    expect(block).toContain(EMAIL_PALETTE.dark.ink.toLowerCase());
  });

  /**
   * The Gmail case. Gmail answers no query, so what it renders is the markup
   * with the stylesheet taken away — and in that state the logo must be the
   * type, because type is the only thing that inverts with the ground.
   */
  it('shows the wordmark as type, and no image, to a client that answers nothing', () => {
    const bare = withoutStylesheet(html());

    expect(bare).toContain('class="livd-type"');
    expect(bare).toMatch(/Livd<span style="color:#[aA]{2}5329;?">\.<\/span>/);

    for (const image of bare.match(/<img[^>]*livd-logo[^>]*>/g) ?? []) {
      expect(image, 'an image is visible before the query answers').toContain('display:none');
    }
  });

  it('reveals one official file per ground, and only through the query', () => {
    expect(html()).toContain('/brand/email/livd-logo.png');
    expect(html()).toContain('/brand/email/livd-logo-white.png');

    const dark = darkBlock(html());
    expect(dark).toContain('.livd-logo-dark');
    expect(dark).toContain('.livd-type');

    const lightAt = html().indexOf('@media (prefers-color-scheme: light)');
    expect(lightAt, 'no light scheme block').toBeGreaterThan(-1);
    expect(html().slice(lightAt, lightAt + 200)).toContain('.livd-logo-light');
  });

  it('names Livd on every logo image, for a client with images turned off', () => {
    for (const image of html().match(/<img[^>]*livd-logo[^>]*>/g) ?? []) {
      expect(image).toContain('alt="Livd"');
    }
  });
});

describe('both emails together', () => {
  it('draw on the same two grounds, so two Livd emails look like one sender', () => {
    const html = notification().toLowerCase();
    const template = TEMPLATE_MARKUP.toLowerCase();

    for (const value of Object.values(EMAIL_PALETTE.light)) {
      expect(html, `notification email is missing ${value}`).toContain(value.toLowerCase());
      expect(template, `sign-in template is missing ${value}`).toContain(value.toLowerCase());
    }
  });
});
