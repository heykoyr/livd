import { z } from 'zod';

import { PROPERTY_TYPE_KEYS } from '@/config/markets';
import type { SearchFilters } from '@/types/domain';

/**
 * Search parameters.
 *
 * Parsed rather than trusted: a URL is user input, and a malformed one should
 * produce a sensible page rather than an error. Every field falls back to a
 * safe default, so `/search?page=-4&sort=nonsense` renders page one, sorted by
 * relevance — not a 500.
 */

const sortValues = [
  'relevance',
  'score_desc',
  'score_asc',
  'reviews_desc',
  'recent',
] as const;

export const searchParamsSchema = z.object({
  q: z.string().trim().max(160).catch('').default(''),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toUpperCase())
    .nullable()
    .catch(null)
    .default(null),
  locality: z.string().trim().max(120).nullable().catch(null).default(null),
  type: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : value.split(',')))
    .transform((values) =>
      values
        .map((v) => v.trim())
        .filter((v): v is (typeof PROPERTY_TYPE_KEYS)[number] =>
          (PROPERTY_TYPE_KEYS as string[]).includes(v),
        ),
    )
    .catch([])
    .default([]),
  minScore: z.coerce.number().int().min(0).max(100).nullable().catch(null).default(null),
  minReviews: z.coerce.number().int().min(1).max(200).nullable().catch(null).default(null),
  verified: z
    .union([z.literal('1'), z.literal('true'), z.literal('on')])
    .transform(() => true)
    .catch(false)
    .default(false),
  sort: z.enum(sortValues).catch('relevance').default('relevance'),
  page: z.coerce.number().int().min(1).max(500).catch(1).default(1),
});

export function parseSearchFilters(
  params: Record<string, string | string[] | undefined>,
): SearchFilters {
  const parsed = searchParamsSchema.parse({
    q: params.q,
    country: params.country ?? null,
    locality: params.locality ?? null,
    type: params.type ?? [],
    minScore: params.minScore ?? null,
    minReviews: params.minReviews ?? null,
    verified: params.verified,
    sort: params.sort,
    page: params.page,
  });

  return {
    query: parsed.q,
    countryCode: parsed.country,
    locality: parsed.locality,
    propertyTypes: parsed.type,
    minScore: parsed.minScore,
    minReviews: parsed.minReviews,
    verifiedOnly: parsed.verified,
    // A query-less search has no relevance to sort by, so it falls back to the
    // best-evidenced properties rather than an arbitrary order.
    sort: parsed.sort === 'relevance' && parsed.q.length === 0 ? 'reviews_desc' : parsed.sort,
    page: parsed.page,
  };
}

/**
 * Whether this URL actually asks for anything.
 *
 * Search used to run a query no matter what, and an empty query matched every
 * property — so `/search` with nothing typed returned the entire database,
 * ordered by review count. What that produced was a page headed "18
 * properties" listing buildings in Brooklyn, Berlin, Sydney and Lagos with no
 * relationship to each other or to the visitor: a catalogue of Livd's
 * contents, offered to somebody who had not asked a question yet.
 *
 * A query is intent. So is a filter — arriving from a city link on Explore
 * with `?country=NG&locality=Lagos` is a deliberate request to browse that
 * place, and must keep working. What is *not* intent is a bare `/search`, and
 * that is the only case this excludes: the page shows a starting state and
 * runs no property query at all.
 */
export function hasSearchIntent(filters: SearchFilters): boolean {
  return filters.query.trim().length > 0 || hasActiveFilters(filters);
}

/** Rebuilds the search URL, dropping defaults so links stay readable. */
export function buildSearchHref(filters: SearchFilters, overrides: Partial<SearchFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();

  if (merged.query) params.set('q', merged.query);
  if (merged.countryCode) params.set('country', merged.countryCode);
  if (merged.locality) params.set('locality', merged.locality);
  if (merged.propertyTypes.length > 0) params.set('type', merged.propertyTypes.join(','));
  if (merged.minScore !== null) params.set('minScore', String(merged.minScore));
  if (merged.minReviews !== null) params.set('minReviews', String(merged.minReviews));
  if (merged.verifiedOnly) params.set('verified', '1');
  if (merged.sort !== 'relevance' && !(merged.sort === 'reviews_desc' && !merged.query)) {
    params.set('sort', merged.sort);
  }
  if (merged.page > 1) params.set('page', String(merged.page));

  const query = params.toString();
  return query ? `/search?${query}` : '/search';
}

/** True when anything beyond the query itself is narrowing the results. */
export function hasActiveFilters(filters: SearchFilters): boolean {
  return (
    filters.countryCode !== null ||
    filters.locality !== null ||
    filters.propertyTypes.length > 0 ||
    filters.minScore !== null ||
    filters.minReviews !== null ||
    filters.verifiedOnly
  );
}

export function countActiveFilters(filters: SearchFilters): number {
  return [
    filters.countryCode !== null,
    filters.locality !== null,
    filters.propertyTypes.length > 0,
    filters.minScore !== null,
    filters.minReviews !== null,
    filters.verifiedOnly,
  ].filter(Boolean).length;
}
