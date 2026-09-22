import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { safeNextPath } from '@/lib/auth/safe-redirect';
import {
  classifyCodeExchangeFailure,
  classifyReturnedError,
  type LinkFailure,
} from '@/lib/auth/sign-in-failures';
import { logAuthEvent } from '@/server/auth/auth-log';
import { createServerSupabaseClient } from '@/server/auth/supabase-client';

/**
 * Where a PKCE sign-in returns: Google, and — only if the email template were
 * ever reverted to Supabase's default `{{ .ConfirmationURL }}` — an email link.
 * Email links normally go to `/auth/confirm` instead.
 *
 * PKCE means the return carries a one-time `code` that is worthless without a
 * secret (the verifier) that the starting browser kept in a cookie. That is
 * exactly right for Google, where one tab does the whole round trip. It is
 * exactly wrong for email, where the link opens wherever the mail app decides —
 * which is how an iPhone that requested a link in Safari and opened it in
 * Chrome ended up at "that link did not work". So when this fails, it now says
 * which of those things happened instead of blaming the link.
 *
 * The exchange happens server-side and the browser is redirected away at once,
 * so the code does not linger in history or a referrer. Session cookies are
 * `httpOnly` and set on the redirect.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  // Same rule as the sign-in page and the action that sent the link: a path on
  // this site, never a host. A destination that survives a round trip through
  // an email or an identity provider is exactly the shape of an open redirect.
  const next = safeNextPath(url.searchParams.get('next'));

  // Supabase and Google report their own failures — an expired link, a
  // cancelled consent screen — as query parameters rather than a code.
  if (url.searchParams.has('error') || url.searchParams.has('error_code')) {
    const failure = classifyReturnedError(url.searchParams);
    logAuthEvent('warn', {
      event: 'code_exchange',
      outcome: failure,
      route: '/auth/callback',
      providerCode: url.searchParams.get('error_code') ?? url.searchParams.get('error') ?? undefined,
    });
    return failed(failure, next, url);
  }

  if (!code) return failed('invalid', next, url);

  // Looked for before asking Supabase, because its absence is the whole
  // answer: this browser did not start this sign-in.
  const verifierPresent = (await cookies())
    .getAll()
    .some((cookie) => cookie.name.endsWith('-auth-token-code-verifier') && cookie.value !== '');

  if (!verifierPresent) {
    logAuthEvent('warn', { event: 'code_exchange', outcome: 'browser', route: '/auth/callback' });
    return failed('browser', next, url);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const failure = classifyCodeExchangeFailure(error, verifierPresent);
    logAuthEvent(failure === 'unknown' ? 'error' : 'warn', {
      event: 'code_exchange',
      outcome: failure,
      route: '/auth/callback',
      providerCode: error.code,
      providerStatus: error.status,
    });
    return failed(failure, next, url);
  }

  logAuthEvent('info', { event: 'code_exchange', outcome: 'signed_in', route: '/auth/callback' });

  // `new URL(next, url)` resolves against the request's own origin, so the
  // redirect works on localhost, on a preview deployment and in production
  // without any of them being named here.
  return noStore(NextResponse.redirect(new URL(next, url)));
}

function failed(failure: LinkFailure, next: string, url: URL): Response {
  return noStore(
    NextResponse.redirect(new URL(`/sign-in?error=${failure}&next=${encodeURIComponent(next)}`, url)),
  );
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
