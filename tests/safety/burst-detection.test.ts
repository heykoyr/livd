import { describe, expect, it } from 'vitest';

import {
  BURST_DETECTION,
  detectPropertyFlags,
  type ReviewSignal,
} from '@/lib/safety/burst-detection';

/**
 * Burst detection.
 *
 * The rules decide whose review activity a moderator is asked to look at, so
 * the tests that matter most are the ones about *not* firing. A detector that
 * flags every popular building teaches moderators to dismiss without reading,
 * which is worse than no detector at all.
 *
 * These are also the specification the SQL in migration 0011 is written
 * against, so anything asserted here has to hold in both places.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A review written `hoursAgo`, by an account registered `authorAgeDays` old. */
function review(
  propertyId: string,
  hoursAgo: number,
  overallRating = 4,
  authorAgeDays = 400,
): ReviewSignal {
  const written = NOW.getTime() - hoursAgo * HOUR;
  return {
    propertyId,
    createdAt: new Date(written).toISOString(),
    overallRating,
    authorCreatedAt: new Date(written - authorAgeDays * DAY).toISOString(),
  };
}

function many(
  count: number,
  propertyId: string,
  hoursAgo: number,
  rating = 4,
  authorAgeDays = 400,
): ReviewSignal[] {
  // Spread them so no two share a timestamp, which no rule depends on but
  // which is what real data looks like.
  return Array.from({ length: count }, (_, i) =>
    review(propertyId, hoursAgo + i * 0.1, rating, authorAgeDays),
  );
}

const kinds = (findings: ReturnType<typeof detectPropertyFlags>) =>
  findings.map((f) => f.kind).sort();

describe('staying quiet', () => {
  it('says nothing about a property with no reviews at all', () => {
    expect(detectPropertyFlags([], NOW)).toEqual([]);
  });

  it('says nothing below the minimum, however concentrated', () => {
    const reviews = many(BURST_DETECTION.minimumReviews - 1, 'p', 1, 5, 0);
    expect(detectPropertyFlags(reviews, NOW)).toEqual([]);
  });

  it('says nothing about a busy property reviewed at its usual rate', () => {
    // Sixty over the baseline month, ten in the window: the same rate.
    const reviews = [
      ...many(60, 'busy', 72),
      ...many(10, 'busy', 5),
    ];

    expect(detectPropertyFlags(reviews, NOW)).toEqual([]);
  });

  it('ignores reviews older than the baseline period entirely', () => {
    const ancient = many(200, 'p', BURST_DETECTION.baselineDays * 24 + 500);
    expect(detectPropertyFlags(ancient, NOW)).toEqual([]);
  });
});

describe('a rate a property does not explain', () => {
  it('flags a spike against an established rate', () => {
    // Eight in the previous month is roughly half a review per window.
    const reviews = [...many(8, 'p', 24 * 20), ...many(6, 'p', 6)];
    const findings = detectPropertyFlags(reviews, NOW);
    const burst = findings.find((f) => f.kind === 'review_burst');

    expect(burst).toBeDefined();
    expect(burst!.observed.reviews_in_window).toBe(6);
    expect(burst!.observed.reviews_in_baseline).toBe(8);
    expect(burst!.detail).toContain('the rate implied by 8');
  });

  it('compares rates rather than raw counts', () => {
    // Six in two days is fewer than eight in a month, and far faster.
    const reviews = [...many(8, 'p', 24 * 20), ...many(6, 'p', 6)];
    const burst = detectPropertyFlags(reviews, NOW).find((f) => f.kind === 'review_burst');

    expect(burst).toBeDefined();
    expect(Number(burst!.observed.times_usual_rate)).toBeGreaterThan(5);
  });

  it('keeps a property with no history at severity 1', () => {
    const burst = detectPropertyFlags(many(6, 'new', 3), NOW).find(
      (f) => f.kind === 'review_burst',
    );

    expect(burst?.severity).toBe(1);
    expect(burst?.observed.times_usual_rate).toBeNull();
    expect(burst?.detail).toContain('no earlier reviews');
  });

  it('raises severity with the size of the multiple', () => {
    const modest = detectPropertyFlags(
      [...many(30, 'p', 24 * 20), ...many(8, 'p', 6)],
      NOW,
    ).find((f) => f.kind === 'review_burst');

    const extreme = detectPropertyFlags(
      [...many(8, 'q', 24 * 20), ...many(30, 'q', 6)],
      NOW,
    ).find((f) => f.kind === 'review_burst');

    expect(modest!.severity).toBeLessThan(extreme!.severity);
    expect(extreme!.severity).toBe(3);
  });
});

