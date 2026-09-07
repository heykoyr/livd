import { NextResponse } from 'next/server';

import { safeNextPath } from '@/lib/auth/safe-redirect';
import { createServerSupabaseClient } from '@/server/auth/supabase-client';

/**
 * Where a magic link lands.
 *
 * Supabase Auth runs the PKCE flow: the email carries a one-time `code`, and a
 * session exists only once that code has been exchanged for one. Until this
 * route existed nothing performed that exchange, so every link in every email
 * issued a code that was never redeemed — three of them, and zero sessions, by
 * the time anyone looked at `auth.flow_state`.
 *
 * The exchange happens server-side. The code arrives in a URL, which means it
 * can end up in a browser history entry, a referrer header or a shared link, so
 * it is spent immediately and the browser is redirected away from it. The
 * session cookies Supabase issues are `httpOnly`, set on the redirect response
 * and never visible to client JavaScript.
 *
 * Nothing here decides who you are. `exchangeCodeForSession` validates the code
 * against the flow state Supabase stored when it sent the email; this route
 * only carries the result and picks a destination.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  // Same rule as the sign-in page and the action that sent the link: a path on
  // this site, never a host. A destination that survives an email round trip is
  // exactly the shape of an open redirect.
  const next = safeNextPath(url.searchParams.get('next'));

  // Supabase reports its own failures — an expired link, a link already used —
  // as query parameters rather than as a missing code.
  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error');

  if (providerError || !code) {
    return NextResponse.redirect(new URL(`/sign-in?error=link&next=${encodeURIComponent(next)}`, url));
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Deliberately not passing the provider's message through: it distinguishes
    // "expired" from "already used" from "no such code", and a stranger holding
    // an intercepted link should not learn which.
    return NextResponse.redirect(new URL(`/sign-in?error=link&next=${encodeURIComponent(next)}`, url));
  }

  // `new URL(next, url)` resolves against the request's own origin, so the
  // redirect works on localhost, on a preview deployment and in production
  // without any of them being named here.
  return NextResponse.redirect(new URL(next, url));
}
