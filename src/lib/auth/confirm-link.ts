import { safeNextPath } from './safe-redirect';

/**
 * Reading a sign-in link.
 *
 * The email Supabase sends links to `/auth/confirm` on the Site URL, carrying
 * three things (see `supabase/templates/magic-link.html`):
 *
 *   token_hash  the one-time token, hashed. Redeemed with `verifyOtp`, which
 *               needs nothing from the browser that asked for the email — so a
 *               link requested in Safari and opened in Chrome still works.
 *   type        `email`, which covers both a first sign-in (Supabase's "confirm
 *               signup") and every one after it ("magic link").
 *   next        `{{ .RedirectTo }}`: the address Livd asked Supabase to return
 *               to, which carries the page the person was trying to reach.
 *
 * Everything here is pure, so the rules can be tested without a request.
 */

export type EmailLinkType = 'email' | 'magiclink' | 'signup';

const LINK_TYPES: readonly EmailLinkType[] = ['email', 'magiclink', 'signup'];

/**
 * GoTrue's token hashes are a hex SHA-224, prefixed `pkce_` when the request
 * used PKCE. Checked loosely on purpose: a stricter pattern would turn a
 * harmless change in Supabase's format into every sign-in failing. This only
 * has to keep obvious junk, and anything that could be a payload, out.
 */
const TOKEN_HASH = /^[A-Za-z0-9_-]{16,128}$/;

export interface EmailLinkParams {
  tokenHash: string;
  type: EmailLinkType;
}

export function parseEmailLinkParams(params: {
  token_hash?: string | null;
  type?: string | null;
}): EmailLinkParams | null {
  const tokenHash = params.token_hash?.trim();
  if (!tokenHash || !TOKEN_HASH.test(tokenHash)) return null;

  const type = (params.type ?? 'email') as EmailLinkType;
  if (!LINK_TYPES.includes(type)) return null;

  return { tokenHash, type };
}

/**
 * The page to land on after signing in, from whatever the link carried.
 *
 * Always a path on this site, never a host — the result goes through
 * `safeNextPath`, the one rule every sign-in destination follows.
 *
 * `raw` is usually an absolute URL, because the template passes on
 * `{{ .RedirectTo }}` and Livd sends Supabase an absolute address. When that
 * address is one of Livd's own sign-in routes, the real destination is its
 * `next` parameter, and it is unwrapped. An address on a host that is not
 * Livd's yields the home page rather than borrowing its path.
 *
 * The email template cannot be unit tested against Supabase's renderer, which
 * may or may not percent-encode the value. Both are handled: a `next` whose
 * own query string was not encoded simply loses its tail, and still lands on
 * a Livd page.
 */
export function destinationFromLink(
  raw: string | null | undefined,
  livdOrigins: readonly string[],
): string {
  if (!raw) return safeNextPath(null);
  if (raw.startsWith('/')) return safeNextPath(raw);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return safeNextPath(null);
  }

  if (!livdOrigins.includes(url.origin)) return safeNextPath(null);

  if (url.pathname === '/auth/callback' || url.pathname === '/auth/confirm') {
    return safeNextPath(url.searchParams.get('next'));
  }

  return safeNextPath(`${url.pathname}${url.search}${url.hash}`);
}
