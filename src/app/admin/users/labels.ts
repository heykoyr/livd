import type { BadgeTone } from '@/components/ui/primitives';
import type { ReviewStatus, UserRole, UserStatus, VerificationLevel } from '@/types/domain';

/**
 * Admin vocabulary.
 *
 * Shared between the directory and the detail view so the two never describe
 * the same state with different words — which sounds like a small thing until
 * a moderator writes "restricted" in a case note about an account the other
 * screen called "limited".
 *
 * The tone choices are deliberate too. Nothing here is red because it is bad;
 * things are red because they need attention. A removed review is `critical`
 * because it is the strongest thing that can have happened to a piece of
 * content, not because its author did something wrong — and every one of these
 * carries its own text, so colour is never the only signal.
 */

export const ROLE_LABELS: Record<UserRole, string> = {
  resident: 'Resident',
  owner: 'Owner',
  moderator: 'Moderator',
  trust_admin: 'Trust & Safety',
  admin: 'Administrator',
};

export const STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Active',
  restricted: 'Restricted',
  suspended: 'Suspended',
};

export const STATUS_TONES: Record<UserStatus, BadgeTone> = {
  active: 'neutral',
  restricted: 'caution',
  suspended: 'critical',
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  published: 'Published',
  pending_moderation: 'Awaiting moderation',
  held: 'Held',
  removed: 'Removed',
};

export const REVIEW_STATUS_TONES: Record<ReviewStatus, BadgeTone> = {
  published: 'positive',
  pending_moderation: 'caution',
  held: 'caution',
  removed: 'critical',
};

export const VERIFICATION_LABELS: Record<VerificationLevel, string> = {
  unverified: 'Unverified',
  location_verified: 'Location verified',
  verified_resident: 'Verified resident',
  disputed: 'Disputed',
};

export const VERIFICATION_TONES: Record<VerificationLevel, BadgeTone> = {
  unverified: 'neutral',
  location_verified: 'info',
  verified_resident: 'positive',
  disputed: 'caution',
};
