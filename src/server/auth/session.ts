import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

import { resolveDataBackend } from '@/config/site';
import { getRepository } from '@/server/data';
import type { UserProfile } from '@/types/domain';

/**
 * Sessions.
 *
 * Two adapters behind one function, matching the data layer:
 *
 *   supabase — Supabase Auth (magic link / OAuth). No password is ever stored
 *              by Livd, because none is ever collected.
 *   local    — a signed cookie holding nothing but a user id. Development only;
 *              it refuses to run in production.
 *
 * `getCurrentUser` is the only way any code learns who is asking.
 */

const SESSION_COOKIE = 'livd_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Development fallback. Deliberately obvious in a diff, and never reachable in
 * production — see the boot check below.
 */
const DEVELOPMENT_SECRET = 'livd-insecure-development-secret';

/**
 * Refuses to serve a production request without a configured secret.
 *
 * Called from `getCurrentUser`, which runs on every request through the root
 * layout — so a misconfigured deployment fails on its very first request.
 *
 * The two obvious alternatives are both worse. Checking lazily inside the
 * signing function meant a deployment without a secret looked healthy:
 * requests with no session cookie returned 200, and only a reader who happened
 * to carry a stale cookie hit a 500. Checking at module scope caught it
 * earlier still, but `next build` also evaluates modules under
 * NODE_ENV=production, so it broke the build for anyone who had not configured
 * a secret yet — a build does not serve sessions and has no business demanding
 * one.
 */
function assertSessionSecretConfigured(): void {
  // `next build` prerenders pages under NODE_ENV=production and renders the
  // root layout to do it, so it reaches this function. A build serves no
  // sessions and has no business demanding a secret — the deployment that runs
  // the build may not even be the one that holds the secrets.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  if (process.env.NODE_ENV === 'production' && !process.env.LIVD_SESSION_SECRET) {
    throw new Error(
      'LIVD_SESSION_SECRET must be set in production. See .env.example for how to generate one.',
    );
  }
}

function sessionSecret(): string {
  return process.env.LIVD_SESSION_SECRET ?? DEVELOPMENT_SECRET;
}

function sign(value: string): string {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

/** Constant-time comparison, so a signature cannot be discovered by timing. */
function verify(value: string, signature: string): boolean {
  const expected = Buffer.from(sign(value));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/* -------------------------------------------------------------------------
 * Reading the session
 * ---------------------------------------------------------------------- */

export async function getCurrentUser(): Promise<UserProfile | null> {
  assertSessionSecretConfigured();

  if (resolveDataBackend() === 'supabase') {
    return getSupabaseUser();
  }
  return getLocalUser();
}

async function getLocalUser(): Promise<UserProfile | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;

  const userId = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!verify(userId, signature)) return null;

  const repository = await getRepository();
  const user = await repository.getUserById(userId);

  // A suspended account is treated as signed out everywhere, without a special
  // case at each call site.
  return user && user.status !== 'suspended' ? user : null;
}

async function getSupabaseUser(): Promise<UserProfile | null> {
  const { createServerSupabaseClient } = await import('./supabase-client');
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const repository = await getRepository();
  const profile =
    (await repository.getUserById(user.id)) ??
    (await repository.upsertUser({ id: user.id, email: user.email }));

  return profile.status === 'suspended' ? null : profile;
}

/* -------------------------------------------------------------------------
 * Writing the session (local adapter only)
 * ---------------------------------------------------------------------- */

export async function createLocalSession(userId: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The local auth adapter is disabled in production.');
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, `${userId}.${sign(userId)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV !== 'development',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);

  if (resolveDataBackend() === 'supabase') {
    const { createServerSupabaseClient } = await import('./supabase-client');
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  }
}
