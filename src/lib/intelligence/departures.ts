/**
 * "Why residents leave" — the signature analysis.
 *
 * Two rules govern this file, and both exist because the alternative is
 * misleading:
 *
 *   1. Nothing is published below `DEPARTURE_DISCLOSURE_THRESHOLD` former
 *      residents. One person's answer rendered as "100% left because of X" is
 *      both statistically meaningless and potentially identifying.
 *
 *   2. Reasons that describe the resident's life rather than the property are
 *      counted and shown separately. A building everyone left because they
 *      bought a house is not a bad building, and the chart must not imply it is.
 */

import {
  DEPARTURE_DISCLOSURE_THRESHOLD,
  getDepartureReason,
} from '@/config/departure-reasons';
import { getTag } from '@/config/tags';
import type {
  DepartureBreakdown,
  DepartureReasonShare,
  Review,
  TagFrequency,
} from '@/types/domain';

/**
 * Counts primary departure reasons across former residents.
 *
 * Only the primary reason is counted, so shares sum to 1 and each former
 * resident contributes exactly one vote. Secondary reasons inform the verdict
 * and the pre-visit checks, but they are not part of this distribution — mixing
 * them in would produce percentages that add to more than 100 and mean nothing.
 */
export function computeDepartures(reviews: Review[]): DepartureBreakdown {
  const formerWithReason = reviews.filter(
    (review) => review.residencyStatus === 'former' && review.primaryDepartureReason,
  );

  const respondents = formerWithReason.length;

  if (respondents < DEPARTURE_DISCLOSURE_THRESHOLD) {
    return { respondents, reasons: [], suppressed: true };
  }

  const counts = new Map<string, number>();
  for (const review of formerWithReason) {
    const key = review.primaryDepartureReason;
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const reasons: DepartureReasonShare[] = [...counts.entries()]
    .map(([reasonKey, count]) => ({
      reasonKey,
      count,
      share: count / respondents,
    }))
    .sort((a, b) => b.count - a.count || a.reasonKey.localeCompare(b.reasonKey));

  return { respondents, reasons, suppressed: false };
}

/** Splits the breakdown for display. Property-related reasons lead. */
export function partitionDepartures(breakdown: DepartureBreakdown): {
  propertyRelated: DepartureReasonShare[];
  personal: DepartureReasonShare[];
} {
  const propertyRelated: DepartureReasonShare[] = [];
  const personal: DepartureReasonShare[] = [];

  for (const reason of breakdown.reasons) {
    const definition = getDepartureReason(reason.reasonKey);
    if (definition?.isPropertyRelated) propertyRelated.push(reason);
    else personal.push(reason);
  }

  return { propertyRelated, personal };
}

/**
 * The share of departures attributable to the property itself.
 *
 * This is the number that actually matters to a prospective renter: not "did
 * people leave" — everyone leaves eventually — but "did the property drive them
 * out".
 */
export function propertyDrivenDepartureShare(breakdown: DepartureBreakdown): number | null {
  if (breakdown.suppressed || breakdown.respondents === 0) return null;

  const propertyRelated = breakdown.reasons
    .filter((r) => getDepartureReason(r.reasonKey)?.isPropertyRelated)
    .reduce((sum, r) => sum + r.count, 0);

  return propertyRelated / breakdown.respondents;
}

/* -------------------------------------------------------------------------
 * Tag frequencies
 * ---------------------------------------------------------------------- */

/** How many residents mentioned a threshold before a tag is worth showing. */
const TAG_MIN_MENTIONS = 2;

/**
 * Counts structured "what was good" / "what was difficult" chips.
 *
 * Share is over the number of reviews, not the number of tags, so "7 of 20
 * residents mentioned slow repairs" is what the reader gets — a claim they can
 * check — rather than a share of a total nobody can interpret.
 */
export function computeTagFrequencies(
  reviews: Review[],
  polarity: 'positive' | 'problem',
  limit = 6,
): TagFrequency[] {
  if (reviews.length === 0) return [];

  const counts = new Map<string, number>();

  for (const review of reviews) {
    const tags = polarity === 'positive' ? review.positiveTags : review.problemTags;
    // A review mentioning the same tag twice still counts once.
    for (const tagKey of new Set(tags)) {
      if (!getTag(tagKey)) continue;
      counts.set(tagKey, (counts.get(tagKey) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= TAG_MIN_MENTIONS)
    .map(([tagKey, count]) => ({
      tagKey,
      count,
      share: count / reviews.length,
    }))
    .sort((a, b) => b.count - a.count || a.tagKey.localeCompare(b.tagKey))
    .slice(0, limit);
}
