import 'server-only';

import { SITE, absoluteUrl } from '@/config/site';

/**
 * The Livd email.
 *
 * One shell, filled by every message. It is a table because email clients are
 * a decade behind browsers and Outlook still lays out with tables, and it is
 * inline-styled because Gmail strips `<style>` from forwarded mail.
 *
 * It carries **both** colour schemes: the light one inline on every element,
 * the dark one in a `prefers-color-scheme` block. A reader on a dark device
 * gets the dark message, a reader on a light one gets the light message, and
 * neither is a guess.
 *
 * The one client that cannot be asked is Gmail, which supports neither that
 * query nor the `color-scheme` meta. In its dark theme it rewrites the
 * message itself: it inverts grounds and text, and it never touches the
 * pixels of an image. This is worth being precise about, because it has now
 * broken the logo twice in opposite directions. A light message inverts to
 * dark and a *dark* one inverts to light, so whichever file were sent would
 * land on the wrong ground in one of Gmail's two modes — white on white, or
 * black on black. Type cannot land wrong, because type inverts along with the
 * ground under it.
 *
 * So Gmail gets the wordmark set as type, which is what this email always
 * used and what survives its inversion intact, and every client that answers
 * the media query gets the official logo file drawn for the ground it just
 * reported. That is why the logo is three elements here, two of them always
 * hidden.
 *
 * Within those constraints it is the same design as the product: paper and
 * ink, one hairline, one accent, typography carrying the hierarchy. No hero
 * image, no gradient, no social icons.
 *
 * Both logo files are PNG, because no client renders SVG, and both are
 * transparent, because a ground baked into the image is the white rectangle
 * that started all this. Each carries `alt="Livd"` styled like the type it
 * stands in for, so a reader with images off sees the word where the logo
 * would have been.
 *
 * Every message has a plain-text twin. It is not a fallback nobody reads — a
 * message with no text part scores worse with every spam filter there is, and
 * some people genuinely read mail as text.
 */

export interface EmailBlock {
  /** A paragraph. */
  text: string;
}

export interface EmailShellInput {
  /** The <h1>. Short; the subject already said it once. */
  heading: string;
  /** Body paragraphs, in order. */
  paragraphs: string[];
  action?: { label: string; href: string };
  /**
   * The quiet line above the footer that says why this arrived. Required —
   * an unexplained email from a platform is indistinguishable from a phish.
   */
  why: string;
  /** Whether to offer the preferences link. Off for account-standing mail. */
  managePreferences: boolean;
}

/**
 * Both grounds a Livd email can be read on, and the ink on each.
 *
 * These are the product's own tokens, value for value — the light theme and
 * its dark remap, not a second palette invented for mail.
 * `tests/notify/email-ground.test.ts` reads both out of `globals.css` and
 * fails if mail and product ever part company, and holds the sign-in
 * template, which is a static file the dashboard owns, to the same values.
 */
export const EMAIL_PALETTE = {
  light: {
    canvas: '#FBFAF8',
    surface: '#FFFFFF',
    border: '#E5E1D9',
    ink: '#17191A',
    inkMuted: '#5C5F5B',
    inkSubtle: '#6D7069',
    brand: '#12312A',
    /** On the brand fill — the one place a canvas colour is used as ink. */
    brandInk: '#FBFAF8',
  },
  dark: {
    canvas: '#0D0E0D',
    surface: '#161816',
    border: '#2A2D2A',
    ink: '#F2F1ED',
    inkMuted: '#A3A69F',
    inkSubtle: '#83867F',
    brand: '#D8E4DE',
    brandInk: '#0D0E0D',
  },
} as const;

/**
 * The light scheme goes inline, on the element, because it is the one a
 * client gets when it tells us nothing. The dark scheme is in the stylesheet
 * below, reached by class.
 */
const INK = EMAIL_PALETTE.light.ink;
const INK_MUTED = EMAIL_PALETTE.light.inkMuted;
const INK_SUBTLE = EMAIL_PALETTE.light.inkSubtle;
const BORDER = EMAIL_PALETTE.light.border;
const CANVAS = EMAIL_PALETTE.light.canvas;
const SURFACE = EMAIL_PALETTE.light.surface;
const BRAND = EMAIL_PALETTE.light.brand;
const BRAND_INK = EMAIL_PALETTE.light.brandInk;

/**
 * What an inline style cannot say: the dark scheme, and which logo goes with
 * it. Only a client that answers `prefers-color-scheme` sees any of this, and
 * a client that answers it is a client that is not rewriting the message on
 * its own account — so here the ground and the logo can be chosen together.
 */
const DARK_SCHEME = `
@media (prefers-color-scheme: light) {
  .livd-type { display: none !important; }
  .livd-logo-light { display: block !important; }
}
@media (prefers-color-scheme: dark) {
  .livd-canvas { background-color: ${EMAIL_PALETTE.dark.canvas} !important; }
  .livd-card { background-color: ${EMAIL_PALETTE.dark.surface} !important; border-color: ${EMAIL_PALETTE.dark.border} !important; }
  .livd-ink { color: ${EMAIL_PALETTE.dark.ink} !important; }
  .livd-muted { color: ${EMAIL_PALETTE.dark.inkMuted} !important; }
  .livd-subtle { color: ${EMAIL_PALETTE.dark.inkSubtle} !important; }
  .livd-button { background-color: ${EMAIL_PALETTE.dark.brand} !important; color: ${EMAIL_PALETTE.dark.brandInk} !important; }
  .livd-type { display: none !important; }
  .livd-logo-dark { display: block !important; }
}`.trim();

