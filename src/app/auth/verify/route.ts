import { NextResponse } from 'next/server';

import { livdOrigins, resolveDataBackend } from '@/config/site';
import { destinationFromLink, parseEmailLinkParams } from '@/lib/auth/confirm-link';
import {
  classifyVerifyFailure,
  resolveSpentLink,
  type LinkFailure,
} from '@/lib/auth/sign-in-failures';
import { checkRateLimit } from '@/lib/safety/rate-limit';
import { logAuthEvent } from '@/server/auth/auth-log';
import { lookUpSpentLink, recordRedeemedLink } from '@/server/auth/link-status';
import { createServerSupabaseClient } from '@/server/auth/supabase-client';

/**
 * Redeems a sign-in link. POST only — see `/auth/confirm` for why opening a
 * link must never be enough.
 *
 * `verifyOtp` with the token hash checks the token against what Supabase
 * stored when it sent the email, spends it, and returns a session; the SSR
 * client writes that session into `httpOnly` cookies on this response. It is
 * the flow Supabase documents for server-rendered apps, and it is the reason
 * the browser that opens the link does not have to be the one that asked.
 *
 * One-time use is Supabase's, not Livd's: a token is deleted as it is
 * redeemed, so a second POST of the same form fails, whoever sends it.
 *
 * Nothing about the token is logged, and every response is a redirect to a
 * page that carries no part of it.
 */

export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Login CSRF: without this, another site could post its own account's token
  // here and sign a visitor into an account that is not theirs. The page that
  // posts is served with `Referrer-Policy: same-origin`, so a genuine request
  // always carries this site's Origin.
  if (!isSameOriginPost(request, url.origin)) {
    logAuthEvent('warn', { event: 'link_verify', outcome: 'cross_origin', route: '/auth/verify' });
    return new Response('Forbidden', { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const field = (name: string): string | null => {
    const value = form?.get(name);
    return typeof value === 'string' ? value : null;
  };

  const next = destinationFromLink(field('next'), [url.origin, ...livdOrigins()]);
  const link = parseEmailLinkParams({ token_hash: field('token_hash'), type: field('type') });

  if (!link) return failed('invalid', next, url);

  // The local adapter sends no email, so no link can be real; saying so beats
  // a 500 from a Supabase client with nothing to connect to.
  if (resolveDataBackend() !== 'supabase') return failed('unknown', next, url);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = await checkRateLimit('authLinkVerify', `origin:${ip}`);
  if (!limit.allowed) return failed('rate_limited', next, url);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });

  if (!error) {
    await recordRedeemedLink([link.tokenHash]);
    logAuthEvent('info', { event: 'link_verify', outcome: 'signed_in', route: '/auth/verify' });
    return seeOther(new URL(next, url));
  }

  const outcome = classifyVerifyFailure(error);
  const failure = outcome === 'spent' ? resolveSpentLink(await lookUpSpentLink(link.tokenHash)) : outcome;

  logAuthEvent(failure === 'unknown' ? 'error' : 'warn', {
    event: 'link_verify',
    outcome: failure,
    route: '/auth/verify',
    providerCode: error.code,
    providerStatus: error.status,
  });

  return failed(failure, next, url);
}

function isSameOriginPost(request: Request, ownOrigin: string): boolean {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return origin === ownOrigin;

  // Some browsers send `Origin: null` or none at all; the fetch metadata
  // header answers the same question where it exists.
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

/**
 * Back to the sign-in page, which explains what happened and offers a new
 * link. A person who is in fact signed in — a second tap on a link that has
 * just worked — is sent straight on by that page instead.
 */
function failed(failure: LinkFailure, next: string, url: URL): Response {
  return seeOther(new URL(`/sign-in?error=${failure}&next=${encodeURIComponent(next)}`, url));
}

/** 303, so the browser follows with a GET and a refresh cannot re-post the token. */
function seeOther(location: URL): Response {
  const response = NextResponse.redirect(location, 303);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
