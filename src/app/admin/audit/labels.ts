import type { BadgeTone } from '@/components/ui/primitives';
import type { AdminAuditAction } from '@/server/admin';

/**
 * How the trail reads.
 *
 * Written as sentences about what a person did, not as event names. "Looked up
 * an identity" is a thing somebody did; `identity_revealed` is a thing a
 * database did, and a log written in the second voice is one nobody reads.
 *
 * The tone choices carry the same rule as the rest of the console: nothing is
 * red because it was wrong. The identity actions are `caution` because they
 * crossed the boundary the product is built on and deserve a second look — not
 * because doing so was improper. Every one of them carries text as well, so
 * colour is never the only signal.
 */

export const ACTION_LABELS: Record<AdminAuditAction, string> = {
  identity_revealed: 'Looked up an identity',
  user_directory_searched: 'Searched the account directory',

  user_role_changed: 'Changed a role',
  user_status_changed: 'Changed an account standing',
  user_sanctioned: 'Applied a sanction',
  user_sanction_lifted: 'Lifted a sanction',
  user_detail_viewed: 'Opened an account',

  review_status_changed: 'Changed a review status',
  review_verification_changed: 'Changed a verification level',

  report_resolved: 'Resolved a report',
  case_created: 'Opened a case',
  case_assigned: 'Assigned a case',
  case_status_changed: 'Moved a case',
  case_priority_changed: 'Changed a case priority',
  case_note_added: 'Added a case note',

  evidence_added: 'Added evidence',
  evidence_accessed: 'Opened evidence',
  evidence_withdrawn: 'Withdrew evidence',
  verification_evidence_accessed: 'Opened a residency document',
  verification_decided: 'Decided a residency verification',

  property_claim_decided: 'Decided a property claim',

  authority_request_created: 'Recorded an authority request',
  authority_request_updated: 'Updated an authority request',
  disclosure_recorded: 'Recorded a disclosure',

  audit_log_read: 'Read the audit trail',
};

/**
 * The actions that reach a person's information rather than their content.
 *
 * Marked in the list because these are what the trail is really for. Somebody
 * scanning a hundred rows should be able to find the four that crossed the
 * identity boundary without reading every line.
 */
export const IDENTITY_ACTIONS: ReadonlySet<string> = new Set([
  'identity_revealed',
  'verification_evidence_accessed',
  'evidence_accessed',
  'disclosure_recorded',
  'user_directory_searched',
]);

export const OUTCOME_LABELS: Record<string, string> = {
  succeeded: 'Done',
  denied: 'Refused',
  failed: 'Failed',
};

export const OUTCOME_TONES: Record<string, BadgeTone> = {
  succeeded: 'neutral',
  // A refusal is the system working. It is flagged because a pattern of them
  // is worth noticing, not because the person did something wrong.
  denied: 'caution',
  failed: 'critical',
};

export const SOURCE_LABELS: Record<string, string> = {
  audit: 'Access',
  moderation: 'Decision',
};

export const SUBJECT_LABELS: Record<string, string> = {
  user: 'Account',
  review: 'Review',
  property: 'Property',
  claim: 'Claim',
  verification: 'Verification',
  case: 'Case',
  evidence: 'Evidence',
  sanction: 'Sanction',
  authority_request: 'Authority request',
  owner_response: 'Owner response',
  export: 'Export',
  security: 'The trail itself',
};

/** Where a subject can be opened, when there is somewhere to open it. */
export function subjectHref(subjectType: string, subjectId: string | null): string | null {
  if (!subjectId) return null;

  switch (subjectType) {
    case 'user':
      return `/admin/users/${subjectId}`;
    case 'review':
      return `/admin/reviews/${subjectId}`;
    case 'case':
      return `/admin/cases/${subjectId}`;
    default:
      return null;
  }
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action as AdminAuditAction] ?? action.replace(/_/g, ' ');
}