describe('ratings that disagree with the record', () => {
  it('flags a sharp drop', () => {
    const reviews = [...many(10, 'p', 24 * 10, 5), ...many(6, 'p', 6, 1)];
    const anomaly = detectPropertyFlags(reviews, NOW).find((f) => f.kind === 'rating_anomaly');

    expect(anomaly).toBeDefined();
    expect(anomaly!.observed.recent_mean).toBe(1);
    expect(anomaly!.observed.baseline_mean).toBe(5);
    expect(anomaly!.severity).toBe(3);
  });

  it('flags a sharp rise just as readily', () => {
    const reviews = [...many(10, 'p', 24 * 10, 2), ...many(6, 'p', 6, 5)];
    const anomaly = detectPropertyFlags(reviews, NOW).find((f) => f.kind === 'rating_anomaly');

    expect(anomaly).toBeDefined();
    expect(anomaly!.severity).toBe(3);
  });

  it('says nothing about ordinary variation', () => {
    const reviews = [...many(10, 'p', 24 * 10, 4), ...many(6, 'p', 6, 5)];
    expect(kinds(detectPropertyFlags(reviews, NOW))).not.toContain('rating_anomaly');
  });

  it('will not compare against a baseline too thin to mean anything', () => {
    // Three prior reviews at 5, six recent at 1: a big gap, too little behind it.
    const reviews = [...many(3, 'p', 24 * 10, 5), ...many(6, 'p', 6, 1)];
    expect(kinds(detectPropertyFlags(reviews, NOW))).not.toContain('rating_anomaly');
  });
});

describe('accounts created to write', () => {
  it('flags a burst written mostly by week-old accounts', () => {
    const reviews = many(6, 'p', 3, 5, 1);
    const finding = detectPropertyFlags(reviews, NOW).find(
      (f) => f.kind === 'new_account_concentration',
    );

    expect(finding).toBeDefined();
    expect(finding!.observed.from_accounts_under_a_week).toBe(6);
    expect(finding!.severity).toBe(3);
  });

  it('says nothing when the authors are established', () => {
    const reviews = many(6, 'p', 3, 5, 400);
    expect(kinds(detectPropertyFlags(reviews, NOW))).not.toContain('new_account_concentration');
  });

  it('needs a clear majority, not a handful', () => {
    // Two of six is a third — below the threshold.
    const reviews = [...many(2, 'p', 3, 5, 1), ...many(4, 'p', 4, 5, 400)];
    expect(kinds(detectPropertyFlags(reviews, NOW))).not.toContain('new_account_concentration');
  });
});

describe('the queue it produces', () => {
  it('raises every rule that applies, independently', () => {
    const reviews = [
      ...many(8, 'p', 24 * 20, 5),
      ...many(6, 'p', 6, 1, 1),
    ];

    expect(kinds(detectPropertyFlags(reviews, NOW))).toEqual([
      'new_account_concentration',
      'rating_anomaly',
      'review_burst',
    ]);
  });

  it('keeps properties separate', () => {
    const reviews = [...many(6, 'a', 3), ...many(6, 'b', 3)];
    const properties = detectPropertyFlags(reviews, NOW).map((f) => f.propertyId);

    expect(new Set(properties)).toEqual(new Set(['a', 'b']));
  });

  it('puts the most urgent first', () => {
    const reviews = [
      ...many(6, 'mild', 3),
      ...many(8, 'severe', 24 * 20, 5),
      ...many(6, 'severe', 6, 1, 1),
    ];

    const severities = detectPropertyFlags(reviews, NOW).map((f) => f.severity);
    expect(severities).toEqual([...severities].sort((a, b) => b - a));
  });

  it('reports the window it looked at', () => {
    const [finding] = detectPropertyFlags(many(6, 'p', 3), NOW);

    expect(finding!.windowEnd).toBe(NOW.toISOString());
    expect(new Date(finding!.windowStart).getTime()).toBe(
      NOW.getTime() - BURST_DETECTION.windowHours * HOUR,
    );
  });
});
