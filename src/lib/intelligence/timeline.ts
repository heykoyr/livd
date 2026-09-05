/**
 * Property timeline.
 *
 * Every entry is derived from something residents actually reported. Nothing is
 * inferred, nothing is invented, and an entry is only produced where the sample
 * behind it is large enough to mean anything.
 *
 * Four entry kinds are generated:
 *
 *   volume            — the year the property's record begins
 *   score_shift       — a year-on-year move large enough to be worth naming
 *   management_change — residents reporting that the landlord or agent changed
 *   rent_change       — a material move in reported rent between adjacent years
 */

import type { Review, TimelineEntry } from '@/types/domain';
import { experienceDate, scoreReview } from './scoring';
import { formatMoney } from '@/lib/format';

/** Reviews needed in a year before that year appears on the timeline. */
const YEAR_MIN_REVIEWS = 2;
/** Score points of year-on-year movement before it is named. */
const SHIFT_THRESHOLD = 8;
/** Residents who must report a management change before it is shown. */
const MANAGEMENT_MIN_REPORTS = 2;
/** Relative change in median reported rent before it is named. */
const RENT_CHANGE_THRESHOLD = 0.08;
/** Rent reports needed in a year before its median is used. */
const RENT_MIN_REPORTS = 2;

interface YearBucket {
  year: number;
  reviews: Review[];
  meanScore: number;
  managementChangeReports: number;
  rentReports: Array<{ amountMinor: number; currencyCode: string }>;
}

function bucketByYear(reviews: Review[]): YearBucket[] {
  const buckets = new Map<number, Review[]>();

  for (const review of reviews) {
    const year = experienceDate(review).getUTCFullYear();
    const bucket = buckets.get(year) ?? [];
    bucket.push(review);
    buckets.set(year, bucket);
  }

  return [...buckets.entries()]
    .map(([year, yearReviews]) => ({
      year,
      reviews: yearReviews,
      meanScore:
        yearReviews.reduce((sum, r) => sum + scoreReview(r), 0) / yearReviews.length,
      managementChangeReports: yearReviews.filter((r) => r.noticedManagementChange === true)
        .length,
      rentReports: yearReviews
        .filter((r) => r.rent !== null && r.rentPeriod === 'month')
        .map((r) => ({
          amountMinor: r.rent!.amountMinor,
          currencyCode: r.rent!.currencyCode,
        })),
    }))
    .sort((a, b) => a.year - b.year);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function computeTimeline(reviews: Review[]): TimelineEntry[] {
  const buckets = bucketByYear(reviews).filter((b) => b.reviews.length >= YEAR_MIN_REVIEWS);
  if (buckets.length === 0) return [];

  const entries: TimelineEntry[] = [];

  const first = buckets[0]!;
  entries.push({
    year: first.year,
    kind: 'volume',
    summary: `The resident record for this property begins — ${first.reviews.length} ${
      first.reviews.length === 1 ? 'review' : 'reviews'
    } covering this year.`,
    sampleSize: first.reviews.length,
  });

  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i]!;
    const previous = i > 0 ? buckets[i - 1] : undefined;

    // Management changes are reported directly by residents, never inferred.
    if (bucket.managementChangeReports >= MANAGEMENT_MIN_REPORTS) {
      entries.push({
        year: bucket.year,
        kind: 'management_change',
        summary: `${bucket.managementChangeReports} residents reported that the landlord or managing agent changed around this time.`,
        sampleSize: bucket.managementChangeReports,
      });
    }

    if (previous) {
      const delta = Math.round(bucket.meanScore - previous.meanScore);
      if (Math.abs(delta) >= SHIFT_THRESHOLD) {
        entries.push({
          year: bucket.year,
          kind: 'score_shift',
          summary:
            delta > 0
              ? `Resident ratings rose ${delta} points compared with ${previous.year}.`
              : `Resident ratings fell ${Math.abs(delta)} points compared with ${previous.year}.`,
          sampleSize: bucket.reviews.length,
        });
      }

      // Rent is only compared within a single currency.
      const currency = bucket.rentReports[0]?.currencyCode;
      const currentReports = bucket.rentReports.filter((r) => r.currencyCode === currency);
      const previousReports = previous.rentReports.filter((r) => r.currencyCode === currency);

      if (
        currency &&
        currentReports.length >= RENT_MIN_REPORTS &&
        previousReports.length >= RENT_MIN_REPORTS
      ) {
        const currentMedian = median(currentReports.map((r) => r.amountMinor));
        const previousMedian = median(previousReports.map((r) => r.amountMinor));

        if (previousMedian > 0) {
          const change = (currentMedian - previousMedian) / previousMedian;
          if (Math.abs(change) >= RENT_CHANGE_THRESHOLD) {
            const formatted = formatMoney(
              { amountMinor: currentMedian, currencyCode: currency },
              { compact: true },
            );
            entries.push({
              year: bucket.year,
              kind: 'rent_change',
              summary: `Reported rent ${change > 0 ? 'rose' : 'fell'} about ${Math.round(
                Math.abs(change) * 100,
              )}% on the previous year, to a median of ${formatted} a month.`,
              sampleSize: currentReports.length,
            });
          }
        }
      }
    }
  }

  // Most recent first — a reader wants the current state before the history.
  return entries.sort((a, b) => b.year - a.year);
}
