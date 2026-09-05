import 'server-only';

import { redirect } from 'next/navigation';

import type { UserProfile, UserRole } from '@/types/domain';
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

/** Ordered by privilege. A role satisfies any requirement at or below it. */
const ROLE_RANK: Record<UserRole, number> = {
  resident: 0,
  owner: 1,
  moderator: 2,
  admin: 3,
};

export function hasRole(user: UserProfile | null, required: UserRole): boolean {
  if (!user) return false;
  if (user.status !== 'active') return false;
  return ROLE_RANK[user.role] >= ROLE_RANK[required];
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

export async function requireRole(required: UserRole): Promise<UserProfile> {
  const user = await requireUser();
  if (!hasRole(user, required)) throw new AuthorisationError();
  return user;
}

/**
 * For pages: redirects to sign-in, preserving where the user was going so they
 * land back on it afterwards.
 */
export async function requireUserPage(returnTo: string): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  return user;
}

export async function requireRolePage(required: UserRole, returnTo: string): Promise<UserProfile> {
  const user = await requireUserPage(returnTo);
  // Not found rather than forbidden: an unauthorised visitor should not learn
  // that an admin area exists at this path.
  if (!hasRole(user, required)) redirect('/not-found');
  return user;
}
