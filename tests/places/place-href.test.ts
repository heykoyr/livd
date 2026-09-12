import { describe, expect, it } from 'vitest';

import {
  countryHref,
  decodePlaceSegment,
  localityHref,
  neighbourhoodHref,
} from '@/lib/places';

/**
 * The URL shape of the place hierarchy.
 *
 * These four functions replaced four hand-written copies of the same
 * lowercase-and-encode rule, and the reason they are tested rather than
 * trusted is that a drifted copy does not fail loudly — it produces a link
 * that 404s for a reader and a duplicate for an index.
 */

describe('place URLs', () => {
  it('lowercases the country code', () => {
    expect(countryHref('GB')).toBe('/places/gb');
    expect(countryHref('ng')).toBe('/places/ng');
  });

  it('folds case so one place has one URL', () => {
    // Two spellings of the same city must not become two indexable pages.
    expect(localityHref('GB', 'London')).toBe(localityHref('gb', 'LONDON'));
    expect(neighbourhoodHref('CA', 'Toronto', 'The Junction')).toBe(
      neighbourhoodHref('ca', 'toronto', 'the junction'),
    );
  });

  it('encodes every segment', () => {
    expect(localityHref('NG', 'Port Harcourt')).toBe('/places/ng/port%20harcourt');
    expect(neighbourhoodHref('NG', 'Lagos', 'Lekki Phase 1')).toBe(
      '/places/ng/lagos/lekki%20phase%201',
    );
    // A slash in a stored name must not invent a path segment.
    expect(neighbourhoodHref('DE', 'Berlin', 'Mitte/Tiergarten')).toBe(
      '/places/de/berlin/mitte%2Ftiergarten',
    );
  });

  it('nests each level under the one above it', () => {
    const country = countryHref('CA');
    const city = localityHref('CA', 'Toronto');
    const area = neighbourhoodHref('CA', 'Toronto', 'The Junction');

    expect(city.startsWith(`${country}/`)).toBe(true);
    expect(area.startsWith(`${city}/`)).toBe(true);
  });

  it('round-trips a segment back to something readable', () => {
    expect(decodePlaceSegment('lekki%20phase%201')).toBe('lekki phase 1');
  });

  it('returns the raw segment rather than throwing on a malformed escape', () => {
    // A hand-mangled URL must render a not-found page, never a 500. The
    // lookup this feeds simply matches nothing.
    expect(decodePlaceSegment('%E0%A4%A')).toBe('%E0%A4%A');
    expect(decodePlaceSegment('100%')).toBe('100%');
  });
});
