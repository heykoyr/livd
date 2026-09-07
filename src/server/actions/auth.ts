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

export async function signOut(): Promise<void> {
  await destroySession();
  redirect('/');
}
