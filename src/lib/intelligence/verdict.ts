/**
 * Resident verdict and pre-visit checks.
 *
 * The verdict is assembled deterministically from aggregates that have already
 * cleared their own disclosure thresholds. It cannot state anything residents
 * did not report, because it has no access to anything else — the only inputs
 * are counts and scores.
 *
 * `VerdictGenerator` exists so a language model can be substituted later. Any
 * such implementation must take the same grounded aggregates as its only input;
 * the interface is the guarantee that a future summariser cannot reach past the
 * data into free invention.
 */

import { categoryLabel, getCategory } from '@/config/categories';
import { getDepartureReason } from '@/config/departure-reasons';
import { getTag, tagLabel } from '@/config/tags';
import type {
  PreVisitCheck,
  PropertyIntelligence,
  ResidentVerdict,
} from '@/types/domain';

export interface VerdictGenerator {
  generate(intelligence: PropertyIntelligence): ResidentVerdict;
}

/* -------------------------------------------------------------------------
 * Thresholds
 * ---------------------------------------------------------------------- */

/** A category is a strength at or above this score. */
const STRENGTH_SCORE = 70;
/** A category is a concern at or below this score. */
const CONCERN_SCORE = 56;
/** A tag must be mentioned by this share of residents to enter the verdict. */
const TAG_SHARE = 0.25;
const MAX_ITEMS = 3;

/* -------------------------------------------------------------------------
 * The rules-based generator
 * ---------------------------------------------------------------------- */

export const rulesVerdictGenerator: VerdictGenerator = {
  generate(intelligence: PropertyIntelligence): ResidentVerdict {
    const strengths = collectStrengths(intelligence);
    const concerns = collectConcerns(intelligence);

    return {
      summary: composeSummary(intelligence, strengths, concerns),
      strengths,
      concerns,
      basis: {
        reviewCount: intelligence.reviewCount,
        confidence: intelligence.confidence,
      },
    };
  },
};

export function generateVerdict(intelligence: PropertyIntelligence): ResidentVerdict {
  return rulesVerdictGenerator.generate(intelligence);
}

/* -------------------------------------------------------------------------
 * Strengths and concerns
 * ---------------------------------------------------------------------- */

function collectStrengths(intelligence: PropertyIntelligence): string[] {
  const fromCategories = intelligence.categoryScores
    .filter((c) => c.score !== null && c.score >= STRENGTH_SCORE)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((c) => categoryLabel(c.categoryKey));

  const fromTags = intelligence.topPositiveTags
    .filter((t) => t.share >= TAG_SHARE)
    .map((t) => tagLabel(t.tagKey));

  return dedupe([...fromCategories, ...fromTags]).slice(0, MAX_ITEMS);
}

