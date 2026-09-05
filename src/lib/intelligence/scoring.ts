/**
 * The Livd Score.
 *
 * Pure functions, no imports beyond configuration and types. This file is the
 * most heavily tested in the repository because everything the product claims
 * rests on it being right.
 *
 * The score is deliberately 0–100 rather than five stars: it is a computed
 * judgement with a stated confidence, not a consumer star average, and it
 * should not be mistaken for one.
 *
 * Four adjustments are applied, in this order:
 *
 *   1. Each review becomes a single 0–100 score, blending the resident's
 *      overall verdict with their category detail.
 *   2. Each review gets a weight — recency decay × verification.
 *   3. The weighted mean is shrunk toward a neutral prior, so three glowing
 *      reviews cannot produce a 98.
 *   4. The effective sample size determines a confidence band, and below
 *      `limited` no score is published at all.
 */

import { CATEGORY_DEFINITIONS, getCategory } from '@/config/categories';
import type {
  CategoryScore,
  ConfidenceBand,
  Review,
  ScoreTrend,
  TrendDirection,
} from '@/types/domain';

/* -------------------------------------------------------------------------
 * Constants — every magic number in the scoring system, named and explained.
 * ---------------------------------------------------------------------- */

export const SCORING = {
  /**
   * Reviews inside this window are treated as fully current.
   *
   * Without it, decay starts at month one and a review written last month is
   * already worth 0.977 — which quietly means three fresh reviews sum to 2.93
   * and never reach the `limited` band that is documented as needing three.
   * A tenancy that ended six months ago is not meaningfully staler than one
   * that ended last month, so the thresholds should mean what they say.
   */
  recencyGraceMonths: 12,

  /**
   * Past the grace window, a review's influence halves every 30 months. A
   * property under new management should not be judged indefinitely on how it
   * was run in 2019.
   */
  recencyHalfLifeMonths: 30,
  /**
   * Old reviews never fall below a quarter weight. History is diluted, not
   * erased — a decade of consistent complaints still means something.
   */
  recencyFloor: 0.25,

  /** A verified resident's review counts for 1.8 of an unverified one. */
  weightVerified: 1.8,
  weightUnverified: 1.0,
  /** A review under an authenticity dispute contributes nothing until resolved. */
  weightDisputed: 0,

  /**
   * The neutral score a property is assumed to be until residents say
   * otherwise. 65/100 ≈ 3.6/5 — slightly above the midpoint, because most
   * homes are adequate and the distribution of real housing is not centred.
   */
  prior: 65,
  /** The prior carries the weight of five reviews. */
  priorWeight: 5,

  /**
   * A resident's overall verdict is a real signal in its own right, not just
   * a summary of their categories — so it keeps a third of the weight.
   */
  overallBlend: 0.35,

  /** Effective sample size thresholds for the confidence bands. */
  confidence: {
    limited: 3,
    moderate: 6,
    strong: 14,
  },

  /** A category needs this many raters before its score is published. */
  categoryMinSample: 3,

  /** Reviews needed before the recommend rate is published. */
  recommendMinSample: 4,

  /** Score points of movement before a trend is called anything but stable. */
  trendThreshold: 6,
  /** Reviews needed in each window before a direction is claimed. */
  trendMinPerWindow: 3,
  /** Reviews at or after this point form the "recent" window. */
  trendRecentMonths: 24,
} as const;

/* -------------------------------------------------------------------------
 * Primitives
 * ---------------------------------------------------------------------- */

