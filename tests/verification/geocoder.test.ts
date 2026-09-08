import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GEOCODER_PRECISION, getGeocoder, resetGeocoder } from '@/server/geo/geocoder';
import type { CreatePropertyInput } from '@/server/data/repository';

/**
 * The geocoder's precision gates.
 *
 * These matter more than they look. A geocoder that returns a *wrong*
 * coordinate is worse than one that returns none: no coordinate means the
 * verification step is not offered, and a wrong one means the step is offered
 * and cannot be passed — a resident standing at their own front door is told
 * they are not there.
 *
 * The specific hazard is real and measured. Nominatim answers "8 Admiralty
 * Way, Lagos" with the *road*, a feature whose bounding box spans 1,716
 * metres, and hands back a point somewhere along it. That point can sit most of
 * a kilometre from the building, far outside the verification budget.
 *
 * `fetch` is stubbed so these run offline and deterministically. The same cases
 * were also exercised against live Nominatim before this file was written.
 */

const ADDRESS: CreatePropertyInput = {
  buildingName: null,
  streetAddress: '40 Boxhagener Strasse',
  neighbourhood: null,
  locality: 'Berlin',
  adminArea: null,
  postalCode: null,
  countryCode: 'DE',
  propertyType: 'apartment',
};

/** One Nominatim result, with the fields the gates read. */
function result(overrides: Record<string, unknown> = {}) {
  return {
    lat: '52.5114',
    lon: '13.4624',
    place_rank: 30,
    addresstype: 'building',
    // ~20m across: a building.
    boundingbox: ['52.5113', '52.5115', '13.4623', '13.4625'],
    address: { city: 'Berlin', country_code: 'de' },
    ...overrides,
  };
}

function stubFetch(payload: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    json: async () => payload,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetGeocoder();
  vi.stubEnv('LIVD_GEOCODER', 'nominatim');
  vi.stubEnv('LIVD_GEOCODER_CONTACT', 'https://example.test/livd');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetGeocoder();
});