function collectConcerns(intelligence: PropertyIntelligence): string[] {
  const fromCategories = intelligence.categoryScores
    .filter((c) => c.score !== null && c.score <= CONCERN_SCORE)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .map((c) => categoryLabel(c.categoryKey));

  const fromTags = intelligence.topProblemTags
    .filter((t) => t.share >= TAG_SHARE)
    .map((t) => tagLabel(t.tagKey));

  return dedupe([...fromCategories, ...fromTags]).slice(0, MAX_ITEMS);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/* -------------------------------------------------------------------------
 * Summary composition
 * ---------------------------------------------------------------------- */

function composeSummary(
  intelligence: PropertyIntelligence,
  strengths: string[],
  concerns: string[],
): string {
  const sentences: string[] = [];

  // 1. The balance of praise and complaint.
  const praise = lowerFirst(list(strengths.slice(0, 2)));
  const complaint = lowerFirst(list(concerns.slice(0, 2)));

  if (strengths.length > 0 && concerns.length > 0) {
    sentences.push(`Residents rate ${praise} well, but consistently raise ${complaint}.`);
  } else if (strengths.length > 0) {
    sentences.push(`Residents consistently rate ${praise} well, with no category standing out as a problem.`);
  } else if (concerns.length > 0) {
    sentences.push(`Residents consistently raise ${complaint}.`);
  } else if (intelligence.overallScore !== null) {
    sentences.push('Resident ratings are middling across the board, with nothing standing out either way.');
  } else {
    sentences.push('There are not yet enough reviews to say what residents consistently experience here.');
  }

  // 2. Why people left — only where the distribution cleared its threshold.
  const topDeparture = intelligence.departures.reasons[0];
  if (!intelligence.departures.suppressed && topDeparture) {
    const definition = getDepartureReason(topDeparture.reasonKey);
    if (definition) {
      const pct = Math.round(topDeparture.share * 100);
      sentences.push(
        `Of the ${intelligence.departures.respondents} former residents who said why they moved out, ${pct}% pointed to ${definition.phrase}.`,
      );
    }
  }

  // 3. Direction of travel.
  if (intelligence.trend.direction === 'improving' && intelligence.trend.delta !== null) {
    sentences.push(
      `Recent residents rate the property ${intelligence.trend.delta} points higher than earlier ones.`,
    );
  } else if (intelligence.trend.direction === 'declining' && intelligence.trend.delta !== null) {
    sentences.push(
      `Recent residents rate the property ${Math.abs(intelligence.trend.delta)} points lower than earlier ones.`,
    );
  }

  // 4. Whether they would do it again.
  if (intelligence.recommendRate !== null) {
    const pct = Math.round(intelligence.recommendRate * 100);
    sentences.push(`${pct}% say they would live here again.`);
  }

  return sentences.join(' ');
}

/** "a", "a and b", "a, b and c" — no Oxford comma, matching the product voice. */
function list(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Lowercases a label's first letter for mid-sentence use, unless it is an
 * acronym or proper noun (two consecutive capitals).
 */
function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  if (/^[A-Z]{2}/.test(value)) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/* -------------------------------------------------------------------------
 * Pre-visit checks
 *
 * Turns the property's weak points into questions the renter can ask out loud.
 * For many users this is the single most actionable thing on the page.
 * ---------------------------------------------------------------------- */

const CATEGORY_QUESTIONS: Record<string, string> = {
  building_maintenance:
    'When was the last repair reported here, and how long did it take to fix?',
  management: 'Who do I contact when something breaks, and what is the usual response time?',
  value: 'What is the total monthly cost — rent, service charge, utilities and anything else?',
  safety: 'What security is in place at the entrance, and has there been an incident recently?',
  noise: 'Can I visit in the evening or at a weekend to hear what it is actually like?',
  utilities: 'Which services have been interrupted in the last year, and for how long?',
  neighbours: 'Who lives in the units either side and above?',
  location: 'How long is the walk to the nearest transport, and how does it run late at night?',
  water_supply: 'Where does the water come from, and how often does supply fail?',
  power_reliability: 'How often does power go out, and what backup is provided?',
  heating_cooling: 'What does it cost to heat or cool in the worst month of the year?',
  damp_mould: 'Has any part of this home been treated for damp or mould, and when?',
  internet: 'Which providers can actually be installed here, and what speed do residents get?',
  cleanliness: 'Who cleans the shared areas, how often, and where do the bins go?',
  parking: 'Is a parking space included, and is it secure?',
  accessibility: 'Is there step-free access to this unit, and how often is the lift out of service?',
  drainage: 'Has this property flooded, and what was done about it?',
  pests: 'Has there been a pest treatment here, and when was the last one?',
  natural_light: 'Which direction do the main windows face, and what overlooks them?',
  laundry: 'What laundry provision is there, and what does it cost?',
  bike_storage: 'Where can bikes be stored, and is it secure?',
};

/**
 * Builds up to four questions, ordered by how much the evidence justifies
 * asking them: weak categories first, then recurring problems, then the most
 * common reason people left.
 */
export function buildPreVisitChecks(
  intelligence: PropertyIntelligence,
  limit = 4,
): PreVisitCheck[] {
  const checks: PreVisitCheck[] = [];
  const seenCategories = new Set<string>();

  // 1. The weakest scored categories.
  const weakCategories = intelligence.categoryScores
    .filter((c) => c.score !== null && c.score <= CONCERN_SCORE)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  for (const category of weakCategories) {
    const question = CATEGORY_QUESTIONS[category.categoryKey];
    if (!question || seenCategories.has(category.categoryKey)) continue;
    seenCategories.add(category.categoryKey);
    checks.push({
      categoryKey: category.categoryKey,
      question,
      reason: `${categoryLabel(category.categoryKey)} scores ${category.score} out of 100 across ${
        category.sampleSize
      } ${category.sampleSize === 1 ? 'resident' : 'residents'}.`,
    });
    if (checks.length >= limit) return checks;
  }

  // 2. The most frequently reported problems.
  for (const tag of intelligence.topProblemTags) {
    const definition = getTag(tag.tagKey);
    const categoryKey = definition?.categoryKey ?? null;
    if (!categoryKey || seenCategories.has(categoryKey)) continue;
    const question = CATEGORY_QUESTIONS[categoryKey];
    if (!question) continue;

    seenCategories.add(categoryKey);
    checks.push({
      categoryKey,
      question,
      reason: `${tag.count} of ${intelligence.reviewCount} residents mentioned ${lowerFirst(
        tagLabel(tag.tagKey),
      )}.`,
    });
    if (checks.length >= limit) return checks;
  }

  // 3. The most common reason people left.
  const topDeparture = intelligence.departures.reasons[0];
  if (!intelligence.departures.suppressed && topDeparture) {
    const definition = getDepartureReason(topDeparture.reasonKey);
    const categoryKey = definition?.relatedCategory ?? null;
    if (definition && categoryKey && !seenCategories.has(categoryKey)) {
      const question = CATEGORY_QUESTIONS[categoryKey];
      if (question) {
        seenCategories.add(categoryKey);
        checks.push({
          categoryKey,
          question,
          reason: `The most common reason former residents gave for leaving was ${definition.phrase}.`,
        });
      }
    }
  }

  // 4. A universally useful question, if the property has raised nothing specific.
  if (checks.length === 0 && intelligence.reviewCount > 0) {
    checks.push({
      categoryKey: null,
      question: 'What has been repaired in this home in the last twelve months?',
      reason: 'Residents have not flagged a specific recurring problem here.',
    });
  }

  return checks.slice(0, limit);
}

/** Categories worth naming as strengths on the property header. */
export function standoutCategories(
  intelligence: PropertyIntelligence,
  limit = 2,
): Array<{ categoryKey: string; label: string; score: number }> {
  return intelligence.categoryScores
    .filter((c) => c.score !== null && c.score >= STRENGTH_SCORE && getCategory(c.categoryKey))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
    .map((c) => ({
      categoryKey: c.categoryKey,
      label: categoryLabel(c.categoryKey),
      score: c.score!,
    }));
}
