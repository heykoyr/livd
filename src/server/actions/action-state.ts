import type {
  PropertyVerificationFailureReason,
  VerificationCheck,
  VerificationLevel,
} from '@/types/domain';

/**
 * Server Action state shapes and their initial values.
 *
 * Deliberately *not* a `'use server'` module. Such a file may only export async
 * functions — Next turns every export into a callable server endpoint, so an
 * exported object is rejected at module evaluation, which surfaces as a generic
 * 500 on the first submission rather than as a compile error.
 *
 * Keeping the constants here also means a client component can import an
 * initial state without pulling an action's server-only dependency graph
 * (repository, cache, safety pipeline) toward the client boundary.
 */

import type { SafetyCode } from '@/lib/safety/content-linter';

/* -------------------------------------------------------------------------
 * Authentication
 * ---------------------------------------------------------------------- */

export interface AuthActionState {
  error: string | null;
  sentTo: string | null;
}

export const initialAuthState: AuthActionState = { error: null, sentTo: null };

/* -------------------------------------------------------------------------
 * Review submission
 * ---------------------------------------------------------------------- */

export interface ReviewSubmitState {
  status: 'idle' | 'error' | 'published' | 'pending';
  /** Field-level messages, keyed by the schema path. */
  fieldErrors: Record<string, string>;
  /** Form-level message. */
  error: string | null;
  /** Specific, fixable content problems, phrased as what to change. */
  safetyMessages: string[];
  /** Set on success, for the confirmation screen. */
  propertySlug: string | null;
  /**
   * What the review ended up carrying, rather than what was asked for.
   *
   * The two can differ legitimately: a verification that expired while
   * somebody was writing publishes the review without a badge. Saying so on
   * the confirmation screen is the difference between a system that quietly
   * did something else and one that tells you what it did.
   */
  verificationLevel: VerificationLevel | null;
}

export const initialReviewSubmitState: ReviewSubmitState = {
  status: 'idle',
  fieldErrors: {},
  error: null,
  safetyMessages: [],
  propertySlug: null,
  verificationLevel: null,
};

/** Codes the linter can raise, so the action can map each to a specific fix. */
export type ReviewSafetyCode = SafetyCode;

/* -------------------------------------------------------------------------
 * Adding a property
 * ---------------------------------------------------------------------- */

export interface NewPropertyState {
  error: string | null;
  fieldErrors: Record<string, string>;
}

export const initialNewPropertyState: NewPropertyState = { error: null, fieldErrors: {} };

/* -------------------------------------------------------------------------
 * Reporting
 * ---------------------------------------------------------------------- */

export interface ReportActionState {
  status: 'idle' | 'success' | 'error';
  error: string | null;
}

export const initialReportState: ReportActionState = { status: 'idle', error: null };

/* -------------------------------------------------------------------------
 * Saving
 * ---------------------------------------------------------------------- */

export interface SaveActionState {
  saved: boolean;
  error: string | null;
}

/* -------------------------------------------------------------------------
 * Moderation
 * ---------------------------------------------------------------------- */

export interface ModerationActionState {
  error: string | null;
  message: string | null;
}

export const initialModerationState: ModerationActionState = { error: null, message: null };

/* -------------------------------------------------------------------------
 * Claims and owner responses
 * ---------------------------------------------------------------------- */

export interface ClaimActionState {
  status: 'idle' | 'submitted' | 'error';
  error: string | null;
  fieldErrors: Record<string, string>;
}

export const initialClaimState: ClaimActionState = {
  status: 'idle',
  error: null,
  fieldErrors: {},
};

export interface OwnerResponseState {
  status: 'idle' | 'published' | 'error';
  error: string | null;
}

export const initialOwnerResponseState: OwnerResponseState = { status: 'idle', error: null };

/* -------------------------------------------------------------------------
 * Property verification
 * ---------------------------------------------------------------------- */

/**
 * The result of one location check.
 *
 * Note the shape: an id and a reason code. No coordinate, no distance, no
 * "you were 214 metres away" — a refusal that reports the miss is a
 * range-finder, and enough of them locate a building precisely. The reason is
 * what the person needs to act; the arithmetic is not theirs and not anyone's.
 */
export interface PropertyVerificationState {
  status: 'idle' | 'verified' | 'failed' | 'error';
  /** Something went wrong on our side, phrased as such. */
  error: string | null;
  /** Set only on success. Carried into the review draft, never a level. */
  verificationId: string | null;
  /** Set only on an honest failure the person can do something about. */
  failureReason: PropertyVerificationFailureReason | null;
}

export const initialPropertyVerificationState: PropertyVerificationState = {
  status: 'idle',
  error: null,
  verificationId: null,
  failureReason: null,
};

/**
 * A property near the visitor, reduced to what a card needs.
 *
 * Deliberately not a `PropertySummary`: that carries the property's own
 * coordinates, and shipping them to the client to render "400m away" would be
 * a longer answer than the question asked for.
 */
export interface NearbyPropertySummary {
  slug: string;
  name: string;
  context: string;
  countryCode: string;
  reviewCount: number;
  verifiedCount: number;
  recentReviewCount: number;
  activityWindowDays: number;
  overallScore: number | null;
  lastReviewAt: string | null;
  /** Rounded to the nearest ten metres in the data layer. */
  distanceMeters: number;
  isDemo: boolean;
}

export interface NearbyState {
  status: 'idle' | 'ready' | 'error';
  items: NearbyPropertySummary[];
  error: string | null;
}

export const initialNearbyState: NearbyState = { status: 'idle', items: [], error: null };

/**
 * A verification submission.
 *
 * `checks` carries the blocking reasons back to the person when a submission is
 * refused. A refusal nobody can act on is indistinguishable from a bug.
 */
export interface VerificationSubmitState {
  error: string | null;
  message: string | null;
  checks: VerificationCheck[];
}

export const initialVerificationSubmitState: VerificationSubmitState = {
  error: null,
  message: null,
  checks: [],
};
