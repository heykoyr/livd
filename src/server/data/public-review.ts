import type { OwnerResponse, PublicReview, Review } from '@/types/domain';
import { formatTenure, formatYear } from '@/lib/format';
import { residentRecency, type ResidentRecency } from '@/lib/intelligence/recency';

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
 *
 * Verification is the newest thing that has to survive this boundary intact.
 * `Review` now carries a `verificationId` and a `verifiedAt`; neither is copied
 * across. A reader is entitled to know that an experience was checked and how
 * current it is. The minute it was checked, the record behind it, and anything
 * that could be correlated against a person's movements are not theirs to know,
 * and there is no field on `PublicReview` to put them in.
 */
export function toPublicReview(
  review: Review,
  ownerResponse: OwnerResponse | null = null,
  now: Date = new Date(),
): PublicReview {
  const recency = residentRecency(review, now);

  return {
    id: review.id,
    propertyId: review.propertyId,
    residencyStatus: review.residencyStatus,
    verificationLevel: review.verificationLevel,
    recency,
    attribution: buildAttribution(review),
    trustLabel: buildTrustLabel(review, recency),
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
    case 'location_verified':
      // Not "verified resident". Being at a building is evidence of presence,
      // not of a tenancy, and the wording has to keep that distinction visible
      // in the one place a reader will actually see it.
      return `${capitalise(residency)} · location verified`;
    case 'disputed':
      return `${capitalise(residency)} · authenticity disputed`;
    default:
      return capitalise(residency);
  }
}

const RECENCY_WORD: Record<ResidentRecency, string> = {
  current: 'Current resident',
  recent: 'Recent resident',
  former: 'Former resident',
  older: 'Earlier resident',
};

/**
 * "Current resident · Location verified".
 *
 * Recency first, because it is the more useful of the two: a checked review of
 * how a building was run in 2019 tells a prospective renter less than an
 * unchecked one from last month. Verification qualifies it rather than leading.
 *
 * Every state is a word. Nothing here depends on a colour or an icon to be
 * understood, which is what makes the badge row on a review card decorative
 * rather than load-bearing.
 */
function buildTrustLabel(review: Review, recency: ResidentRecency): string {
  const word = RECENCY_WORD[recency];

  switch (review.verificationLevel) {
    case 'verified_resident':
      return `${word} · Residency verified`;
    case 'location_verified':
      return `${word} · Location verified`;
    case 'disputed':
      return `${word} · Authenticity disputed`;
    default:
      return word;
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
