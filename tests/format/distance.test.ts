import { describe, expect, it } from 'vitest';

import { formatDistance } from '@/lib/format';

/**
 * Distance, localised at the edge.
 *
 * Every geospatial calculation in Livd is in metres; this is the single point
 * where that becomes a unit a reader recognises. Which matters because the
 * brief is explicit that the product must not assume miles or kilometres, and
 * because "0.4 km away" reads as a translation in a market that says "quarter
 * of a mile".
 */

describe('formatDistance', () => {
  it('uses metres for a short distance in a metric market', () => {
    expect(formatDistance(420, 'NG')).toBe('420 m');
  });

  it('uses kilometres past a thousand metres', () => {
    expect(formatDistance(2400, 'NG')).toBe('2.4 km');
  });

  it('uses feet for a short distance in the United States', () => {
    expect(formatDistance(120, 'US')).toMatch(/ft$/);
  });

  it('uses miles for a longer distance in the United Kingdom', () => {
    expect(formatDistance(3200, 'GB')).toMatch(/mi$/);
  });

  it('defaults to metric when no market is known', () => {
    // Most of the world, and the unit the internals already use — so an unknown
    // market gets the honest default rather than an American one.
    expect(formatDistance(500, null)).toBe('500 m');
  });

  it('stays coarse, because the input was already rounded', () => {
    // A "412 m" would imply a precision the position behind it never had: the
    // data layer rounds to ten metres before this ever sees the number.
    expect(formatDistance(412, 'FR')).toBe('410 m');
  });

  it('formats numbers in the market’s own locale', () => {
    // German uses a comma as the decimal separator; a hard-coded '.' would be
    // wrong for most of Livd's markets.
    expect(formatDistance(2400, 'DE')).toBe('2,4 km');
  });
});
