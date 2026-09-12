import { describe, expect, it } from 'vitest';

import {
  interleavePlaceSuggestions,
  placeSuggestions,
} from '@/lib/search/place-suggestions';
import type { PropertyAddress, SearchSuggestion } from '@/types/domain';

/**
 * City and neighbourhood suggestions.
 *
 * The Supabase adapter offered none of these, so typing "Lekki" led somewhere
 * useful in development and nowhere in production. Both adapters now share
 * this ranking, and what is asserted here is the behaviour a searcher sees:
 * a specific address still wins, a place name still leads somewhere, and a
 * place row never claims a review count it cannot support.
 */

function address(overrides: Partial<PropertyAddress> = {}): PropertyAddress {
  return {
    buildingName: null,
    streetAddress: '1 Example Road',
    neighbourhood: null,
    locality: 'Lagos',
    adminArea: 'Lagos State',
    postalCode: null,
    countryCode: 'NG',
    ...overrides,
  };
}

function property(label: string): SearchSuggestion {
  return { kind: 'property', label, sublabel: '', href: `/property/${label}`, reviewCount: 3 };
}

describe('placeSuggestions', () => {
  it('offers the neighbourhood a query names', () => {
    const found = placeSuggestions('Lekki', [
      address({ neighbourhood: 'Lekki Phase 1' }),
      address({ neighbourhood: 'Yaba' }),
    ]);

    expect(found.map((s) => s.label)).toEqual(['Lekki Phase 1']);
    expect(found[0]!.kind).toBe('neighbourhood');
    expect(found[0]!.href).toBe('/places/ng/lagos/lekki%20phase%201');
  });

  it('offers the city a query names', () => {
    const found = placeSuggestions('Lagos', [address({ neighbourhood: 'Yaba' })]);

    const city = found.find((s) => s.kind === 'locality');
    expect(city?.label).toBe('Lagos');
    expect(city?.href).toBe('/places/ng/lagos');
    expect(city?.sublabel).toBe('Lagos State, NG');
  });

  it('never states a review count for a place', () => {
    // A place row aggregates properties and has no honest per-place total to
    // show, so it shows none rather than a number it made up.
    const found = placeSuggestions('Lagos', [address({ neighbourhood: 'Yaba' })]);
    expect(found.every((s) => s.reviewCount === null)).toBe(true);
  });

  it('deduplicates a place that many properties sit in', () => {
    const found = placeSuggestions('Lekki', [
      address({ neighbourhood: 'Lekki Phase 1' }),
      address({ neighbourhood: 'Lekki Phase 1' }),
      address({ neighbourhood: 'Lekki Phase 1' }),
    ]);

    expect(found).toHaveLength(1);
  });

  it('ranks the place more properties sit in first, for an equal match', () => {
    const found = placeSuggestions('ikoyi', [
      address({ locality: 'Lagos', neighbourhood: 'Ikoyi' }),
      address({ locality: 'Lagos', neighbourhood: 'Ikoyi' }),
      address({ locality: 'Abuja', neighbourhood: 'Ikoyi' }),
    ]);

    expect(found.map((s) => s.sublabel)).toEqual(['Lagos, Lagos State', 'Abuja, Lagos State']);
  });

  it('separates identically named areas in different cities', () => {
    const found = placeSuggestions('mitte', [
      address({ countryCode: 'DE', locality: 'Berlin', neighbourhood: 'Mitte' }),
      address({ countryCode: 'DE', locality: 'Hamburg', neighbourhood: 'Mitte' }),
    ]);

    expect(found).toHaveLength(2);
    expect(new Set(found.map((s) => s.href)).size).toBe(2);
  });

  it('says nothing for a query too short to mean anything', () => {
    expect(placeSuggestions('L', [address({ neighbourhood: 'Lekki Phase 1' })])).toEqual([]);
    expect(placeSuggestions('  ', [address({ neighbourhood: 'Lekki Phase 1' })])).toEqual([]);
  });

  it('offers nothing when no place matches', () => {
    expect(placeSuggestions('Reykjavik', [address({ neighbourhood: 'Yaba' })])).toEqual([]);
  });
});

describe('interleavePlaceSuggestions', () => {
  const places: SearchSuggestion[] = [
    { kind: 'locality', label: 'Lagos', sublabel: '', href: '/places/ng/lagos', reviewCount: null },
    { kind: 'neighbourhood', label: 'Yaba', sublabel: '', href: '/places/ng/lagos/yaba', reviewCount: null },
  ];

  it('puts specific addresses ahead of any place', () => {
    const merged = interleavePlaceSuggestions(
      ['a', 'b', 'c', 'd', 'e'].map(property),
      places,
      7,
    );

    expect(merged.slice(0, 3).map((s) => s.label)).toEqual(['a', 'b', 'c']);
    expect(merged.slice(3, 5).map((s) => s.label)).toEqual(['Lagos', 'Yaba']);
  });

  it('reserves the slots rather than letting properties fill the list', () => {
    // The bug this prevents: ten matching properties and a limit of seven
    // meant a city the searcher typed by name never appeared at all.
    const merged = interleavePlaceSuggestions(
      Array.from({ length: 10 }, (_, i) => property(`p${i}`)),
      places,
      7,
    );

    expect(merged).toHaveLength(7);
    expect(merged.filter((s) => s.kind !== 'property')).toHaveLength(2);
  });

  it('leads with places when nothing else matched', () => {
    const merged = interleavePlaceSuggestions([], places, 7);
    expect(merged.map((s) => s.label)).toEqual(['Lagos', 'Yaba']);
  });

  it('is the property list unchanged when there are no places', () => {
    const properties = ['a', 'b'].map(property);
    expect(interleavePlaceSuggestions(properties, [], 7)).toEqual(properties);
  });

  it('never exceeds the limit', () => {
    for (const limit of [1, 2, 3, 4, 5, 7]) {
      const merged = interleavePlaceSuggestions(['a', 'b', 'c', 'd'].map(property), places, limit);
      expect(merged.length).toBeLessThanOrEqual(limit);
    }
  });
});
