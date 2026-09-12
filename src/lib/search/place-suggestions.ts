import { localityHref, neighbourhoodHref } from '@/lib/places';
import type { PropertyAddress, SearchSuggestion } from '@/types/domain';
import { matchScore, normaliseForSearch } from './matching';

/**
 * City and neighbourhood suggestions, derived from addresses.
 *
 * Livd has no gazetteer. A place exists here exactly when a property carries
 * its name, which means the set of cities and neighbourhoods worth suggesting
 * is a projection of the properties themselves rather than a table to join
 * against. Deriving it keeps the suggestion list honest: it can only ever
 * offer somewhere Livd has something to say about.
 *
 * Both adapters use this, so a typeahead behaves the same against Postgres as
 * against the local store. What differs is the input — the local adapter can
 * afford to pass every visible property, while the Supabase adapter passes the
 * rows its search RPC already matched — and that difference is honest: it
 * means the two are ranking the same way over the candidates each can see.
 */

/** Properties shown before any place, so a specific address always wins. */
const PROPERTIES_FIRST = 3;
/** At most this many places, so the list stays a shortcut rather than a browse. */
const MAX_PLACES = 2;

export function placeSuggestions(
  query: string,
  addresses: PropertyAddress[],
): SearchSuggestion[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  interface Candidate {
    suggestion: SearchSuggestion;
    score: number;
    propertyCount: number;
  }

  const candidates = new Map<string, Candidate>();

  const consider = (
    key: string,
    kind: 'locality' | 'neighbourhood',
    label: string,
    sublabel: string,
    href: string,
  ): void => {
    const existing = candidates.get(key);
    if (existing) {
      existing.propertyCount += 1;
      return;
    }

    const result = matchScore(trimmed, { haystack: label });
    if (!result) return;

    candidates.set(key, {
      // `reviewCount` stays null: this is an aggregate of properties, and the
      // suggestion row has no honest per-place review total to show.
      suggestion: { kind, label, sublabel, href, reviewCount: null },
      score: result.score,
      propertyCount: 1,
    });
  };

  for (const address of addresses) {
    const { countryCode, locality, adminArea, neighbourhood } = address;

    consider(
      `locality:${countryCode}:${normaliseForSearch(locality)}`,
      'locality',
      locality,
      [adminArea, countryCode].filter(Boolean).join(', '),
      localityHref(countryCode, locality),
    );

    if (neighbourhood) {
      consider(
        `neighbourhood:${countryCode}:${normaliseForSearch(locality)}:${normaliseForSearch(
          neighbourhood,
        )}`,
        'neighbourhood',
        neighbourhood,
        [locality, adminArea].filter(Boolean).join(', '),
        neighbourhoodHref(countryCode, locality, neighbourhood),
      );
    }
  }

  return [...candidates.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.propertyCount - a.propertyCount ||
        a.suggestion.label.localeCompare(b.suggestion.label),
    )
    .map((candidate) => candidate.suggestion);
}

/**
 * Places get reserved slots rather than a shared ranking.
 *
 * Property and place matches are scored on different scales — one is a text
 * rank from Postgres, the other a trigram score computed here — so comparing
 * them numerically would be inventing a comparison. Reserving a couple of
 * slots below the top properties is the honest version of the same intent:
 * somebody typing an exact address still sees it first, and somebody typing
 * "Lekki" still gets Lekki.
 */
export function interleavePlaceSuggestions(
  properties: SearchSuggestion[],
  places: SearchSuggestion[],
  limit: number,
): SearchSuggestion[] {
  if (places.length === 0) return properties.slice(0, limit);

  return [
    ...properties.slice(0, PROPERTIES_FIRST),
    ...places.slice(0, MAX_PLACES),
    ...properties.slice(PROPERTIES_FIRST),
  ].slice(0, limit);
}