/** Maps a 1–5 resident rating onto the 0–100 scale. 3/5 is 50 — genuinely mixed. */
export function ratingToScore(rating: number): number {
  return ((clamp(rating, 1, 5) - 1) / 4) * 100;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The date a review's experience refers to.
 *
 * For a former resident that is when they moved out; for a current resident it
 * is when they wrote. Using the write date for everyone would let someone
 * describe a 2015 tenancy today and have it counted as current information.
 */
export function experienceDate(review: Pick<Review, 'movedOutMonth' | 'createdAt'>): Date {
  const iso = review.movedOutMonth ?? review.createdAt;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date(review.createdAt) : date;
}

export function monthsSince(date: Date, now: Date): number {
  const months =
    (now.getUTCFullYear() - date.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - date.getUTCMonth());
  return Math.max(0, months);
}

/** Full weight inside the grace window, then exponential decay with a floor. */
export function recencyWeight(months: number): number {
  if (months <= SCORING.recencyGraceMonths) return 1;

  const decayed = Math.pow(
    0.5,
    (months - SCORING.recencyGraceMonths) / SCORING.recencyHalfLifeMonths,
  );
  return Math.max(SCORING.recencyFloor, decayed);
}

export function verificationWeight(review: Pick<Review, 'verificationLevel'>): number {
  switch (review.verificationLevel) {
    case 'verified_resident':
      return SCORING.weightVerified;
    case 'disputed':
      return SCORING.weightDisputed;
    default:
      return SCORING.weightUnverified;
  }
}

/** A review's total contribution to every aggregate it participates in. */
export function reviewWeight(review: Review, now: Date = new Date()): number {
  return recencyWeight(monthsSince(experienceDate(review), now)) * verificationWeight(review);
}

/* -------------------------------------------------------------------------
 * Per-review score
 * ---------------------------------------------------------------------- */

/**
 * Collapses one review to a single 0–100 score.
 *
 * The resident's overall rating keeps a fixed share; the rest comes from a
 * category-weighted mean of whatever they actually rated. A review with no
 * category ratings is simply its overall rating.
 */
export function scoreReview(review: Review): number {
  const overall = ratingToScore(review.overallRating);

  let categoryWeightSum = 0;
  let categoryScoreSum = 0;

  for (const rating of review.categoryRatings) {
    const definition = getCategory(rating.categoryKey);
    if (!definition) continue;
    categoryWeightSum += definition.weight;
    categoryScoreSum += ratingToScore(rating.rating) * definition.weight;
  }

  if (categoryWeightSum === 0) return overall;

  const categoryComposite = categoryScoreSum / categoryWeightSum;
  return (
    overall * SCORING.overallBlend + categoryComposite * (1 - SCORING.overallBlend)
  );
}

/* -------------------------------------------------------------------------
 * Aggregation
 * ---------------------------------------------------------------------- */

export interface WeightedAggregate {
  /** Shrunk toward the prior. */
  score: number;
  /** Sum of review weights — the basis for confidence. */
  effectiveSampleSize: number;
  /** Un-shrunk weighted mean, used for trend comparison. */
  rawMean: number | null;
}

/**
 * Weighted mean with Bayesian shrinkage toward the prior.
 *
 * Shrinkage is what stops a property with two enthusiastic reviews outranking
 * one with sixty good ones — the small sample is pulled toward the middle in
 * proportion to how little evidence supports it.
 */
export function aggregate(
  entries: Array<{ score: number; weight: number }>,
): WeightedAggregate {
  let weightSum = 0;
  let weightedScoreSum = 0;

  for (const entry of entries) {
    if (entry.weight <= 0) continue;
    weightSum += entry.weight;
    weightedScoreSum += entry.score * entry.weight;
  }

  if (weightSum === 0) {
    return { score: SCORING.prior, effectiveSampleSize: 0, rawMean: null };
  }

  const shrunk =
    (weightedScoreSum + SCORING.prior * SCORING.priorWeight) /
    (weightSum + SCORING.priorWeight);

  return {
    score: shrunk,
    effectiveSampleSize: weightSum,
    rawMean: weightedScoreSum / weightSum,
  };
}

export function confidenceFor(effectiveSampleSize: number): ConfidenceBand {
  if (effectiveSampleSize >= SCORING.confidence.strong) return 'strong';
  if (effectiveSampleSize >= SCORING.confidence.moderate) return 'moderate';
  if (effectiveSampleSize >= SCORING.confidence.limited) return 'limited';
  return 'insufficient';
}

/* -------------------------------------------------------------------------
 * Overall score
 * ---------------------------------------------------------------------- */

export interface OverallResult {
  /** Null when confidence is `insufficient` — Livd publishes no number it cannot support. */
  score: number | null;
  confidence: ConfidenceBand;
  effectiveSampleSize: number;
}

export function computeOverallScore(reviews: Review[], now: Date = new Date()): OverallResult {
  const entries = reviews.map((review) => ({
    score: scoreReview(review),
    weight: reviewWeight(review, now),
  }));

  const result = aggregate(entries);
  const confidence = confidenceFor(result.effectiveSampleSize);

  return {
    score: confidence === 'insufficient' ? null : Math.round(result.score),
    confidence,
    effectiveSampleSize: Number(result.effectiveSampleSize.toFixed(2)),
  };
}

/* -------------------------------------------------------------------------
 * Category scores
 * ---------------------------------------------------------------------- */

/**
 * Scores each category independently, and only where residents actually rated
 * it. A category nobody rated is absent rather than zero — which is why a
 * London flat is never scored on water supply and a Lagos apartment is never
 * scored on central heating.
 */
export function computeCategoryScores(
  reviews: Review[],
  now: Date = new Date(),
): CategoryScore[] {
  const buckets = new Map<string, Array<{ score: number; weight: number }>>();

  for (const review of reviews) {
    const weight = reviewWeight(review, now);
    if (weight <= 0) continue;

    for (const rating of review.categoryRatings) {
      if (!getCategory(rating.categoryKey)) continue;
      const bucket = buckets.get(rating.categoryKey) ?? [];
      bucket.push({ score: ratingToScore(rating.rating), weight });
      buckets.set(rating.categoryKey, bucket);
    }
  }

  const scores: CategoryScore[] = [];

  for (const [categoryKey, entries] of buckets) {
    const sampleSize = entries.length;
    const result = aggregate(entries);
    const confidence = categoryConfidence(sampleSize);

    scores.push({
      categoryKey,
      score: sampleSize < SCORING.categoryMinSample ? null : Math.round(result.score),
      sampleSize,
      confidence,
    });
  }

  // Ordered by the category definitions, so the page reads the same every time.
  const order = new Map(CATEGORY_DEFINITIONS.map((c, i) => [c.key, i]));
  return scores.sort(
    (a, b) => (order.get(a.categoryKey) ?? 999) - (order.get(b.categoryKey) ?? 999),
  );
}

function categoryConfidence(sampleSize: number): ConfidenceBand {
  if (sampleSize >= 10) return 'strong';
  if (sampleSize >= 5) return 'moderate';
  if (sampleSize >= SCORING.categoryMinSample) return 'limited';
  return 'insufficient';
}

/* -------------------------------------------------------------------------
 * Trend
 * ---------------------------------------------------------------------- */

/**
 * Compares recent residents with earlier ones.
 *
 * Uses un-shrunk means, because shrinkage would pull both windows toward the
 * same prior and flatten exactly the difference being measured. Both windows
 * must independently clear a minimum sample before any direction is claimed.
 */
export function computeTrend(reviews: Review[], now: Date = new Date()): ScoreTrend {
  const recent: Array<{ score: number; weight: number }> = [];
  const earlier: Array<{ score: number; weight: number }> = [];
  let recentOldestYear = Infinity;
  let earlierNewestYear = -Infinity;
  let earlierOldestYear = Infinity;

  for (const review of reviews) {
    const weight = reviewWeight(review, now);
    if (weight <= 0) continue;

    const date = experienceDate(review);
    const entry = { score: scoreReview(review), weight };
    const year = date.getUTCFullYear();

    if (monthsSince(date, now) <= SCORING.trendRecentMonths) {
      recent.push(entry);
      recentOldestYear = Math.min(recentOldestYear, year);
    } else {
      earlier.push(entry);
      earlierNewestYear = Math.max(earlierNewestYear, year);
      earlierOldestYear = Math.min(earlierOldestYear, year);
    }
  }

  if (
    recent.length < SCORING.trendMinPerWindow ||
    earlier.length < SCORING.trendMinPerWindow
  ) {
    return { direction: 'unknown', delta: null, earlierWindow: null, laterWindow: null };
  }

  const recentMean = aggregate(recent).rawMean;
  const earlierMean = aggregate(earlier).rawMean;
  if (recentMean === null || earlierMean === null) {
    return { direction: 'unknown', delta: null, earlierWindow: null, laterWindow: null };
  }

  const delta = Math.round(recentMean - earlierMean);
  let direction: TrendDirection = 'stable';
  if (delta >= SCORING.trendThreshold) direction = 'improving';
  else if (delta <= -SCORING.trendThreshold) direction = 'declining';

  return {
    direction,
    delta,
    earlierWindow: {
      label: windowLabel(earlierOldestYear, earlierNewestYear),
      score: Math.round(earlierMean),
      sampleSize: earlier.length,
    },
    laterWindow: {
      label: windowLabel(recentOldestYear, now.getUTCFullYear()),
      score: Math.round(recentMean),
      sampleSize: recent.length,
    },
  };
}

function windowLabel(from: number, to: number): string {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return '';
  return from === to ? String(from) : `${from}–${to}`;
}

/* -------------------------------------------------------------------------
 * Presentation helpers
 * ---------------------------------------------------------------------- */

export type ScoreBand = 'strong' | 'good' | 'mixed' | 'weak' | 'poor' | 'unknown';

/** The sentiment band a score falls into. Drives colour — never meaning alone. */
export function scoreBand(score: number | null): ScoreBand {
  if (score === null) return 'unknown';
  if (score >= 80) return 'strong';
  if (score >= 65) return 'good';
  if (score >= 50) return 'mixed';
  if (score >= 35) return 'weak';
  return 'poor';
}

/**
 * The word for a score. Every score is stated in words as well as colour and
 * number, so nothing depends on colour perception.
 */
export function scoreWord(score: number | null): string {
  switch (scoreBand(score)) {
    case 'strong':
      return 'Strong';
    case 'good':
      return 'Good';
    case 'mixed':
      return 'Mixed';
    case 'weak':
      return 'Weak';
    case 'poor':
      return 'Poor';
    default:
      return 'Unrated';
  }
}

/** Recommend rate, suppressed below a sample that would make it meaningful. */
export function computeRecommendRate(reviews: Review[]): number | null {
  if (reviews.length < SCORING.recommendMinSample) return null;
  const yes = reviews.filter((r) => r.wouldRecommend).length;
  return yes / reviews.length;
}
