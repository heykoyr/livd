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
  | 'review_snapshot_taken'

  /* Reports and cases */
  | 'report_resolved'
  | 'case_created'
  | 'case_assigned'
  | 'case_status_changed'
  | 'case_priority_changed'
  | 'case_note_added'
  | 'case_closed'

  /* Evidence */
  | 'evidence_added'
  | 'evidence_accessed'
  | 'evidence_withdrawn'
  | 'verification_evidence_accessed'
  | 'verification_decided'

  /* Verification and claims */
  | 'location_checks_reviewed'
  | 'property_claim_decided'

  /* Legal */
  | 'authority_request_created'
  | 'authority_request_updated'
  | 'disclosure_recorded'

  /* Platform */
  | 'data_exported'
  | 'audit_log_read'
  | 'security_config_changed';

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
  'data_exported',
  'security_config_changed',
]);
