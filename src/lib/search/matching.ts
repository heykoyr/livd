/**
 * Search matching.
 *
 * Renters do not know how a property is filed. They type "admiralty way lekki",
 * or "12 adewale st", or a building's old name, or they misspell it. Requiring
 * exact address formatting would make the product useless to precisely the
 * person it is for.
 *
 * Four strategies, tried in order of confidence:
 *
 *   1. Exact and prefix matches on any address component.
 *   2. All-tokens-present matching, so word order does not matter.
 *   3. Trigram similarity, for typos and transpositions.
 *   4. Alias matching, for former and colloquial building names.
 *
 * The Supabase adapter delegates this to Postgres (`tsvector` rank combined
 * with `pg_trgm` similarity — `livd_property_search`). This module is the
 * portable reference implementation, used by the local adapter and by the tests
 * that both adapters share.
 */

export interface MatchTarget {
  /** Everything searchable about a record, joined. */
  haystack: string;
  /** Alternative names for the same record. */
  aliases?: string[];
}

export interface MatchResult {
  score: number;
  /** True when only fuzzy matching found this, so the UI can say "close match". */
  fuzzy: boolean;
}

/** Strips accents, punctuation and case so comparison is on content alone. */
export function normaliseForSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Address noise words. "12 Adewale Street" and "12 Adewale St" must match, and
 * neither should score highly just for containing "street".
 */
const STOP_WORDS = new Set([
  'street', 'st', 'road', 'rd', 'avenue', 'ave', 'lane', 'ln', 'drive', 'dr',
  'close', 'court', 'ct', 'place', 'pl', 'way', 'terrace', 'crescent', 'gardens',
  'square', 'sq', 'apartments', 'apartment', 'flats', 'flat', 'building', 'block',
  'house', 'the', 'of', 'and', 'at', 'in', 'on',
]);

const ABBREVIATIONS: Record<string, string> = {
  st: 'street',
  rd: 'road',
  ave: 'avenue',
  ln: 'lane',
  dr: 'drive',
  ct: 'court',
  pl: 'place',
  sq: 'square',
  apt: 'apartment',
  bldg: 'building',
  hts: 'heights',
  pk: 'park',
};

export function tokenise(value: string): string[] {
  return normaliseForSearch(value)
    .split(' ')
    .filter((token) => token.length > 0)
    .map((token) => ABBREVIATIONS[token] ?? token);
}

/** Tokens carrying actual identity, with address furniture removed. */
export function significantTokens(value: string): string[] {
  const tokens = tokenise(value);
  const significant = tokens.filter((token) => !STOP_WORDS.has(token));
  // A query made entirely of stop words still has to match something.
  return significant.length > 0 ? significant : tokens;
}

/* -------------------------------------------------------------------------
 * Trigram similarity — the same measure Postgres `pg_trgm` uses, so the local
 * and database adapters rank comparably.
 * ---------------------------------------------------------------------- */

export function trigrams(value: string): Set<string> {
  const padded = `  ${normaliseForSearch(value)} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** Jaccard similarity over trigrams. 0–1. */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const gram of left) {
    if (right.has(gram)) intersection += 1;
  }

  return intersection / (left.size + right.size - intersection);
}

/** Similarity below which a fuzzy match is not worth showing. */
export const FUZZY_THRESHOLD = 0.28;

/* -------------------------------------------------------------------------
 * Scoring
 * ---------------------------------------------------------------------- */

/**
 * Scores one target against a query. Returns null when nothing matched.
 *
 * The bands are ordered so a genuine prefix match always outranks a strong
 * fuzzy one — someone typing an exact building name should never see a
 * lookalike above it.
 */
export function matchScore(query: string, target: MatchTarget): MatchResult | null {
  const normalisedQuery = normaliseForSearch(query);
  if (normalisedQuery.length === 0) return null;

  const haystack = normaliseForSearch(target.haystack);
  const aliases = (target.aliases ?? []).map(normaliseForSearch);
  const candidates = [haystack, ...aliases];

  // 1. Exact, then prefix.
  for (const [index, candidate] of candidates.entries()) {
    const aliasPenalty = index === 0 ? 0 : 4;
    if (candidate === normalisedQuery) return { score: 100 - aliasPenalty, fuzzy: false };
    if (candidate.startsWith(normalisedQuery)) return { score: 92 - aliasPenalty, fuzzy: false };
  }

  // 2. All query tokens present. Word order is irrelevant to a searching human.
  const queryTokens = significantTokens(query);
  if (queryTokens.length > 0) {
    for (const [index, candidate] of candidates.entries()) {
      const candidateTokens = new Set(tokenise(candidate));
      const matched = queryTokens.filter((token) =>
        candidateTokens.has(token) ||
        [...candidateTokens].some((c) => c.startsWith(token) && token.length >= 3),
      );

      if (matched.length === queryTokens.length) {
        // Shorter candidates are more specific matches for the same tokens.
        const specificity = Math.max(0, 12 - candidate.length / 12);
        return { score: 72 + specificity - (index === 0 ? 0 : 4), fuzzy: false };
      }

      if (matched.length > 0 && matched.length >= queryTokens.length - 1) {
        const coverage = matched.length / queryTokens.length;
        return { score: 46 + coverage * 14 - (index === 0 ? 0 : 4), fuzzy: false };
      }
    }
  }

  // 3. Substring, for a partial word mid-string.
  for (const candidate of candidates) {
    if (normalisedQuery.length >= 4 && candidate.includes(normalisedQuery)) {
      return { score: 58, fuzzy: false };
    }
  }

  // 4. Trigram similarity — typos, transpositions, dropped letters.
  let best = 0;
  for (const candidate of candidates) {
    best = Math.max(best, trigramSimilarity(normalisedQuery, candidate));

    // Also compare against the single most similar token, so a typo in one word
    // of a long address is not diluted by the rest of the string.
    for (const token of tokenise(candidate)) {
      if (token.length < 4) continue;
      for (const queryToken of queryTokens) {
        if (queryToken.length < 4) continue;
        best = Math.max(best, trigramSimilarity(queryToken, token) * 0.86);
      }
    }
  }

  if (best >= FUZZY_THRESHOLD) {
    return { score: Math.round(best * 44), fuzzy: true };
  }

  return null;
}
