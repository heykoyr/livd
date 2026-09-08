import { describe, expect, it } from 'vitest';

import { RECENCY } from '@/config/verification';
import {
  computeResidentFreshness,
  freshnessVerdict,
  residentRecency,
} from '@/lib/intelligence/recency';
import { makeReview, NOW } from '../fixtures';

/**
 * Resident recency.
 *
 * The rule that answers "is this still what living there is like". The case
 * that matters most is the last one in the first block: somebody who told Livd
 * they were a current resident three years ago is not a current resident today,
 * whatever they ticked at the time, and no amount of verification changes that.
 */

/** An ISO month string `n` months before the fixed NOW. */
function monthsAgo(n: number): string {
  const date = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - n, 1));
  return date.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

describe('residentRecency', () => {
  it('calls a fresh current resident current', () => {
    const review = makeReview({
      residencyStatus: 'current',
      movedOutMonth: null,
      createdAt: daysAgo(10),
    });
    expect(residentRecency(review, NOW)).toBe('current');
  });

  it('ages a current resident out of "current" once their claim is stale', () => {
    // The whole point of deriving recency rather than storing it. Nobody
    // verifies once and stays a current resident for ever.
    const review = makeReview({
      residencyStatus: 'current',
      movedOutMonth: null,
      createdAt: new Date(
        Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - (RECENCY.currentMaxMonths + 2), 1),
      ).toISOString(),
    });
    expect(residentRecency(review, NOW)).toBe('recent');
  });

  it('ages a very old "current resident" claim all the way out', () => {
    const review = makeReview({
      residencyStatus: 'current',
      movedOutMonth: null,
      createdAt: new Date(Date.UTC(NOW.getUTCFullYear() - 3, NOW.getUTCMonth(), 1)).toISOString(),
    });
    expect(residentRecency(review, NOW)).toBe('older');
  });

  it('dates a former resident by when they left, not when they wrote', () => {
    const review = makeReview({
      residencyStatus: 'former',
      movedOutMonth: monthsAgo(30),
      // Written yesterday about a tenancy that ended two and a half years ago.
      createdAt: daysAgo(1),
    });
    expect(residentRecency(review, NOW)).toBe('older');
  });

  it('places a recent departure in "recent"', () => {
    const review = makeReview({
      residencyStatus: 'former',
      movedOutMonth: monthsAgo(4),
      createdAt: daysAgo(100),
    });
    expect(residentRecency(review, NOW)).toBe('recent');
  });

  it('places a departure inside two years in "former"', () => {
    const review = makeReview({
      residencyStatus: 'former',
      movedOutMonth: monthsAgo(18),
      createdAt: daysAgo(500),
    });
    expect(residentRecency(review, NOW)).toBe('former');
  });

  it('respects the configured boundaries exactly', () => {
    const at = (months: number) =>
      residentRecency(
        makeReview({ residencyStatus: 'former', movedOutMonth: monthsAgo(months) }),
        NOW,
      );

    expect(at(RECENCY.recentMaxMonths)).toBe('recent');
    expect(at(RECENCY.recentMaxMonths + 1)).toBe('former');
    expect(at(RECENCY.formerMaxMonths)).toBe('former');
    expect(at(RECENCY.formerMaxMonths + 1)).toBe('older');
  });
});

describe('computeResidentFreshness', () => {
  it('counts each review into exactly one bucket', () => {
    const reviews = [
      makeReview({ residencyStatus: 'current', movedOutMonth: null, createdAt: daysAgo(5) }),
      makeReview({ residencyStatus: 'former', movedOutMonth: monthsAgo(4) }),
      makeReview({ residencyStatus: 'former', movedOutMonth: monthsAgo(18) }),
      makeReview({ residencyStatus: 'former', movedOutMonth: monthsAgo(40) }),
    ];

    const freshness = computeResidentFreshness(reviews, NOW);

    expect(freshness.current + freshness.recent + freshness.former + freshness.older).toBe(4);
    expect(freshness.current).toBe(1);
    expect(freshness.recent).toBe(1);
    expect(freshness.former).toBe(1);
    expect(freshness.older).toBe(1);
  });

  it('counts each verification level separately and in the total', () => {
    const reviews = [
      makeReview({ verificationLevel: 'location_verified' }),
      makeReview({ verificationLevel: 'location_verified' }),
      makeReview({ verificationLevel: 'verified_resident' }),
      makeReview({ verificationLevel: 'unverified' }),
      makeReview({ verificationLevel: 'disputed' }),
    ];

    const freshness = computeResidentFreshness(reviews, NOW);

    expect(freshness.locationVerifiedCount).toBe(2);
    expect(freshness.residentVerifiedCount).toBe(1);
    expect(freshness.verifiedCount).toBe(3);
  });

  it('counts activity by when a review was written, not when the tenancy ended', () => {
    // Somebody writing today about 2019 is activity on Livd, and it is not a
    // recent resident experience. The two counts answer different questions and
    // must not be conflated.
    const reviews = [
      makeReview({ residencyStatus: 'former', movedOutMonth: monthsAgo(60), createdAt: daysAgo(3) }),
    ];

    const freshness = computeResidentFreshness(reviews, NOW);

    expect(freshness.reviewsInActivityWindow).toBe(1);
    expect(freshness.older).toBe(1);
  });

  it('excludes writing older than the activity window', () => {
    const reviews = [
      makeReview({ createdAt: daysAgo(RECENCY.activityWindowDays + 5) }),
    ];
    expect(computeResidentFreshness(reviews, NOW).reviewsInActivityWindow).toBe(0);
  });
});

describe('freshnessVerdict', () => {
  const freshnessOf = (reviews: Parameters<typeof computeResidentFreshness>[0]) =>
    freshnessVerdict(computeResidentFreshness(reviews, NOW));

  it('says nothing at all for a property with no reviews', () => {
    expect(freshnessOf([])).toBe('none');
  });

  it('calls three recent experiences fresh', () => {
    expect(
      freshnessOf([
        makeReview({ residencyStatus: 'current', movedOutMonth: null, createdAt: daysAgo(5) }),
        makeReview({ residencyStatus: 'former', movedOutMonth: monthsAgo(2) }),
        makeReview({ residencyStatus: 'former', movedOutMonth: monthsAgo(5) }),
      ]),
    ).toBe('fresh');
  });

  it('does not call a wall of five-year-old reviews fresh', () => {
    expect(
      freshnessOf([
        makeReview({ residencyStatus: 'former', movedOutMonth: monthsAgo(60) }),
        makeReview({ residencyStatus: 'former', movedOutMonth: monthsAgo(66) }),
        makeReview({ residencyStatus: 'former', movedOutMonth: monthsAgo(72) }),
      ]),
    ).toBe('limited');
  });
});
