import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { safeNextPath } from '@/lib/auth/safe-redirect';
import { PATHNAME_HEADER } from '@/lib/auth/request-path';
import type { AdminRole, UserProfile, UserRole } from '@/types/domain';
import { getCurrentUser } from './session';

/**
 * Authorisation guards.
 *
 * These are the *first* of two layers. The second is Row Level Security in the
 * database, which is authoritative. Neither is trusted alone: a guard that is
 * forgotten must not become a data breach, and an RLS policy that is too
 * permissive must not become an unauthorised action.
 */

export class AuthorisationError extends Error {
  constructor(message = 'You do not have permission to do this.') {
    super(message);
    this.name = 'AuthorisationError';
  }
}

/**
 * The administrative ladder. A role satisfies any requirement at or below it.
 *
 * `owner` used to sit at rank 1, above `resident` — which modelled a property
 * owner as *more* privileged than an ordinary person. Nothing called
 * `requireRole('owner')`, so it never did any harm, but it had the hierarchy
 * pointing the wrong way for the one system where the direction matters most:
 * an owner is the party a reviewer most needs protecting from, and must never
 * accumulate access to them by climbing a ladder they should not be on.
 *
 * So they are not on it. Owning a property is a relationship to a building,
 * checked per property by `livd_owns_property`, and it confers a right of
 * reply — never a level of access to a person. `requireRole` accepts only
 * `AdminRole`, so `requireRole('owner')` is now a compile error rather than a
 * check that quietly passes for everyone.
 */
const ROLE_RANK: Record<UserRole, number> = {
  resident: 0,
  owner: 0,
  moderator: 1,
  trust_admin: 2,
  admin: 3,
};

export function hasRole(user: UserProfile | null, required: AdminRole): boolean {
  if (!user) return false;
  if (user.status !== 'active') return false;
  return ROLE_RANK[user.role] >= ROLE_RANK[required];
}

/** May cross the identity boundary — reveal an account, read verification evidence. */
export function canAccessIdentity(user: UserProfile | null): boolean {
  return hasRole(user, 'trust_admin');
}

/**
 * For Server Actions: throws rather than redirecting, so the caller can return
 * a typed error to the form instead of navigating away from unsaved work.
 */
export async function requireUser(): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorisationError('You need to be signed in to do this.');
  if (user.status === 'restricted') {
    throw new AuthorisationError(
      'Your account is restricted while a moderator reviews recent activity.',
    );
  }
  return user;
}

export async function requireRole(required: AdminRole): Promise<UserProfile> {
  const user = await requireUser();
  if (!hasRole(user, required)) throw new AuthorisationError();
  return user;
}

/**
 * Where to send somebody back to after they sign in.
 *
 * The caller passes a fallback, and the real request path wins where the
 * middleware has published one. A layout cannot see which page beneath it is
 * rendering, so the admin shell passed `/admin` for every page under it — and
 * a moderator following an emailed link to a case signed in and landed on the
 * dashboard instead, with no way back to the thing they had been sent.
 *
 * The header is a convenience, never an input to a decision. It goes through
 * `safeNextPath`, which is the same rule the sign-in page and the callback
 * apply, so a destination cannot be smuggled in at one end of the round trip
 * and honoured at the other. `headers()` can be unavailable in some rendering
 * contexts, and the fallback covers that rather than throwing.
 */
async function returnDestination(fallback: string): Promise<string> {
  try {
    const requestHeaders = await headers();
    const path = requestHeaders.get(PATHNAME_HEADER);
    if (path) {
      const safe = safeNextPath(path);
      if (safe !== '/') return safe;
    }
  } catch {
    // No request context. The fallback is correct, just less specific.
  }

  return fallback;
}

/**
 * For pages: redirects to sign-in, preserving where the user was going so they
 * land back on it afterwards.
 */
export async function requireUserPage(returnTo: string): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) {
    const destination = await returnDestination(returnTo);
    redirect(`/sign-in?next=${encodeURIComponent(destination)}`);
  }
  return user;
}

export async function requireRolePage(required: AdminRole, returnTo: string): Promise<UserProfile> {
  const user = await requireUserPage(returnTo);
  // Not found rather than forbidden: an unauthorised visitor should not learn
  // that an admin area exists at this path.
  if (!hasRole(user, required)) redirect('/not-found');
  return user;
}
