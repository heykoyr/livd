import type { BadgeTone } from '@/components/ui/primitives';
import type { AuthorityRequestStatus, AuthorityRequestType } from '@/types/domain';

/**
 * Authority request vocabulary.
 *
 * Deliberately flat and unexcited. A law-enforcement request is not an
 * emergency in the UI sense, and a console that treats one as an alarm is a
 * console that pushes people towards saying yes quickly.
 */

export const AUTHORITY_STATUS_LABELS: Record<AuthorityRequestStatus, string> = {
  received: 'Received',
  under_review: 'Under review',
  needs_clarification: 'Needs clarification',
  awaiting_legal_review: 'Awaiting legal review',
  approved: 'Approved',
  partially_approved: 'Partially approved',
  declined: 'Declined',
  fulfilled: 'Fulfilled',
  closed: 'Closed',
};

export const AUTHORITY_STATUS_TONES: Record<AuthorityRequestStatus, BadgeTone> = {
  received: 'accent',
  under_review: 'info',
  needs_clarification: 'caution',
  awaiting_legal_review: 'caution',
  approved: 'brand',
  partially_approved: 'brand',
  declined: 'neutral',
  fulfilled: 'positive',
  closed: 'neutral',
};

export const AUTHORITY_TYPE_LABELS: Record<AuthorityRequestType, string> = {
  account_information: 'Account information',
  content_preservation: 'Content preservation',
  content_removal: 'Content removal',
  emergency_disclosure: 'Emergency disclosure',
  other: 'Other',
};

/** The statuses that conclude a request, and therefore require a written decision. */
export const CONCLUDING_AUTHORITY_STATUSES: AuthorityRequestStatus[] = [
  'approved',
  'partially_approved',
  'declined',
  'fulfilled',
  'closed',
];

/** The statuses under which a disclosure may legitimately be recorded. */
export const DISCLOSABLE_STATUSES: AuthorityRequestStatus[] = [
  'approved',
  'partially_approved',
  'fulfilled',
];
