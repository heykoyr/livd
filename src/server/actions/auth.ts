'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { SIGN_IN_EMAIL, SITE, resolveDataBackend } from '@/config/site';
import { safeNextPath } from '@/lib/auth/safe-redirect';
import {
  classifyLinkRequestFailure,
  classifyVerifyFailure,
  resolveSpentLink,
} from '@/lib/auth/sign-in-failures';
import { copy } from '@/content/copy';
import { checkRateLimit } from '@/lib/safety/rate-limit';
import { logAuthEvent } from '@/server/auth/auth-log';
import { createLocalSession, destroySession } from '@/server/auth/session';
import { getRepository } from '@/server/data';
import type { AuthActionState, SignInCodeState } from './action-state';

/**
 * Authentication actions.
 *
 * Livd never handles a password. In production Supabase Auth emails a link and
 * a code; in local development the same form creates or finds an account and
 * signs in directly, so the whole contribution flow can be exercised without an
 * email provider. The local path refuses to run in production.
 */

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  // Validated rather than merely shaped: `safeNextPath` is the same rule the
  // sign-in page and the callback apply, so a destination cannot be smuggled
  // in at one end of the round trip and honoured at the other.
  next: z.string().optional().transform((value) => safeNextPath(value)),
});

/**
 * Asking for a sign-in email.
 *
 * What the email contains, and why it works in any browser, is described in
 * `supabase/templates/README.md`: it links to `/auth/confirm` with a token
 * hash, and the confirmation is redeemed with `verifyOtp`, which needs nothing
 * from the browser that asked. This action's job is only to ask Supabase to
 * send it and to report the result honestly.
 *
 * `emailRedirectTo` still names `/auth/callback`. The template passes it on as
 * `next`, and `/auth/confirm` unwraps the destination from it; and if the
 * template ever reverted to Supabase's default `{{ .ConfirmationURL }}`, that
 * link would land on the callback, which can still finish it in the browser
 * that asked — degraded, rather than broken.
 */
export async function requestSignIn(
  previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = emailSchema.safeParse({
    email: formData.get('email'),
    next: formData.get('next') || undefined,
  });

  const typed = typeof formData.get('email') === 'string' ? String(formData.get('email')) : null;

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? copy.errors.validationTitle,
      sentTo: null,
      email: typed,
    };
  }

  const { email, next } = parsed.data;
  const sentCount = previous.sentTo === email ? (previous.sentCount ?? 1) : 0;
  const refused = (error: string, cooldownSeconds: number | null = null): AuthActionState => ({
    error,
    // A refused resend keeps the "check your email" screen: the link already
    // sent is still good, and taking the person back to an empty form would
    // suggest otherwise.
    sentTo: previous.sentTo === email ? email : null,
    email,
    cooldownSeconds,
    sentCount,
  });

  const perAddress = await checkRateLimit('authRequest', email);
  if (!perAddress.allowed) {
    return refused(copy.auth.tooManyLinksWait, perAddress.retryAfter);
  }

  if (resolveDataBackend() === 'supabase') {
    const { originIdentifier } = await import('./reports');
    const perOrigin = await checkRateLimit('authRequestOrigin', `origin:${await originIdentifier()}`);
    if (!perOrigin.allowed) {
      return refused(copy.auth.tooManyLinksWait, perOrigin.retryAfter);
    }

    const { createServerSupabaseClient } = await import('@/server/auth/supabase-client');
    const supabase = await createServerSupabaseClient();

    // An absolute URL, always. A relative `emailRedirectTo` is discarded in
    // favour of the project's Site URL — which is how a production email once
    // came to point at localhost. `SITE.url` cannot be relative.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${SITE.url}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      const failure = classifyLinkRequestFailure(error);

      // The category and Supabase's code — never the address, which is exactly
      // the kind of record this product exists not to keep.
      logAuthEvent(failure.kind === 'unknown' || failure.kind === 'delivery_failed' ? 'error' : 'warn', {
        event: 'link_request',
        outcome: failure.kind,
        route: '/sign-in',
        providerCode: error.code,
        providerStatus: error.status,
      });

      switch (failure.kind) {
        case 'cooldown':
          return refused(copy.auth.cooldown, failure.retryAfterSeconds);
        case 'rate_limited':
          // The project-wide hourly cap. Its reset time is not reported, so no
          // countdown is invented for it.
          return refused(copy.auth.tooManyLinks);
        case 'invalid_email':
          return refused(copy.auth.invalidEmail);
        case 'delivery_failed':
          return refused(copy.auth.deliveryFailed);
        default:
          // Deliberately not reporting "no such account": whether an address is
          // registered is not something an unauthenticated visitor should learn.
          return refused(copy.errors.genericBody);
      }
    }

    logAuthEvent('info', { event: 'link_request', outcome: 'sent', route: '/sign-in' });

    return {
      error: null,
      sentTo: email,
      email,
      // Supabase will refuse this address again until its interval has passed,
      // so the resend button waits exactly that long rather than inviting a
      // refusal.
      cooldownSeconds: SIGN_IN_EMAIL.cooldownSeconds,
      sentCount: sentCount + 1,
    };
  }

  // Local adapter: create or find the account and sign in immediately.
  const repository = await getRepository();
  const user = await repository.upsertUser({ email });
  await createLocalSession(user.id);

  redirect(next);
}

const codeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  // Supabase is configured for eight digits. Six to ten are accepted so that
  // a change of length there is not an outage here; spaces are what people
  // type when they copy "1234 5678".
  code: z
    .string()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{6,10}$/)),
  next: z.string().optional().transform((value) => safeNextPath(value)),
});

