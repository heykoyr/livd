import 'server-only';

import { hasRole, requireUser } from '@/server/auth/guards';
import type { AdminAttention } from '@/server/data/repository';

/**
 * What needs attention.
 *
 * Not through `runAdminAction`, and unlike the audit trail this one is not a
 * judgement call: there is nothing here to audit. The dashboard reads counts
 * and ages. It touches no identity, no review body and no position, and every
 * route out of it leads to a page that authorises and records whatever it then
 * shows.
 *
 * Auditing it would produce an entry every time anybody opened the console,
 * which is the fastest way to make an audit log unreadable — and it would say
 * nothing, because "somebody looked at how much work there is" is not a fact
 * about a person.
 */

const NOTHING: AdminAttention = {
  pendingReviews: { count: 0, oldest: null },
  openReports: { count: 0, oldest: null },
  openFlags: { count: 0, oldest: null },
  pendingVerifications: { count: 0, oldest: null },
  pendingClaims: { count: 0, oldest: null },
  cases: { open: 0, unassigned: 0, mine: 0, critical: 0, oldest: null },
  trustAndSafety: null,
  platform: { properties: 0, reviews: 0, users: 0, reviewsLast30Days: 0 },
};

export async function readAttention(): Promise<AdminAttention> {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return NOTHING;
  }

  if (!hasRole(actor, 'moderator')) return NOTHING;

  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();

  try {
    return await repository.adminAttention(actor.id);
  } catch {
    // The database has already refused, or something is wrong with it. An
    // empty dashboard is the honest rendering of "nothing could be read";
    // a stack trace on the first page of the console is not.
    return NOTHING;
  }
}
