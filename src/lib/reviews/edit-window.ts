import { LIMITS } from '@/config/site';
import type { ReviewStatus } from '@/types/domain';

/**
 * The correction window, in one place.
 *
 * Livd tells a reviewer they may correct what they wrote for
 * `LIMITS.reviewEditWindowHours` — twenty-four — measured from the moment the
 * review was created. That single rule is spelt out in four independent
 * places, and they are not allowed to disagree:
 *
 *   `reviews_update_own`      `created_at > now() - interval '24 hours'`
 *   `livd_correct_review`     the same comparison, against the transaction clock
 *   the local adapter         the same comparison, against `Date.now()`
 *   this module               what the pages render, and nothing else
 *
 * Note the direction of trust. Nothing here is a control. A page uses this to
 * decide whether to *offer* an edit; the database decides whether to *accept*
 * one, from a row and a clock the browser cannot reach. A client whose system
 * time is wrong, a page left open overnight and a crafted request all arrive at
 * the same comparison in Postgres and are refused there.
 *
 * WHY THE UI SAYS "21 HOURS" WHEN THE RULE IS 24
 *
 * Because it is counting down, not quoting the rule. A review written three
 * hours ago has twenty-one left. That was read as a second, inconsistent
 * duration when it was printed as a bare number, so `describeRemaining` now
 * says what the number is.
 */

export const EDIT_WINDOW_HOURS = LIMITS.reviewEditWindowHours;
const EDIT_WINDOW_MS = EDIT_WINDOW_HOURS * 3_600_000;

/** Statuses a correction may start from. Only one, and deliberately. */
export function isCorrectableStatus(status: ReviewStatus): status is 'published' {
  return status === 'published';
}

/** The instant a review stops being correctable, as an ISO string. */
export function editWindowClosesAt(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + EDIT_WINDOW_MS).toISOString();
}

export type EditWindow =
  | { editable: true; closesAt: string; msRemaining: number }
  | { editable: false; reason: 'not_published' | 'expired' };

/**
 * Whether this review may be corrected, and for how much longer.
 *
 * `now` is a parameter rather than a `Date.now()` call so a server component
 * renders one consistent answer for the whole request, and so the tests do not
 * have to wait twenty-four hours.
 */
export function editWindowFor(
  review: { status: ReviewStatus; createdAt: string },
  now: number = Date.now(),
): EditWindow {
  if (!isCorrectableStatus(review.status)) {
    return { editable: false, reason: 'not_published' };
  }

  const closesAt = editWindowClosesAt(review.createdAt);
  const msRemaining = new Date(closesAt).getTime() - now;

  if (!Number.isFinite(msRemaining) || msRemaining <= 0) {
    return { editable: false, reason: 'expired' };
  }

  return { editable: true, closesAt, msRemaining };
}

/**
 * How long is left, in words.
 *
 * Hours until the last one, then minutes, then "a few minutes" — rounding down
 * throughout, because a deadline stated generously is a deadline somebody
 * misses. Never a live countdown: a clock ticking on somebody's own writing is
 * pressure, and the rule is calm enough to state once.
 */
export function describeRemaining(msRemaining: number): string {
  const minutes = Math.floor(msRemaining / 60_000);

  if (minutes >= 120) return `${Math.floor(minutes / 60)} hours`;
  if (minutes >= 60) return '1 hour';
  if (minutes >= 2) return `${minutes} minutes`;
  return 'a few minutes';
}
