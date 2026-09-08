/**
 * Resident recency.
 *
 * The question a prospective renter is really asking is not "was this checked"
 * but "is this still what living there is like". A five-star review from a
 * resident who moved out in 2019 and a five-star review from someone who was
 * standing in the lobby last week are not the same claim, and Livd should not
 * present them as one.
 *
 * Recency is *derived*, never stored. A stored label would be correct on the
 * day it was written and wrong every day after — which is precisely the failure
 * this system exists to prevent. It is also what stops someone verifying a
 * property once and describing themselves as a current resident forever: the
 * `current` bucket has a maximum age, and a review ages out of it whatever its
 * author ticked at the time.
 *
 * Pure functions, no imports beyond configuration and types.
 */

import { RECENCY, type ResidentRecency } from '@/config/verification';
import type { ResidentFreshness, Review } from '@/types/domain';
import { experienceDate, monthsSince } from './scoring';

export type { ResidentRecency, ResidentFreshness };

/**
 * The point in time a review's experience is anchored to.
 *
 * For a former resident that is when they left; for a current one it is when
 * they last told us something. `verifiedAt` is accepted so a future check-in —
 * a Livd Pulse response from a resident confirming the building is still as
 * described — can refresh a review's recency without rewriting the review.
 * Nothing passes it yet, and the shape is here so that when something does, no
 * consumer of this function has to change.
 */
export function recencyReferenceDate(
  review: Pick<Review, 'movedOutMonth' | 'createdAt'> & { verifiedAt?: string | null },
): Date {
  if (review.movedOutMonth) return experienceDate(review);

  if (review.verifiedAt) {
    const verified = new Date(review.verifiedAt);
    if (!Number.isNaN(verified.getTime())) return verified;
  }

  return experienceDate(review);
}

/**
 * Which recency bucket a review falls into.
 *
 * `current` requires both halves of the claim: the resident said they still
 * lived there, *and* they said it recently enough for that to still be true.
 * Everything else falls through on age alone, because a former resident's
 * experience is dated by when it ended regardless of when they wrote it down.
 */
export function residentRecency(
  review: Pick<Review, 'residencyStatus' | 'movedOutMonth' | 'createdAt'> & {
    verifiedAt?: string | null;
  },
  now: Date = new Date(),
): ResidentRecency {
  const months = monthsSince(recencyReferenceDate(review), now);

  if (review.residencyStatus === 'current' && months <= RECENCY.currentMaxMonths) {
    return 'current';
  }
  if (months <= RECENCY.recentMaxMonths) return 'recent';
  if (months <= RECENCY.formerMaxMonths) return 'former';
  return 'older';
}

/* -------------------------------------------------------------------------
 * Property-level freshness
 * ---------------------------------------------------------------------- */

export const EMPTY_FRESHNESS: ResidentFreshness = {
  current: 0,
  recent: 0,
  former: 0,
  older: 0,
  reviewsInActivityWindow: 0,
  verifiedCount: 0,
  locationVerifiedCount: 0,
  residentVerifiedCount: 0,
};

export function computeResidentFreshness(
  reviews: Review[],
  now: Date = new Date(),
): ResidentFreshness {
  const windowStart = now.getTime() - RECENCY.activityWindowDays * 86_400_000;
  const freshness: ResidentFreshness = { ...EMPTY_FRESHNESS };

  for (const review of reviews) {
    freshness[residentRecency(review, now)] += 1;

    const written = new Date(review.createdAt).getTime();
    if (Number.isFinite(written) && written >= windowStart) {
      freshness.reviewsInActivityWindow += 1;
    }

    if (review.verificationLevel === 'location_verified') {
      freshness.locationVerifiedCount += 1;
      freshness.verifiedCount += 1;
    } else if (review.verificationLevel === 'verified_resident') {
      freshness.residentVerifiedCount += 1;
      freshness.verifiedCount += 1;
    }
  }

  return freshness;
}

/**
 * The honest one-line reading of a property's freshness.
 *
 * `limited` is not a failure state and is not phrased as one. A property whose
 * evidence is all several years old is still worth reading; the reader simply
 * needs to know that is what they are reading.
 */
export type FreshnessVerdict = 'fresh' | 'moderate' | 'limited' | 'none';

export function freshnessVerdict(freshness: ResidentFreshness): FreshnessVerdict {
  const total =
    freshness.current + freshness.recent + freshness.former + freshness.older;

  if (total === 0) return 'none';
  if (freshness.current + freshness.recent >= 3) return 'fresh';
  if (freshness.current + freshness.recent + freshness.former >= 3) return 'moderate';
  return 'limited';
}
