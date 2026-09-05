import { describe, expect, it } from 'vitest';

import {
  SCORING,
  computeCategoryScores,
  computeOverallScore,
  computeRecommendRate,
  computeTrend,
  confidenceFor,
  ratingToScore,
  recencyWeight,
  reviewWeight,
  scoreBand,
  scoreReview,
  scoreWord,
} from '@/lib/intelligence/scoring';
import { makeReview, makeReviews, NOW } from '../fixtures';

/**
 * The Livd Score.
 *
 * Everything the product claims rests on this arithmetic, so these tests assert
 * the *properties* the design promises rather than reproducing the formula —
 * a test that recomputes the implementation proves only that it is consistent
 * with itself.
 */

describe('ratingToScore', () => {
  it('maps the 1-5 scale onto 0-100 with 3/5 as genuinely mixed', () => {
    expect(ratingToScore(1)).toBe(0);
    expect(ratingToScore(3)).toBe(50);
    expect(ratingToScore(5)).toBe(100);
  });

  it('clamps out-of-range input rather than extrapolating', () => {
    expect(ratingToScore(0)).toBe(0);
    expect(ratingToScore(9)).toBe(100);
  });
});

describe('recencyWeight', () => {
  it('treats anything inside the grace window as fully current', () => {
    // Without this, three reviews written this year sum to 2.93 and never reach
    // the `limited` band that is documented as needing three.
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(1)).toBe(1);
    expect(recencyWeight(SCORING.recencyGraceMonths)).toBe(1);
  });

  it('halves at the stated half-life beyond the grace window', () => {
    const grace = SCORING.recencyGraceMonths;
    expect(recencyWeight(grace + SCORING.recencyHalfLifeMonths)).toBeCloseTo(0.5, 5);
    expect(recencyWeight(grace + SCORING.recencyHalfLifeMonths * 2)).toBeCloseTo(0.25, 5);
  });

  it('never falls below the floor, so history is diluted and not erased', () => {
    expect(recencyWeight(600)).toBe(SCORING.recencyFloor);
    expect(recencyWeight(6000)).toBe(SCORING.recencyFloor);
  });
});

