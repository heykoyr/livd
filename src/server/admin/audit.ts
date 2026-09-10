import 'server-only';

/**
 * The administrative audit vocabulary.
 *
 * Postgres accepts any string in `admin_audit_log.action`, deliberately — an
 * audit write must never fail, and an enum turns "somebody added an action type
 * and forgot the migration" into "the sensitive thing happened and nothing
 * recorded it". The vocabulary is enforced here instead, where a mistake costs
 * a type error rather than a missing record.
 *
 * This union is therefore the real definition of what Livd audits. Adding an
 * entry needs no migration; using one that is not here does not compile.
 *
 * IT COVERS BOTH TRAILS
 *
 * Livd keeps two, and 0035 explains why they are not merged:
 *
 *   `moderation_actions`  what was decided about content and accounts, with
 *                         the previous and new state of the thing decided
 *   `admin_audit_log`     who touched a person's information, including the
 *                         reads, and including the refused attempts
 *
 * Some names below are written directly by the administrative layer into the
 * audit log; others exist only in the moderation trail, under a different
 * string, and reach this vocabulary through `normaliseAuditAction`. Both kinds
 * are listed, because this union is what a reader filters by and a reader does
 * not care which table a decision was recorded in.
 *
 * NOTHING IS LISTED HERE THAT NOTHING EMITS
 *
 * A vocabulary entry for an action no code takes is a claim that Livd audits
 * something it does not. Five were removed in Phase 10 for exactly that
 * reason — `data_exported` and `security_config_changed` (nothing exports and
 * nothing changes security configuration from the application),
 * `review_snapshot_taken` (a trigger writes snapshots, with no actor to
 * attribute), `case_closed` (a closure is a `case_status_changed`), and
 * `location_checks_reviewed` (the page reads decisions, and holds neither an
 * identity nor a position — there is nothing there to cross a boundary with).
 *
 * `tests/safety/audit-coverage.test.ts` keeps it that way.
 */

export type AdminAuditAction =
  /* Identity — the boundary that matters most on this platform. */
  | 'identity_revealed'
  | 'user_directory_searched'

  /* People */
  | 'user_role_changed'
  | 'user_status_changed'
  | 'user_sanctioned'
  | 'user_sanction_lifted'
  | 'user_detail_viewed'

  /* Content */
  | 'review_status_changed'
  | 'review_verification_changed'

  /* Reports and cases */
  | 'report_resolved'
  | 'case_created'
  | 'case_assigned'
  | 'case_status_changed'
  | 'case_priority_changed'
  | 'case_note_added'

  /* Evidence */
  | 'evidence_added'
  | 'evidence_accessed'
  | 'evidence_withdrawn'
  | 'verification_evidence_accessed'
  | 'verification_decided'

  /* Claims */
  | 'property_claim_decided'

  /* Legal */
  | 'authority_request_created'
  | 'authority_request_updated'
  | 'disclosure_recorded'

  /* The trail itself */
  | 'audit_log_read';

/**
 * Maps a `moderation_actions` action string onto this vocabulary.
 *
 * Mirrors `livd_normalise_audit_action` in 0036 exactly — the local adapter
 * uses this, Postgres uses that, and `tests/safety/audit-coverage.test.ts`
 * checks they agree on every case.
 *
 * Unmapped values pass through unchanged rather than becoming 'other'. An
 * action nobody has taught this function about should look conspicuous in the
 * list, not disappear into a bucket.
 */
export function normaliseAuditAction(raw: string): string {
  if (raw.startsWith('set_status:')) return 'review_status_changed';
  if (raw.startsWith('set_verification:')) return 'review_verification_changed';
  if (raw.startsWith('report_')) return 'report_resolved';
  if (raw.startsWith('claim_')) return 'property_claim_decided';
  if (raw.startsWith('verification_')) return 'verification_decided';
  if (raw === 'role_changed') return 'user_role_changed';
  if (raw === 'status_changed') return 'user_status_changed';
  return raw;
}

/** What an audit entry is about. Mirrors the check constraint in 0023. */
export type AdminSubjectType =
  | 'user'
  | 'review'
  | 'property'
  | 'claim'
  | 'verification'
  | 'case'
  | 'evidence'
  | 'sanction'
  | 'authority_request'
  | 'export'
  | 'security';

export type AdminAuditOutcome = 'succeeded' | 'denied' | 'failed';

/**
 * One entry.
 *
 * `detail` carries structured context — which case, which fields were
 * disclosed, what changed. It must never carry the value being protected: an
 * audit log that quotes the email address it is recording access to has become
 * a second copy of the thing it exists to guard.
 */
export interface AdminAuditEntry {
  /**
   * The acting administrator, as the application understands them.
   *
   * The Supabase adapter does **not** trust this: `livd_record_admin_audit`
   * stamps the actor and their role from `auth.uid()`, so an entry there cannot
   * name an author who did not do the thing. It is carried for the local
   * adapter, which has no session — the same asymmetry as `setUserRole`, and
   * the same reason.
   */
  actorId: string;
  action: AdminAuditAction;
  subjectType: AdminSubjectType;
  subjectId: string | null;
  outcome: AdminAuditOutcome;
  reason: string | null;
  detail: Record<string, string | number | boolean | null>;
  /** Salted digest of the request origin. Never a raw address. */
  actorIpHash: string | null;
}

/**
 * Actions that cross the identity boundary, or otherwise reach something a
 * person would want to know had been looked at.
 *
 * The layer refuses to run one of these without a written reason. That is not
 * a UI convention — `runAdminAction` enforces it before the operation is
 * reached, so an action added later inherits the rule by being listed here
 * rather than by its author remembering.
 *
 * `audit_log_read` is deliberately absent. Requiring a written reason to open
 * the trail would mean the people meant to be checking it stop opening it, and
 * an audit log nobody reads deters nothing. The read is recorded; it does not
 * have to be justified.
 */
export const REASON_REQUIRED: ReadonlySet<AdminAuditAction> = new Set<AdminAuditAction>([
  'identity_revealed',
  'user_role_changed',
  'user_status_changed',
  'user_sanctioned',
  'user_sanction_lifted',
  'review_status_changed',
  'evidence_accessed',
  'verification_evidence_accessed',
  'disclosure_recorded',
]);
