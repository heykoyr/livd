/**
 * Assembles the complete intelligence read for a property.
 *
 * This is the only entry point the application uses. Everything downstream —
 * the property page, search ranking, comparison, cards — consumes
 * `PropertyIntelligence` and never recomputes anything itself, so there is
 * exactly one definition of what a property's numbers mean.
 */

import type {
  Money,
  PropertyIntelligence,
  RentPeriod,
  Review,
} from '@/types/domain';
import { computeDepartures, computeTagFrequencies } from './departures';
import {
  computeCategoryScores,
  computeOverallScore,
  computeRecommendRate,
  computeTrend,
} from './scoring';
import { computeTimeline } from './timeline';

export * from './scoring';
export * from './departures';
export * from './timeline';
export * from './verdict';

/** Rent reports needed before a median is published. */
const RENT_MIN_REPORTS = 3;

/**
 * @param reviews Published reviews only. Filtering by status is the caller's
 *   responsibility — the repository does it — so that this stays a pure
 *   function of the reviews it is given and remains trivially testable.
 */
export function buildPropertyIntelligence(
  propertyId: string,
  reviews: Review[],
  now: Date = new Date(),
): PropertyIntelligence {
  const overall = computeOverallScore(reviews, now);

  const lastReviewAt = reviews.reduce<string | null>((latest, review) => {
    if (!latest || review.createdAt > latest) return review.createdAt;
    return latest;
  }, null);

  return {
    propertyId,
    reviewCount: reviews.length,
    verifiedReviewCount: reviews.filter((r) => r.verificationLevel === 'verified_resident')
      .length,
    overallScore: overall.score,
    confidence: overall.confidence,
    effectiveSampleSize: overall.effectiveSampleSize,
    recommendRate: computeRecommendRate(reviews),
    categoryScores: computeCategoryScores(reviews, now),
    departures: computeDepartures(reviews),
    topPositiveTags: computeTagFrequencies(reviews, 'positive'),
    topProblemTags: computeTagFrequencies(reviews, 'problem'),
    trend: computeTrend(reviews, now),
    timeline: computeTimeline(reviews),
    currentResidentCount: reviews.filter((r) => r.residencyStatus === 'current').length,
    formerResidentCount: reviews.filter((r) => r.residencyStatus === 'former').length,
    lastReviewAt,
    reportedRent: computeReportedRent(reviews),
  };
}

/** An empty read, for a property nobody has reviewed yet. */
export function emptyIntelligence(propertyId: string): PropertyIntelligence {
  return {
    propertyId,
    reviewCount: 0,
    verifiedReviewCount: 0,
    overallScore: null,
    confidence: 'insufficient',
    effectiveSampleSize: 0,
    recommendRate: null,
    categoryScores: [],
    departures: { respondents: 0, reasons: [], suppressed: true },
    topPositiveTags: [],
    topProblemTags: [],
    trend: { direction: 'unknown', delta: null, earlierWindow: null, laterWindow: null },
    timeline: [],
    currentResidentCount: 0,
    formerResidentCount: 0,
    lastReviewAt: null,
    reportedRent: null,
  };
}

/**
 * Median reported rent.
 *
 * Median rather than mean, because a single luxury unit in a building of
 * ordinary ones would drag an average somewhere misleading. Only the most
 * commonly reported currency and period are used — mixing currencies would
 * produce a number that means nothing.
 */
function computeReportedRent(
  reviews: Review[],
): { median: Money; period: RentPeriod; sampleSize: number } | null {
  const reports = reviews.filter(
    (r): r is Review & { rent: Money; rentPeriod: RentPeriod } =>
      r.rent !== null && r.rentPeriod !== null,
  );

  if (reports.length < RENT_MIN_REPORTS) return null;

  // Group by currency + period; use the largest coherent group.
  const groups = new Map<string, Array<Review & { rent: Money; rentPeriod: RentPeriod }>>();
  for (const report of reports) {
    const key = `${report.rent.currencyCode}:${report.rentPeriod}`;
    const group = groups.get(key) ?? [];
    group.push(report);
    groups.set(key, group);
  }

  let largest: Array<Review & { rent: Money; rentPeriod: RentPeriod }> = [];
  for (const group of groups.values()) {
    if (group.length > largest.length) largest = group;
  }

  if (largest.length < RENT_MIN_REPORTS) return null;

  const amounts = largest.map((r) => r.rent.amountMinor).sort((a, b) => a - b);
  const mid = Math.floor(amounts.length / 2);
  const medianAmount =
    amounts.length % 2 === 1 ? amounts[mid]! : (amounts[mid - 1]! + amounts[mid]!) / 2;

  const first = largest[0]!;

  return {
    median: {
      amountMinor: Math.round(medianAmount),
      currencyCode: first.rent.currencyCode,
    },
    period: first.rentPeriod,
    sampleSize: largest.length,
  };
}