/**
 * Signing in with the code printed in the email.
 *
 * The link covers the common case. The code covers the one a link cannot: the
 * email opened on a phone while the sign-in page waits on a laptop. Same token
 * underneath — using either spends both.
 */
export async function verifySignInCode(
  _previous: SignInCodeState,
  formData: FormData,
): Promise<SignInCodeState> {
  const parsed = codeSchema.safeParse({
    email: formData.get('email'),
    code: formData.get('code'),
    next: formData.get('next') || undefined,
  });

  if (!parsed.success) {
    return { status: 'error', error: copy.auth.codeMalformed, redirectTo: null };
  }

  const { email, code, next } = parsed.data;

  const limit = await checkRateLimit('authCodeVerify', email);
  if (!limit.allowed) {
    return { status: 'error', error: copy.auth.tooManyCodes, redirectTo: null };
  }

  // The local adapter signs in on the first screen and never shows a code.
  if (resolveDataBackend() !== 'supabase') {
    return { status: 'error', error: copy.errors.genericBody, redirectTo: null };
  }

  const { createServerSupabaseClient } = await import('@/server/auth/supabase-client');
  const { lookUpSpentLink, recordRedeemedLink, tokenHashesForCode } = await import(
    '@/server/auth/link-status'
  );
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  const hashes = tokenHashesForCode(email, code);

  if (!error) {
    await recordRedeemedLink(hashes);
    logAuthEvent('info', { event: 'code_verify', outcome: 'signed_in', route: '/sign-in' });
    return { status: 'signed-in', error: null, redirectTo: next };
  }

  let outcome = classifyVerifyFailure(error);
  if (outcome === 'spent') {
    // A wrong code and an expired one look identical to Supabase. The code
    // hashes to exactly what Supabase stored, so Livd can tell them apart.
    const evidence = await Promise.all(hashes.map(lookUpSpentLink));
    outcome = resolveSpentLink(
      evidence.includes('present') ? 'present' : evidence.includes('used') ? 'used' : 'unknown',
    );
  }

  logAuthEvent('warn', {
    event: 'code_verify',
    outcome,
    route: '/sign-in',
    providerCode: error.code,
    providerStatus: error.status,
  });

  const message =
    outcome === 'expired'
      ? copy.auth.codeExpired
      : outcome === 'used'
        ? copy.auth.codeUsed
        : outcome === 'rate_limited'
          ? copy.auth.linkFailures.rate_limited.body()
          : outcome === 'superseded' || outcome === 'invalid'
            ? copy.auth.codeWrong
            : copy.errors.genericBody;

  return { status: 'error', error: message, redirectTo: null };
}

/**
 * Signing in with Google.
 *
 * The one sign-in that nothing is emailed for. It was added when email links
 * were failing for everyone, on the theory that Gmail's scanner was spending
 * them. Supabase's auth logs for the failure of 21 September 2026 showed a
 * different cause: the link was opened in iOS Chrome, while the PKCE verifier
 * it needed was a cookie in Safari, where the sign-in began. Email sign-in no
 * longer depends on that (see `/auth/confirm`), and Google is simply the
 * faster of two ways in.
 *
 * Google does still use PKCE, and that is correct here: the whole round trip —
 * Livd, Google, Livd — happens in one browser tab, so the verifier is always
 * where the return lands.
 *
 * This returns a URL rather than redirecting inside the action. `redirect`
 * throws, and throwing out of a Server Action that has just set the PKCE
 * verifier cookie loses the cookie — the browser follows the thrown redirect
 * without ever committing the `Set-Cookie`. The exchange then fails at the
 * callback for exactly the reason the whole magic-link flow was failing, which
 * would be a bleak way to reintroduce the same bug.
 */
export async function startGoogleSignIn(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState & { redirectTo?: string }> {
  const next = safeNextPath(
    typeof formData.get('next') === 'string' ? String(formData.get('next')) : undefined,
  );

  if (resolveDataBackend() !== 'supabase') {
    // The local adapter signs its own cookie and has no OAuth provider to talk
    // to. Saying so beats a button that silently does nothing.
    return { error: copy.auth.googleUnavailable, sentTo: null };
  }

  // Keyed by origin rather than by email, because there is no email at this
  // point — the whole appeal of this path is that Livd learns who you are only
  // after Google has said so.
  const { originIdentifier } = await import('./reports');
  const limit = await checkRateLimit('authRequest', `oauth:${await originIdentifier()}`);
  if (!limit.allowed) {
    return { error: copy.errors.rateLimitedBody, sentTo: null };
  }

  const { createServerSupabaseClient } = await import('@/server/auth/supabase-client');
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // The same absolute-URL rule as the magic link, and for the same reason:
      // a relative value is discarded in favour of the project's Site URL.
      redirectTo: `${SITE.url}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: {
        // Ask Google to show the account chooser rather than silently reusing
        // whichever account the browser last used. People share machines, and a
        // review attributed to the wrong person is the one mistake this product
        // cannot afford.
        prompt: 'select_account',
      },
    },
  });

  if (error || !data?.url) {
    logAuthEvent('error', {
      event: 'oauth_start',
      outcome: 'failed',
      route: '/sign-in',
      providerCode: error?.code,
      providerStatus: error?.status,
    });
    return { error: copy.auth.googleFailed, sentTo: null };
  }

  return { error: null, sentTo: null, redirectTo: data.url };
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect('/');
}
