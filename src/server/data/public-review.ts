import type { OwnerResponse, PublicReview, Review } from '@/types/domain';
import { formatTenure, formatYear } from '@/lib/format';

/**
 * Converts a stored review into the shape the public sees.
 *
 * This is the single place anonymity is enforced in the application layer. The
 * returned object has no author id, no email, no handle and no field that could
 * be joined back to a person — because it is constructed field by field rather
 * than by spreading the source record. A future field added to `Review` cannot
 * leak through here by accident; it has to be added deliberately.
 *
 * The database enforces the same thing independently through column grants. Two
 * layers, neither trusted alone.
 */
export function toPublicReview(
  review: Review,
  ownerResponse: OwnerResponse | null = null,
): PublicReview {
  return {
    id: review.id,
    propertyId: review.propertyId,
    residencyStatus: review.residencyStatus,
    verificationLevel: review.verificationLevel,
    attribution: buildAttribution(review),
    tenureLabel: buildTenureLabel(review),
    tenureMonths: review.tenureMonths,
    overallRating: review.overallRating,
    body: review.body,
    wouldRecommend: review.wouldRecommend,
    categoryRatings: review.categoryRatings,
    positiveTags: review.positiveTags,
    problemTags: review.problemTags,
    primaryDepartureReason: review.primaryDepartureReason,
    rent: review.rent,
    rentPeriod: review.rentPeriod,
    helpfulCount: review.helpfulCount,
    isDemo: review.isDemo,
    createdAt: review.createdAt,
    ownerResponse,
  };
}

/**
 * The only identity a reviewer ever carries in public: whether they lived
 * there, and whether that was checked.
 */
function buildAttribution(review: Review): string {
  const residency = review.residencyStatus === 'current' ? 'current resident' : 'former resident';

  switch (review.verificationLevel) {
    case 'verified_resident':
      return `Verified ${residency}`;
    case 'disputed':
      return `${capitalise(residency)} · authenticity disputed`;
    default:
      return capitalise(residency);
  }
}

/**
 * "Lived here 2 years · left 2024" / "Living here 8 months".
 *
 * Year precision on the departure, never a month, so a tenancy cannot be
 * matched against a specific letting record.
 */
function buildTenureLabel(review: Review): string {
  const tenure = formatTenure(review.tenureMonths);

  if (review.residencyStatus === 'current') {
    return `Living here ${tenure}`;
  }

  const leftYear = review.movedOutMonth ? formatYear(review.movedOutMonth) : null;
  return leftYear ? `Lived here ${tenure} · left ${leftYear}` : `Lived here ${tenure}`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