/**
 * The logo, three elements and two outcomes — see the note at the top of this
 * file. The type is what Gmail keeps; the files are what everyone who can
 * tell us their ground gets.
 */
function logo(): string {
  const image = (variant: 'light' | 'dark', file: string, ink: string) =>
    `<img src="${escapeHtml(absoluteUrl(`/brand/email/${file}`))}" alt="Livd" width="82" height="24" class="livd-logo-${variant}" style="display:none;mso-hide:all;border:0;width:82px;height:24px;font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:600;letter-spacing:-0.02em;color:${ink};text-decoration:none;">`;

  return (
    `<span class="livd-type" style="font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:600;letter-spacing:-0.02em;color:${INK};">Livd<span style="color:#AA5329;">.</span></span>` +
    image('light', 'livd-logo.png', INK) +
    image('dark', 'livd-logo-white.png', EMAIL_PALETTE.dark.ink)
  );
}

/** Belt and braces: every string interpolated into the HTML goes through this. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function preferencesUrl(): string {
  return absoluteUrl('/account/notifications');
}

export function renderEmail(input: EmailShellInput): { html: string; text: string } {
  const heading = escapeHtml(input.heading);
  const paragraphs = input.paragraphs.map((paragraph) => escapeHtml(paragraph));
  const why = escapeHtml(input.why);

  const body = paragraphs
    .map(
      (paragraph) =>
        `<p class="livd-ink" style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK};">${paragraph}</p>`,
    )
    .join('');

  const action = input.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
         <tr><td class="livd-button" style="border-radius:8px;background:${BRAND};">
           <a href="${escapeHtml(input.action.href)}" class="livd-button"
              style="display:inline-block;padding:12px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:${BRAND_INK};text-decoration:none;border-radius:8px;">${escapeHtml(
                input.action.label,
              )}</a>
         </td></tr>
       </table>`
    : '';

  const manage = input.managePreferences
    ? ` <a href="${escapeHtml(
        preferencesUrl(),
      )}" class="livd-subtle" style="color:${INK_SUBTLE};text-decoration:underline;">Choose which emails you get</a>.`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${heading}</title>
<style>${DARK_SCHEME}</style>
</head>
<body class="livd-canvas" style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${
    paragraphs[0]?.slice(0, 120) ?? ''
  }</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="livd-canvas" style="background:${CANVAS};padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <tr><td style="padding:0 0 20px;">
          <a href="${escapeHtml(SITE.url)}" style="display:inline-block;text-decoration:none;">${logo()}</a>
        </td></tr>

        <tr><td class="livd-card" style="background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;padding:28px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <h1 class="livd-ink" style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.25;font-weight:600;letter-spacing:-0.01em;color:${INK};">${heading}</h1>
          ${body}
          ${action}
        </td></tr>

        <tr><td style="padding:20px 2px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <p class="livd-muted" style="margin:0 0 10px;font-size:12px;line-height:1.6;color:${INK_MUTED};">${why}${manage}</p>
          <p class="livd-subtle" style="margin:0;font-size:12px;line-height:1.6;color:${INK_SUBTLE};">
            Livd — ${escapeHtml(SITE.tagline)}<br>
            <a href="${escapeHtml(SITE.url)}" class="livd-subtle" style="color:${INK_SUBTLE};text-decoration:underline;">${escapeHtml(
              SITE.url.replace(/^https?:\/\//, ''),
            )}</a>
          </p>
        </td></tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    'LIVD',
    '',
    input.heading,
    '',
    ...input.paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...(input.action ? [`${input.action.label}: ${input.action.href}`, ''] : []),
    '—',
    input.why + (input.managePreferences ? ` Choose which emails you get: ${preferencesUrl()}` : ''),
    `Livd — ${SITE.tagline}  ${SITE.url}`,
  ].join('\n');

  return { html, text };
}

/**
 * Headers every Livd notification carries.
 *
 * `List-Unsubscribe` points at the preferences page rather than at a one-click
 * endpoint. One-click unsubscribe (RFC 8058) requires an unauthenticated POST
 * that mutates an account's settings from a token in a URL, and these are
 * transactional messages about a person's own content — the trade is not
 * worth a new unauthenticated mutation surface. The page behind the link
 * turns every one of these off in two clicks.
 *
 * `Auto-Submitted` stops out-of-office replies bouncing back at the sender.
 */
export function notificationHeaders(): Record<string, string> {
  return {
    'List-Unsubscribe': `<${preferencesUrl()}>`,
    'Auto-Submitted': 'auto-generated',
    'X-Entity-Ref-ID': 'livd-notification',
  };
}
