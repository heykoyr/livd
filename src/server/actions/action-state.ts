import type { VerificationCheck } from '@/types/domain';

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
}

export const initialReviewSubmitState: ReviewSubmitState = {
  status: 'idle',
  fieldErrors: {},
  error: null,
  safetyMessages: [],
  propertySlug: null,
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
