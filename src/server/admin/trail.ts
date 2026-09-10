import 'server-only';

import { hasRole, requireUser } from '@/server/auth/guards';
import type {
  AuditActionSummary,
  AuditActorSummary,
  AuditFeedFilters,
  AuditFeedPage,
} from '@/server/data/repository';

/**
 * Reading the audit trail.
 *
 * Three reads rather than one operation, and none of them goes through
 * `runAdminAction`. That is deliberate and worth explaining, because it is the
 * one place in this directory where the pipeline is bypassed on purpose.
 *
 * `runAdminAction` emits the audit entry *after* the operation returns. For
 * every other operation that is exactly right. For this one it would be a
 * second-best guarantee: `livd_admin_audit_feed` writes its own
 * `audit_log_read` entry inside the statement block that answers the query, so
 * the read and the record cannot come apart even if the process dies between
 * them. Auditing here as well would produce two rows for one look.
 *
 * The same reasoning as `livd_reveal_user_identity` in Phase 4, and the same
 * conclusion: where the database can make an act and its record atomic, it
 * should, and the layer should get out of the way.
 *
 * The authorisation check is still here, and still re-checked in the database
 * against `auth.uid()`. Neither is trusted alone.
 */

const NOT_AUTHORISED: AuditFeedPage = { items: [], total: 0, page: 1, pageSize: 50 };

/**
 * A page of the trail.
 *
 * Returns an empty page rather than throwing when the reader is not entitled
 * to it. The database has already refused them; the page above renders an
 * explanation rather than a stack trace.
 */
export async function readAuditTrail(filters: AuditFeedFilters = {}): Promise<AuditFeedPage> {
  const actor = await currentTrustAdmin();
  if (!actor) return { ...NOT_AUTHORISED, pageSize: filters.pageSize ?? 50 };

  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();

  try {
    return await repository.listAuditFeed({ ...filters, readerId: actor });
  } catch {
    return { ...NOT_AUTHORISED, pageSize: filters.pageSize ?? 50 };
  }
}

/** Counts by action. Not a recorded read — see the note in the repository. */
export async function readAuditSummary(
  since: string | null = null,
): Promise<AuditActionSummary[]> {
  if (!(await currentTrustAdmin())) return [];

  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();

  try {
    return await repository.auditActionSummary(since);
  } catch {
    return [];
  }
}

/** Who appears in the trail. Also not a recorded read. */
export async function readAuditActors(
  since: string | null = null,
): Promise<AuditActorSummary[]> {
  if (!(await currentTrustAdmin())) return [];

  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();

  try {
    return await repository.auditActors(since);
  } catch {
    return [];
  }
}

/** The reader's id when they may read the trail, and null when they may not. */
async function currentTrustAdmin(): Promise<string | null> {
  try {
    const actor = await requireUser();
    return hasRole(actor, 'trust_admin') ? actor.id : null;
  } catch {
    return null;
  }
}
