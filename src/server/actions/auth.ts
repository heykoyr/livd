'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { resolveDataBackend } from '@/config/site';
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
  next: z.string().startsWith('/').max(500).optional(),
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

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/auth/callback?next=${
          encodeURIComponent(next ?? '/')
        }`,
      },
    });

    // Deliberately not reporting "no such account": whether an address is
    // registered is not something an unauthenticated visitor should learn.
    if (error) return { error: copy.errors.genericBody, sentTo: null };

    return { error: null, sentTo: email };
  }

  // Local adapter: create or find the account and sign in immediately.
  const repository = await getRepository();
  const user = await repository.upsertUser({ email });
  await createLocalSession(user.id);

  redirect(next ?? '/');
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect('/');
}
