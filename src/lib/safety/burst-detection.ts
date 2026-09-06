import type { PropertyFlagKind } from '@/types/domain';

/**
 * Burst detection.
 *
 * Looks for review activity a property's own history does not explain, and
 * says so. It never acts: a building written about by twenty delighted
 * residents looks identical, from the outside, to one being astroturfed, and
 * telling those apart is a judgement that belongs to a person. Every finding
 * carries the arithmetic that produced it so a moderator can disagree with it
 * rather than be handed a verdict.
 *
 * These are the rules. `livd_detect_property_flags` in migration 0011 is the
 * same three tests written in SQL, because production runs them on a schedule
 * inside Postgres and the local adapter has no scheduler to run them on.
 * `tests/safety/burst-detection.test.ts` pins the behaviour both must have.
 */

export const BURST_DETECTION = {
  /** How far back "recent" reaches. */
  windowHours: 48,
  /** The stretch before that window which establishes the property's own rate. */
  baselineDays: 28,
  /**
   * Below this, any pattern is noise — nothing worth a moderator's attention
   * could not also be four people and a coincidence.
   */
  minimumReviews: 5,
  /**
   * How many times its usual rate a property must be reviewed at. A judgement,
   * not a discovery: low enough to catch a campaign, high enough that a
   * building whose residents are simply talking to each other is not dragged
   * into the queue every week.
   */
  rateMultiple: 3,
  /** Ratings this far from the established mean are worth explaining. */
  ratingShift: 1.5,
  /** The share of a burst written by accounts younger than a week. */
  freshAuthorShare: 0.6,
  /** How new an account is when it writes, for the rule above. */
  freshAuthorDays: 7,
} as const;

export interface ReviewSignal {
  propertyId: string;
  /** ISO timestamp the review was written. */
  createdAt: string;
  overallRating: number;
  /** ISO timestamp the author's account was created. */
  authorCreatedAt: string;
}

export interface BurstFinding {
  propertyId: string;
  kind: PropertyFlagKind;
  severity: 1 | 2 | 3;
  windowStart: string;
  windowEnd: string;
  observed: Record<string, number | string | null>;
  detail: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Runs the three tests over a set of published reviews.
 *
 * `reviews` must already be filtered to published ones — a held or removed
 * review is not evidence of anything, and including them would let a rejected
 * campaign keep raising flags.
 */
export function detectPropertyFlags(
  reviews: ReviewSignal[],
  now: Date = new Date(),
): BurstFinding[] {
  const nowMs = now.getTime();
  const windowStart = nowMs - BURST_DETECTION.windowHours * HOUR;
  const baselineStart = windowStart - BURST_DETECTION.baselineDays * DAY;

  const recent = new Map<string, ReviewSignal[]>();
  const baseline = new Map<string, ReviewSignal[]>();

  for (const review of reviews) {
    const at = new Date(review.createdAt).getTime();
    if (Number.isNaN(at)) continue;

    if (at >= windowStart) {
      const bucket = recent.get(review.propertyId) ?? [];
      bucket.push(review);
      recent.set(review.propertyId, bucket);
    } else if (at >= baselineStart) {
      const bucket = baseline.get(review.propertyId) ?? [];
      bucket.push(review);
      baseline.set(review.propertyId, bucket);
    }
  }

  const findings: BurstFinding[] = [];
  const window = {
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: now.toISOString(),
  };

  // The share of the baseline period one window represents. Comparing a
  // 48-hour count against a 28-day count directly would be meaningless.
  const windowShare = BURST_DETECTION.windowHours / (BURST_DETECTION.baselineDays * 24);

  for (const [propertyId, recentReviews] of recent) {
    if (recentReviews.length < BURST_DETECTION.minimumReviews) continue;

    const baselineReviews = baseline.get(propertyId) ?? [];
    const recentCount = recentReviews.length;
    const baselineCount = baselineReviews.length;

    /* --- Reviewed far faster than this property normally is -------------- */

    const expected = baselineCount * windowShare;

    if (recentCount >= BURST_DETECTION.rateMultiple * expected) {
      const ratio = expected > 0 ? recentCount / expected : null;

      findings.push({
        propertyId,
        kind: 'review_burst',
        ...window,
        // Nothing to be a multiple of means volume alone, which is worth a
        // glance and nothing more.
        severity: ratio === null ? 1 : ratio >= 10 ? 3 : ratio >= 5 ? 2 : 1,
        observed: {
          reviews_in_window: recentCount,
          window_hours: BURST_DETECTION.windowHours,
          reviews_in_baseline: baselineCount,
          baseline_days: BURST_DETECTION.baselineDays,
          expected_in_window: round(expected, 2),
          times_usual_rate: ratio === null ? null : round(ratio, 1),
        },
        detail:
          ratio === null
            ? `${recentCount} reviews in ${BURST_DETECTION.windowHours} hours, on a property with no earlier reviews to compare against.`
            : `${recentCount} reviews in ${BURST_DETECTION.windowHours} hours — about ${round(ratio, 1)}x the rate implied by ${baselineCount} in the preceding ${BURST_DETECTION.baselineDays} days.`,
      });
    }

    /* --- Recent ratings that disagree sharply with the record ------------ */

    if (baselineCount >= BURST_DETECTION.minimumReviews) {
      const recentMean = round(mean(recentReviews.map((r) => r.overallRating)), 2);
      const baselineMean = round(mean(baselineReviews.map((r) => r.overallRating)), 2);
      const shift = Math.abs(recentMean - baselineMean);

      if (shift >= BURST_DETECTION.ratingShift) {
        findings.push({
          propertyId,
          kind: 'rating_anomaly',
          ...window,
          severity: shift >= 2.5 ? 3 : 2,
          observed: {
            recent_mean: recentMean,
            baseline_mean: baselineMean,
            recent_n: recentCount,
            baseline_n: baselineCount,
          },
          detail: `Recent reviews average ${recentMean} out of 5, against ${baselineMean} across the previous ${baselineCount}.`,
        });
      }
    }

    /* --- Written mostly by accounts that had just been created ----------- */

    const fresh = recentReviews.filter((review) => {
      const written = new Date(review.createdAt).getTime();
      const registered = new Date(review.authorCreatedAt).getTime();
      if (Number.isNaN(registered)) return false;
      return registered > written - BURST_DETECTION.freshAuthorDays * DAY;
    }).length;

    const freshShare = fresh / recentCount;

    if (freshShare >= BURST_DETECTION.freshAuthorShare) {
      findings.push({
        propertyId,
        kind: 'new_account_concentration',
        ...window,
        severity: freshShare >= 0.85 ? 3 : 2,
        observed: {
          reviews_in_window: recentCount,
          from_accounts_under_a_week: fresh,
        },
        detail: `${fresh} of ${recentCount} recent reviews came from accounts created in the week before writing.`,
      });
    }
  }

  // Most urgent first, then the largest window, so a queue reads top-down.
  return findings.sort(
    (a, b) => b.severity - a.severity || a.propertyId.localeCompare(b.propertyId),
  );
}