describe('configuration', () => {
  it('does nothing at all by default', async () => {
    vi.stubEnv('LIVD_GEOCODER', '');
    resetGeocoder();
    const fetchMock = stubFetch([result()]);

    const geocoder = getGeocoder();

    expect(geocoder.name).toBe('none');
    expect(await geocoder.geocode(ADDRESS)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to run without a contact rather than breaching the usage policy', async () => {
    vi.stubEnv('LIVD_GEOCODER_CONTACT', '');
    resetGeocoder();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = stubFetch([result()]);

    const geocoder = getGeocoder();

    expect(geocoder.name).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
    // Silence would be worse than the misconfiguration: a geocoder that is on
    // in the environment and off in fact is the hardest kind of thing to spot.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('identifies itself, because the policy requires it', async () => {
    const fetchMock = stubFetch([result()]);
    await getGeocoder().geocode(ADDRESS);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('Livd');
    expect(headers['User-Agent']).toContain('https://example.test/livd');
  });
});

describe('what it sends', () => {
  it('sends the street address alone, never with the building name appended', async () => {
    // Not a style preference. "Boxhagener Strasse 40" resolves to a building
    // and "Boxhagener Strasse 40 Hofgarten" resolves to nothing at all — the
    // `street` field takes "housenumber street" and breaks on anything else.
    const fetchMock = stubFetch([result()]);

    await getGeocoder().geocode({ ...ADDRESS, buildingName: 'Hofgarten' });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const street = new URL(url).searchParams.get('street');
    expect(street).toBe('40 Boxhagener Strasse');
    expect(street).not.toContain('Hofgarten');
  });

  it('falls back to the building name only when there is no street address', async () => {
    const fetchMock = stubFetch([result()]);

    await getGeocoder().geocode({
      ...ADDRESS,
      streetAddress: null,
      buildingName: 'Hofgarten',
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(new URL(url).searchParams.get('street')).toBe('Hofgarten');
  });

  it('makes no request at all when there is nothing to resolve', async () => {
    const fetchMock = stubFetch([result()]);

    const out = await getGeocoder().geocode({
      ...ADDRESS,
      streetAddress: null,
      buildingName: null,
    });

    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('carries no user, session or device information', async () => {
    const fetchMock = stubFetch([result()]);
    await getGeocoder().geocode(ADDRESS);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    // An address is public information about a building. Who is adding it is
    // not, and nothing here should be able to carry that upstream.
    //
    // Asserted over the query parameters and the header *values* rather than
    // the whole request string: `User-Agent` is a header name the usage policy
    // requires, and matching on it would be matching the wrong thing.
    const params = [...new URL(url).searchParams.keys()].map((k) => k.toLowerCase());
    expect(params).toEqual(
      expect.arrayContaining(['street', 'city', 'country', 'format']),
    );
    for (const forbidden of ['user', 'session', 'author', 'email', 'token', 'ip']) {
      expect(params).not.toContain(forbidden);
    }

    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).map((h) => h.toLowerCase()).sort()).toEqual([
      'accept',
      'user-agent',
    ]);
    // No cookie is attached, and the identifying value is the deployment's own
    // contact rather than anything about the person making the request.
    expect(headers['User-Agent']).toBe('Livd property geocoder (https://example.test/livd)');
    expect(init.cache).toBe('no-store');
  });
});

describe('the precision gates', () => {
  it('accepts a building-level match', async () => {
    stubFetch([result()]);
    expect(await getGeocoder().geocode(ADDRESS)).toEqual({
      latitude: 52.5114,
      longitude: 13.4624,
    });
  });

  it('refuses a street-level match', async () => {
    // place_rank 26 is a road. This is the Admiralty Way case, and taking it
    // would put the coordinate most of a kilometre from the building.
    stubFetch([result({ place_rank: 26, addresstype: 'road' })]);
    expect(await getGeocoder().geocode(ADDRESS)).toBeNull();
  });

  it('refuses anything coarser still', async () => {
    stubFetch([result({ place_rank: 16, addresstype: 'city' })]);
    expect(await getGeocoder().geocode(ADDRESS)).toBeNull();
  });

  it('refuses a feature too large to be a building, whatever its rank', async () => {
    // The independent gate. A rank is a classification and classifications
    // drift; a bounding box is a measurement.
    stubFetch([
      result({
        place_rank: 30,
        // ~1.7km north to south — the real span of Admiralty Way.
        boundingbox: ['6.4400', '6.4553', '3.4630', '3.4640'],
      }),
    ]);
    expect(await getGeocoder().geocode(ADDRESS)).toBeNull();
  });

  it('refuses a result with no bounding box to measure', async () => {
    stubFetch([result({ boundingbox: undefined })]);
    expect(await getGeocoder().geocode(ADDRESS)).toBeNull();
  });

  it('refuses a precise match in the wrong town', async () => {
    // "Hofgarten, Berlin" resolves to a perfectly precise amenity two and a
    // half kilometres from the one that was meant. Precise and wrong is the
    // failure this whole gate exists against.
    stubFetch([result({ address: { city: 'Hamburg', country_code: 'de' } })]);
    expect(await getGeocoder().geocode(ADDRESS)).toBeNull();
  });

  it('accepts a locality that differs only by accent', async () => {
    stubFetch([result({ address: { city: 'Zurich' } })]);
    expect(await getGeocoder().geocode({ ...ADDRESS, locality: 'Zürich' })).not.toBeNull();
  });

  it('accepts a match reported under a neighbouring administrative key', async () => {
    // Nominatim reports the locality under any of several keys depending on how
    // the area is administered. Being strict here would refuse correct answers.
    stubFetch([result({ address: { town: 'Berlin' } })]);
    expect(await getGeocoder().geocode(ADDRESS)).not.toBeNull();
  });

  it('accepts a result that names no locality rather than second-guessing it', async () => {
    stubFetch([result({ address: {} })]);
    expect(await getGeocoder().geocode(ADDRESS)).not.toBeNull();
  });
});

describe('bad answers', () => {
  it('returns null for an empty result set', async () => {
    stubFetch([]);
    expect(await getGeocoder().geocode(ADDRESS)).toBeNull();
  });

  it('returns null on an HTTP error', async () => {
    stubFetch([result()], false);
    expect(await getGeocoder().geocode(ADDRESS)).toBeNull();
  });

  it('returns null rather than throwing when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );
    // A contributor is adding a property. A geocoder outage must cost them a
    // coordinate, never their contribution.
    await expect(getGeocoder().geocode(ADDRESS)).resolves.toBeNull();
  });

  it('refuses null island, which is a coerced null far more often than a place', async () => {
    stubFetch([result({ lat: '0', lon: '0' })]);
    expect(await getGeocoder().geocode(ADDRESS)).toBeNull();
  });

  it('refuses an out-of-range coordinate', async () => {
    stubFetch([result({ lat: '91.5' })]);
    expect(await getGeocoder().geocode(ADDRESS)).toBeNull();
  });

  it('refuses an unparseable coordinate', async () => {
    stubFetch([result({ lat: 'not-a-number' })]);
    expect(await getGeocoder().geocode(ADDRESS)).toBeNull();
  });
});

describe('the gates are set where the comments say', () => {
  it('requires building-level precision', () => {
    // 30 is Nominatim's house-number/building rank; 26 is a street.
    expect(GEOCODER_PRECISION.minimumPlaceRank).toBe(30);
  });

  it('caps the feature size well below a city block', () => {
    expect(GEOCODER_PRECISION.maximumFeatureSpanMeters).toBeLessThanOrEqual(250);
  });
});
