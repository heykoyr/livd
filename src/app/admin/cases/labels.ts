import type { BadgeTone } from '@/components/ui/primitives';
import type { CasePriority, CaseStatus } from '@/types/domain';

/**
 * Case vocabulary.
 *
 * Shared by the list, the detail view and the dashboard so all three describe
 * the same state with the same word. Colour is never the only signal — every
 * badge carries its own text — and nothing is red because it is bad, only
 * because it needs attention.
 */

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  new: 'New',
  open: 'Open',
  investigating: 'Investigating',
  awaiting_information: 'Awaiting information',
  action_taken: 'Action taken',
  escalated: 'Escalated',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
  closed: 'Closed',
};

export const CASE_STATUS_TONES: Record<CaseStatus, BadgeTone> = {
  new: 'accent',
  open: 'info',
  investigating: 'info',
  awaiting_information: 'caution',
  action_taken: 'brand',
  escalated: 'critical',
  resolved: 'positive',
  dismissed: 'neutral',
  closed: 'neutral',
};

export const CASE_PRIORITY_LABELS: Record<CasePriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const CASE_PRIORITY_TONES: Record<CasePriority, BadgeTone> = {
  low: 'neutral',
  medium: 'info',
  high: 'caution',
  critical: 'critical',
};

/** The three statuses that conclude a case, and therefore require an outcome. */
export const CONCLUDING_STATUSES: CaseStatus[] = ['resolved', 'dismissed', 'closed'];

/**
 * How a timeline entry reads.
 *
 * Calm and factual. "Review hidden pending investigation" rather than "CONTENT
 * SUPPRESSED" — a case file is read by people deciding what to do about a
 * person, and the language it uses shapes that decision more than anybody
 * likes to admit.
 */
export const CASE_EVENT_LABELS: Record<string, string> = {
  created: 'Case opened',
  report_linked: 'Report attached',
  assigned: 'Assigned',
  unassigned: 'Unassigned',
  status_changed: 'Status changed',
  priority_changed: 'Priority changed',
  note_added: 'Note added',
  preservation_applied: 'Preservation hold applied',
  preservation_lifted: 'Preservation hold lifted',
};
