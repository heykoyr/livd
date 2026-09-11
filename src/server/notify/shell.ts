import 'server-only';

import { SITE } from '@/config/site';

/**
 * The Livd email.
 *
 * One shell, filled by every message. It is a table because email clients are
 * a decade behind browsers and Outlook still lays out with tables; it is
 * inline-styled because Gmail strips `<style>` from forwarded mail; and it is
 * light-only because a colour scheme that a client half-applies is worse than
 * one it does not apply at all.
 *
 * Within those constraints it is the same design as the product: paper and
 * ink, one hairline, one accent, typography carrying the hierarchy. No hero
 * image, no gradient, no social icons, nothing to load.
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

const INK = '#17191A';
const INK_MUTED = '#5C5F5B';
const INK_SUBTLE = '#6D7069';
const BORDER = '#E5E1D9';
const CANVAS = '#FBFAF8';
const SURFACE = '#FFFFFF';
const BRAND = '#12312A';

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
  return `${SITE.url}/account/notifications`;
}

export function renderEmail(input: EmailShellInput): { html: string; text: string } {
  const heading = escapeHtml(input.heading);
  const paragraphs = input.paragraphs.map((paragraph) => escapeHtml(paragraph));
  const why = escapeHtml(input.why);

  const body = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK};">${paragraph}</p>`,
    )
    .join('');

  const action = input.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
         <tr><td style="border-radius:8px;background:${BRAND};">
           <a href="${escapeHtml(input.action.href)}"
              style="display:inline-block;padding:12px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#FBFAF8;text-decoration:none;border-radius:8px;">${escapeHtml(
                input.action.label,
              )}</a>
         </td></tr>
       </table>`
    : '';

  const manage = input.managePreferences
    ? ` <a href="${escapeHtml(
        preferencesUrl(),
      )}" style="color:${INK_SUBTLE};text-decoration:underline;">Choose which emails you get</a>.`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${
    paragraphs[0]?.slice(0, 120) ?? ''
  }</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <tr><td style="padding:0 0 20px;">
          <a href="${escapeHtml(SITE.url)}" style="font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:600;letter-spacing:-0.02em;color:${INK};text-decoration:none;">Livd<span style="color:#AA5329;">.</span></a>
        </td></tr>

        <tr><td style="background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;padding:28px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.25;font-weight:600;letter-spacing:-0.01em;color:${INK};">${heading}</h1>
          ${body}
          ${action}
        </td></tr>

        <tr><td style="padding:20px 2px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <p style="margin:0 0 10px;font-size:12px;line-height:1.6;color:${INK_MUTED};">${why}${manage}</p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:${INK_SUBTLE};">
            Livd — ${escapeHtml(SITE.tagline)}<br>
            <a href="${escapeHtml(SITE.url)}" style="color:${INK_SUBTLE};text-decoration:underline;">${escapeHtml(
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