describe('reviewWeight', () => {
  it('counts a verified resident for more than an unverified one', () => {
    const shared = { movedOutMonth: '2026-05-01' };
    const verified = makeReview({ ...shared, verificationLevel: 'verified_resident' });
    const unverified = makeReview({ ...shared, verificationLevel: 'unverified' });

    expect(reviewWeight(verified, NOW)).toBeGreaterThan(reviewWeight(unverified, NOW));
    expect(reviewWeight(verified, NOW) / reviewWeight(unverified, NOW)).toBeCloseTo(
      SCORING.weightVerified,
      5,
    );
  });

  it('gives a disputed review no weight at all', () => {
    const disputed = makeReview({ verificationLevel: 'disputed', movedOutMonth: '2026-05-01' });
    expect(reviewWeight(disputed, NOW)).toBe(0);
  });

  it('dates a former resident by when they left, not when they wrote', () => {
    // Someone describing a 2016 tenancy today must not count as current
    // information just because the review is new.
    const oldTenancy = makeReview({
      movedOutMonth: '2016-01-01',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    const recentTenancy = makeReview({
      movedOutMonth: '2026-05-01',
      createdAt: '2026-05-01T00:00:00.000Z',
    });

    expect(reviewWeight(oldTenancy, NOW)).toBeLessThan(reviewWeight(recentTenancy, NOW));
  });
});

describe('scoreReview', () => {
  it('is the overall rating alone when no category was rated', () => {
    expect(scoreReview(makeReview({ overallRating: 4, categoryRatings: [] }))).toBe(75);
  });

  it('blends the overall verdict with the category detail', () => {
    // Overall 5 (=100) with uniformly poor categories (=0) must land between.
    const review = makeReview({
      overallRating: 5,
      categoryRatings: [
        { categoryKey: 'building_maintenance', rating: 1 },
        { categoryKey: 'management', rating: 1 },
      ],
    });

    const score = scoreReview(review);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
    expect(score).toBeCloseTo(100 * SCORING.overallBlend, 5);
  });

  it('weights categories by their declared importance', () => {
    // building_maintenance (1.35) outweighs parking (0.70), so praising the
    // former must score higher than praising the latter.
    const base = { overallRating: 3 };
    const goodMaintenance = makeReview({
      ...base,
      categoryRatings: [
        { categoryKey: 'building_maintenance', rating: 5 },
        { categoryKey: 'parking', rating: 1 },
      ],
    });
    const goodParking = makeReview({
      ...base,
      categoryRatings: [
        { categoryKey: 'building_maintenance', rating: 1 },
        { categoryKey: 'parking', rating: 5 },
      ],
    });

    expect(scoreReview(goodMaintenance)).toBeGreaterThan(scoreReview(goodParking));
  });

  it('ignores a category key that is not in the configuration', () => {
    const withJunk = makeReview({
      overallRating: 4,
      categoryRatings: [{ categoryKey: 'not_a_real_category', rating: 1 }],
    });
    expect(scoreReview(withJunk)).toBe(75);
  });
});

describe('computeOverallScore', () => {
  it('publishes no score at all below the confidence floor', () => {
    const result = computeOverallScore(makeReviews(2, { overallRating: 5 }), NOW);
    expect(result.confidence).toBe('insufficient');
    expect(result.score).toBeNull();
  });

  it('shrinks a small sample toward the prior rather than to an extreme', () => {
    const threePerfect = computeOverallScore(
      makeReviews(3, { overallRating: 5, movedOutMonth: '2026-05-01' }),
      NOW,
    );

    expect(threePerfect.score).not.toBeNull();
    // Three perfect reviews must not produce a 98.
    expect(threePerfect.score!).toBeLessThan(90);
    expect(threePerfect.score!).toBeGreaterThan(SCORING.prior);
  });

  it('lets a large consistent sample approach the truth', () => {
    const many = computeOverallScore(
      makeReviews(60, { overallRating: 5, movedOutMonth: '2026-05-01' }),
      NOW,
    );
    expect(many.score!).toBeGreaterThan(90);
  });

  it('pulls a thin sample far from its raw mean and a thick one barely at all', () => {
    const thinPerfect = computeOverallScore(
      makeReviews(3, { overallRating: 5, movedOutMonth: '2026-05-01' }),
      NOW,
    );
    const thickPerfect = computeOverallScore(
      makeReviews(60, { overallRating: 5, movedOutMonth: '2026-05-01' }),
      NOW,
    );

    // Both properties are unanimously perfect; only the evidence differs.
    expect(100 - thinPerfect.score!).toBeGreaterThan(15);
    expect(100 - thickPerfect.score!).toBeLessThan(5);
  });

  it('distinguishes thin from thick evidence by confidence, not by distorting the score', () => {
    // Three unanimous perfect reviews are genuine evidence of a good property,
    // so Livd does not rank it below a forty-review 4/5. What separates them is
    // the confidence band, which the interface always shows beside the number.
    const thinPerfect = computeOverallScore(
      makeReviews(3, { overallRating: 5, movedOutMonth: '2026-05-01' }),
      NOW,
    );
    const thickGood = computeOverallScore(
      makeReviews(40, { overallRating: 4, movedOutMonth: '2026-05-01' }),
      NOW,
    );

    expect(thinPerfect.confidence).toBe('limited');
    expect(thickGood.confidence).toBe('strong');
  });

  it('treats an all-disputed property as unmeasured, not as bad', () => {
    const result = computeOverallScore(
      makeReviews(10, { verificationLevel: 'disputed', overallRating: 1 }),
      NOW,
    );
    expect(result.effectiveSampleSize).toBe(0);
    expect(result.confidence).toBe('insufficient');
    expect(result.score).toBeNull();
  });

  it('lets old reviews decay out of a confident band', () => {
    const ancient = computeOverallScore(
      makeReviews(6, { movedOutMonth: '2010-01-01', overallRating: 4 }),
      NOW,
    );
    const recent = computeOverallScore(
      makeReviews(6, { movedOutMonth: '2026-05-01', overallRating: 4 }),
      NOW,
    );

    expect(ancient.effectiveSampleSize).toBeLessThan(recent.effectiveSampleSize);
  });
});

describe('confidenceFor', () => {
  it('bands the effective sample size in the documented order', () => {
    expect(confidenceFor(0)).toBe('insufficient');
    expect(confidenceFor(SCORING.confidence.limited - 0.01)).toBe('insufficient');
    expect(confidenceFor(SCORING.confidence.limited)).toBe('limited');
    expect(confidenceFor(SCORING.confidence.moderate)).toBe('moderate');
    expect(confidenceFor(SCORING.confidence.strong)).toBe('strong');
    expect(confidenceFor(500)).toBe('strong');
  });
});

describe('computeCategoryScores', () => {
  it('scores only what residents actually rated', () => {
    const reviews = makeReviews(5, {
      categoryRatings: [{ categoryKey: 'noise', rating: 4 }],
      movedOutMonth: '2026-05-01',
    });

    const scores = computeCategoryScores(reviews, NOW);
    expect(scores.map((s) => s.categoryKey)).toEqual(['noise']);
  });

  it('withholds a category score below the minimum sample', () => {
    const reviews = makeReviews(SCORING.categoryMinSample - 1, {
      categoryRatings: [{ categoryKey: 'noise', rating: 5 }],
      movedOutMonth: '2026-05-01',
    });

    const noise = computeCategoryScores(reviews, NOW).find((s) => s.categoryKey === 'noise');
    expect(noise).toBeDefined();
    expect(noise!.score).toBeNull();
    // The sample size is still reported, so the page can explain the absence.
    expect(noise!.sampleSize).toBe(SCORING.categoryMinSample - 1);
  });

  it('publishes a category score at the minimum sample', () => {
    const reviews = makeReviews(SCORING.categoryMinSample, {
      categoryRatings: [{ categoryKey: 'noise', rating: 5 }],
      movedOutMonth: '2026-05-01',
    });

    const noise = computeCategoryScores(reviews, NOW).find((s) => s.categoryKey === 'noise');
    expect(noise!.score).not.toBeNull();
  });

  it('returns categories in a stable configured order, not insertion order', () => {
    const reviews = makeReviews(4, {
      categoryRatings: [
        { categoryKey: 'parking', rating: 3 },
        { categoryKey: 'building_maintenance', rating: 3 },
        { categoryKey: 'management', rating: 3 },
      ],
      movedOutMonth: '2026-05-01',
    });

    const keys = computeCategoryScores(reviews, NOW).map((s) => s.categoryKey);
    expect(keys.indexOf('building_maintenance')).toBeLessThan(keys.indexOf('management'));
    expect(keys.indexOf('management')).toBeLessThan(keys.indexOf('parking'));
  });
});

describe('computeTrend', () => {
  const recent = { movedOutMonth: '2026-01-01' };
  const earlier = { movedOutMonth: '2021-01-01' };

  it('claims no direction without enough evidence in both windows', () => {
    const trend = computeTrend(
      [...makeReviews(10, { ...recent, overallRating: 5 }), ...makeReviews(1, { ...earlier, overallRating: 1 })],
      NOW,
    );
    expect(trend.direction).toBe('unknown');
    expect(trend.delta).toBeNull();
  });

  it('reports improvement when recent residents rate it materially higher', () => {
    const trend = computeTrend(
      [
        ...makeReviews(5, { ...recent, overallRating: 5 }),
        ...makeReviews(5, { ...earlier, overallRating: 2 }),
      ],
      NOW,
    );
    expect(trend.direction).toBe('improving');
    expect(trend.delta!).toBeGreaterThan(0);
    expect(trend.laterWindow!.sampleSize).toBe(5);
    expect(trend.earlierWindow!.sampleSize).toBe(5);
  });

  it('reports decline in the other direction', () => {
    const trend = computeTrend(
      [
        ...makeReviews(5, { ...recent, overallRating: 2 }),
        ...makeReviews(5, { ...earlier, overallRating: 5 }),
      ],
      NOW,
    );
    expect(trend.direction).toBe('declining');
    expect(trend.delta!).toBeLessThan(0);
  });

  it('calls a small movement stable rather than manufacturing a story', () => {
    const trend = computeTrend(
      [
        ...makeReviews(5, { ...recent, overallRating: 4 }),
        ...makeReviews(5, { ...earlier, overallRating: 4 }),
      ],
      NOW,
    );
    expect(trend.direction).toBe('stable');
  });
});

describe('computeRecommendRate', () => {
  it('is withheld below the minimum sample', () => {
    expect(computeRecommendRate(makeReviews(SCORING.recommendMinSample - 1))).toBeNull();
  });

  it('is the share who would return', () => {
    const reviews = [
      ...makeReviews(3, { wouldRecommend: true }),
      ...makeReviews(1, { wouldRecommend: false }),
    ];
    expect(computeRecommendRate(reviews)).toBeCloseTo(0.75, 5);
  });
});

describe('presentation', () => {
  it('bands scores consistently', () => {
    expect(scoreBand(null)).toBe('unknown');
    expect(scoreBand(95)).toBe('strong');
    expect(scoreBand(70)).toBe('good');
    expect(scoreBand(55)).toBe('mixed');
    expect(scoreBand(40)).toBe('weak');
    expect(scoreBand(10)).toBe('poor');
  });

  it('states every score in words as well as colour', () => {
    // Nothing in the product may depend on colour perception alone.
    for (const score of [null, 0, 40, 55, 70, 95]) {
      expect(scoreWord(score).length).toBeGreaterThan(0);
    }
    expect(scoreWord(null)).toBe('Unrated');
  });
});
