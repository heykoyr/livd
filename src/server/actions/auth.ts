'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { SITE, resolveDataBackend } from '@/config/site';
import { safeNextPath } from '@/lib/auth/safe-redirect';
import { copy } from '@/content/copy';
import { checkRateLimit } from '@/lib/safety/rate-limit';
import { createLocalSession, destroySession } from '@/server/auth/session';
import { getRepository } from '@/server/data';
import type { AuthActionState } from './action-state';

/**
 * Authentication actions.
 *
 * Livd never handles a password. In production Supabase Auth sends a magic
 * link; in local development the same form creates or finds an account and
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

export async function requestSignIn(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = emailSchema.safeParse({
    email: formData.get('email'),
    next: formData.get('next') || undefined,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? copy.errors.validationTitle,
      sentTo: null,
    };
  }

  const { email, next } = parsed.data;

  const limit = await checkRateLimit('authRequest', email);
  if (!limit.allowed) {
    return { error: copy.errors.rateLimitedBody, sentTo: null };
  }

  if (resolveDataBackend() === 'supabase') {
    const { createServerSupabaseClient } = await import('@/server/auth/supabase-client');
    const supabase = await createServerSupabaseClient();

    // An absolute URL, always. The previous form fell back to `''` when
    // NEXT_PUBLIC_SITE_URL was unset, producing a relative `emailRedirectTo`
    // that Supabase discards in favour of the project's own Site URL — which
    // is how a production email came to point at localhost. `SITE.url` resolves
    // the configured origin, then VERCEL_URL, then localhost, so there is no
    // arrangement of environment variables that yields a relative value.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${SITE.url}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      // Log it. The generic message below tells people the failure "is already
      // logged", and until this line existed that was not true — a production
      // sign-in outage had to be diagnosed by reading Supabase's own auth logs
      // through the management API, because Livd had recorded nothing at all.
      //
      // The email address is not logged. Which addresses tried to sign in is
      // exactly the kind of record this product exists not to keep.
      console.error('[livd] sign-in link request failed', {
        status: error.status,
        code: error.code,
        message: error.message,
      });

      // A send-rate limit is worth naming. It is a property of the email
      // provider, not of the account, so saying so discloses nothing about
      // whether the address is registered — and "try again shortly" is
      // something the person can act on, where "something went wrong" is not.
      if (error.status === 429 || error.code?.includes('rate_limit')) {
        return { error: copy.auth.tooManyLinks, sentTo: null };
      }

      // Everything else stays generic. Deliberately not reporting "no such
      // account": whether an address is registered is not something an
      // unauthenticated visitor should learn.
      return { error: copy.errors.genericBody, sentTo: null };
    }

    return { error: null, sentTo: email };
  }

  // Local adapter: create or find the account and sign in immediately.
  const repository = await getRepository();
  const user = await repository.upsertUser({ email });
  await createLocalSession(user.id);

  redirect(next);
}

/**
 * Signing in with Google.
 *
 * Here because of a failure mode that no amount of care in the magic-link path
 * could fix. Supabase's email links are single-use, and Gmail's security
 * scanner follows every link it delivers within about fifteen seconds — so the
 * token is spent before the person has opened the message. Every account on
 * Livd shows the signature: email confirmed, session never created, a
 * consistent fourteen-to-nineteen second gap.
 *
 * The usual remedy is to email a typed code instead of a link, which a scanner
 * cannot use. Supabase only permits editing that email once custom SMTP is
 * configured, and that needs a domain. OAuth needs neither: nothing is emailed,
 * so there is nothing to intercept.
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
    console.error('[livd] Google sign-in could not start', {
      status: error?.status,
      code: error?.code,
      message: error?.message,
    });
    return { error: copy.auth.googleFailed, sentTo: null };
  }

  return { error: null, sentTo: null, redirectTo: data.url };
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect('/');
}
