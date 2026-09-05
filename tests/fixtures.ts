import type { Review } from '@/types/domain';

/**
 * Review fixtures.
 *
 * Built by a factory rather than written out, so a test states only the fields
 * it actually cares about and stays readable as an argument about behaviour.
 */

let counter = 0;

export function makeReview(overrides: Partial<Review> = {}): Review {
  counter += 1;
  const createdAt = overrides.createdAt ?? '2026-06-01T00:00:00.000Z';

  return {
    id: `review-${counter}`,
    propertyId: 'property-1',
    authorId: `author-${counter}`,
    residencyStatus: 'former',
    movedInMonth: '2023-01-01',
    movedOutMonth: '2025-01-01',
    tenureMonths: 24,
    overallRating: 3,
    body: null,
    wouldRecommend: true,
    rent: null,
    rentPeriod: null,
    categoryRatings: [],
    positiveTags: [],
    problemTags: [],
    primaryDepartureReason: null,
    secondaryDepartureReasons: [],
    noticedManagementChange: null,
    verificationLevel: 'unverified',
    status: 'published',
    safetyFlags: [],
    helpfulCount: 0,
    isDemo: false,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

/** `count` reviews sharing the same shape. */
export function makeReviews(count: number, overrides: Partial<Review> = {}): Review[] {
  return Array.from({ length: count }, () => makeReview(overrides));
}

/** A fixed "now", so recency decay is deterministic across runs. */
export const NOW = new Date('2026-06-01T00:00:00.000Z');
