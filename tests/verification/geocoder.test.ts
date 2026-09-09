import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getGeocoder, resetGeocoder, MAXIMUM_FEATURE_SPAN_METERS } from '@/server/geo/geocoder';
import { localityMatches, singleLineAddress, spanMeters } from '@/server/geo/precision';
import type { CreatePropertyInput } from '@/server/data/repository';

/**
 * The geocoders, and the gate they all pass through.
 *
 * These matter more than they look. A geocoder that returns a *wrong*
 * coordinate is worse than one that returns none: no coordinate means the
 * verification step is not offered, and a wrong one means it is offered and
 * cannot be passed — a resident standing at their own front door is told they
 * are not there, with no way to tell whether the product is broken or accusing
 * them.
 *
 * The hazard is measured, not hypothetical. Nominatim answers "8 Admiralty Way,
 * Lagos" with the *road*, a feature spanning 1,716 metres, and a point along it
 * can sit most of a kilometre from the building.
 *
 * Google and Mapbox are exercised against fixture payloads in their real
 * response shapes, because testing them live needs paid keys. That is a genuine
 * limitation and it is recorded in the README rather than papered over here.
 */

const LAGOS: CreatePropertyInput = {
  buildingName: 'Marina Court',
  streetAddress: '8 Admiralty Way',
  neighbourhood: 'Lekki Phase 1',
  locality: 'Lagos',
  adminArea: 'Lagos State',
  postalCode: null,
  countryCode: 'NG',
  propertyType: 'apartment',
};

function stubFetch(payload: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(async () => ({ ok, status, json: async () => payload }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetGeocoder();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetGeocoder();
});

/* -------------------------------------------------------------------------
 * Shared helpers
 * ---------------------------------------------------------------------- */

describe('the shared address line', () => {
  it('leads with the building name', () => {
    // In Lagos, Dubai and Mumbai a named building is very often the thing the
    // map data actually holds, while the house number is not.
    expect(singleLineAddress(LAGOS)).toBe(
      'Marina Court, 8 Admiralty Way, Lekki Phase 1, Lagos, Lagos State',
    );
  });

  it('drops the parts a country does not use', () => {
    expect(singleLineAddress({ ...LAGOS, buildingName: null, neighbourhood: null })).toBe(
      '8 Admiralty Way, Lagos, Lagos State',
    );
  });
});

describe('locality matching', () => {
  it('accepts an exact match', () => {
    expect(localityMatches('Lagos', 'Lagos')).toBe(true);
  });

  it('ignores accents, because both spellings are in everyday use', () => {
    expect(localityMatches('Zurich', 'Zürich')).toBe(true);
    expect(localityMatches('München', 'Munchen')).toBe(true);
  });

  it('accepts a containing or contained name', () => {
    expect(localityMatches('Lagos State', 'Lagos')).toBe(true);
    expect(localityMatches('Dubai', 'Dubai Marina')).toBe(true);
  });

  it('refuses a different town', () => {
    expect(localityMatches('Hamburg', 'Berlin')).toBe(false);
  });

  it('accepts a result that names no locality rather than second-guessing', () => {
    expect(localityMatches(null, 'Lagos')).toBe(true);
  });
});

describe('feature size', () => {
  it('measures the long side', () => {
    // Admiralty Way's real extent.
    const span = spanMeters({ south: 6.44, north: 6.4553, west: 3.463, east: 3.464 });
    expect(span).toBeGreaterThan(1500);
    expect(span).toBeLessThan(1800);
  });

  it('treats a building-sized box as small', () => {
    expect(
      spanMeters({ south: 52.5113, north: 52.5115, west: 13.4623, east: 13.4625 }),
    ).toBeLessThan(MAXIMUM_FEATURE_SPAN_METERS);
  });
});

/* -------------------------------------------------------------------------
 * Google
 * ---------------------------------------------------------------------- */

function googleResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'OK',
    results: [
      {
        formatted_address: '8 Admiralty Way, Lekki Phase 1, Lagos, Nigeria',
        types: ['street_address'],
        geometry: {
          location: { lat: 6.4423, lng: 3.4712 },
          location_type: 'ROOFTOP',
        },
        address_components: [
          { long_name: 'Lagos', short_name: 'Lagos', types: ['locality', 'political'] },
        ],
        ...overrides,
      },
    ],
  };
}

describe('Google', () => {
  beforeEach(() => {
    vi.stubEnv('LIVD_GEOCODER', 'google');
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key');
    resetGeocoder();
  });

  it('accepts a rooftop match — the Lagos case OpenStreetMap could not answer', async () => {
    stubFetch(googleResult());
    expect(await getGeocoder().geocode(LAGOS)).toEqual({
      latitude: 6.4423,
      longitude: 3.4712,
    });
  });

  it('accepts an interpolated match', async () => {
    // Estimated between two known house numbers. Within tens of metres in a
    // dense city, which the verification budget absorbs — and refusing it would
    // lose most of the coverage this provider was added for.
    stubFetch(
      googleResult({
        geometry: { location: { lat: 6.4423, lng: 3.4712 }, location_type: 'RANGE_INTERPOLATED' },
      }),
    );
    expect(await getGeocoder().geocode(LAGOS)).not.toBeNull();
  });

  it('refuses the centre of a road', async () => {
    stubFetch(
      googleResult({
        types: ['route'],
        geometry: { location: { lat: 6.4423, lng: 3.4712 }, location_type: 'GEOMETRIC_CENTER' },
      }),
    );
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('refuses a road even when Google places it precisely', async () => {
    // The two fields can disagree. A road is a road however exactly its centre
    // was computed.
    stubFetch(
      googleResult({
        types: ['route'],
        geometry: { location: { lat: 6.4423, lng: 3.4712 }, location_type: 'ROOFTOP' },
      }),
    );
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('refuses an approximate match', async () => {
    stubFetch(
      googleResult({
        types: ['locality'],
        geometry: { location: { lat: 6.5244, lng: 3.3792 }, location_type: 'APPROXIMATE' },
      }),
    );
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('treats an unrecognised location type as the weakest thing it could be', async () => {
    // A new Google enum value must not widen the gate by surprise.
    stubFetch(
      googleResult({
        geometry: { location: { lat: 6.4423, lng: 3.4712 }, location_type: 'SOMETHING_NEW' },
      }),
    );
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('refuses a partial match that is not a building', async () => {
    stubFetch(
      googleResult({
        partial_match: true,
        geometry: { location: { lat: 6.4423, lng: 3.4712 }, location_type: 'RANGE_INTERPOLATED' },
      }),
    );
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('refuses a precise match in the wrong city', async () => {
    stubFetch(
      googleResult({
        address_components: [{ long_name: 'Abuja', types: ['locality', 'political'] }],
      }),
    );
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('refuses a feature too large to be a building', async () => {
    stubFetch(
      googleResult({
        geometry: {
          location: { lat: 6.4423, lng: 3.4712 },
          location_type: 'ROOFTOP',
          bounds: {
            northeast: { lat: 6.4553, lng: 3.464 },
            southwest: { lat: 6.44, lng: 3.463 },
          },
        },
      }),
    );
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('returns null for ZERO_RESULTS without complaining', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({ status: 'ZERO_RESULTS', results: [] });

    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
    // An address that does not exist is an ordinary answer, not a fault.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('says so when the key is refused, because that looks identical otherwise', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({ status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.' });

    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('REQUEST_DENIED'));
    warn.mockRestore();
  });

  it('constrains the search to the right country', async () => {
    const fetchMock = stubFetch(googleResult());
    await getGeocoder().geocode(LAGOS);

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(new URL(url).searchParams.get('components')).toBe('country:NG');
  });

  it('sends nothing about the contributor', async () => {
    const fetchMock = stubFetch(googleResult());
    await getGeocoder().geocode(LAGOS);

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const params = [...new URL(url).searchParams.keys()];
    expect(params.sort()).toEqual(['address', 'components', 'key']);
  });
});

/* -------------------------------------------------------------------------
 * Mapbox
 * ---------------------------------------------------------------------- */

function mapboxResult(overrides: Record<string, unknown> = {}) {
  return {
    features: [
      {
        place_type: ['address'],
        relevance: 1,
        properties: { accuracy: 'rooftop' },
        center: [3.4712, 6.4423],
        context: [
          { id: 'place.123', text: 'Lagos' },
          { id: 'country.456', text: 'Nigeria' },
        ],
        ...overrides,
      },
    ],
  };
}

describe('Mapbox', () => {
  beforeEach(() => {
    vi.stubEnv('LIVD_GEOCODER', 'mapbox');
    vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'test-token');
    resetGeocoder();
  });

  it('accepts a rooftop address', async () => {
    stubFetch(mapboxResult());
    // Mapbox orders its coordinates longitude-first; getting that backwards
    // would put every property in the wrong hemisphere.
    expect(await getGeocoder().geocode(LAGOS)).toEqual({
      latitude: 6.4423,
      longitude: 3.4712,
    });
  });

  it('accepts a point of interest, which is how named buildings arrive', async () => {
    stubFetch(mapboxResult({ place_type: ['poi'], properties: {} }));
    expect(await getGeocoder().geocode(LAGOS)).not.toBeNull();
  });

  it('refuses a street', async () => {
    stubFetch(mapboxResult({ place_type: ['street'], properties: { accuracy: 'street' } }));
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('takes the weaker of the two precision signals', async () => {
    // `address` looks precise; `accuracy: street` says Mapbox could not find
    // the house number and snapped to the road. The weaker one decides.
    stubFetch(mapboxResult({ place_type: ['address'], properties: { accuracy: 'street' } }));
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('accepts an interpolated address', async () => {
    stubFetch(mapboxResult({ properties: { accuracy: 'interpolated' } }));
    expect(await getGeocoder().geocode(LAGOS)).not.toBeNull();
  });

  it('refuses a low-relevance guess', async () => {
    stubFetch(mapboxResult({ relevance: 0.4 }));
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('refuses a match in the wrong city', async () => {
    stubFetch(mapboxResult({ context: [{ id: 'place.1', text: 'Abuja' }] }));
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('says so when the token is rejected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({ message: 'Not Authorized' }, false, 401);

    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('access token'));
    warn.mockRestore();
  });
});

/* -------------------------------------------------------------------------
 * Nominatim
 * ---------------------------------------------------------------------- */

function nominatimResult(overrides: Record<string, unknown> = {}) {
  return [
    {
      lat: '52.5114',
      lon: '13.4624',
      place_rank: 30,
      addresstype: 'building',
      boundingbox: ['52.5113', '52.5115', '13.4623', '13.4625'],
      address: { city: 'Berlin' },
      ...overrides,
    },
  ];
}

const BERLIN: CreatePropertyInput = {
  ...LAGOS,
  buildingName: null,
  streetAddress: 'Boxhagener Strasse 40',
  neighbourhood: null,
  locality: 'Berlin',
  adminArea: null,
  countryCode: 'DE',
};

describe('Nominatim', () => {
  beforeEach(() => {
    vi.stubEnv('LIVD_GEOCODER', 'nominatim');
    vi.stubEnv('LIVD_GEOCODER_CONTACT', 'https://example.test/livd');
    resetGeocoder();
  });

  it('accepts a building', async () => {
    stubFetch(nominatimResult());
    expect(await getGeocoder().geocode(BERLIN)).toEqual({
      latitude: 52.5114,
      longitude: 13.4624,
    });
  });

  it('refuses a road', async () => {
    // place_rank 26 is a street. The Admiralty Way case.
    stubFetch(nominatimResult({ place_rank: 26, addresstype: 'road' }));
    expect(await getGeocoder().geocode(BERLIN)).toBeNull();
  });

  it('refuses a feature too large to be a building, whatever its rank', async () => {
    stubFetch(
      nominatimResult({ place_rank: 30, boundingbox: ['6.4400', '6.4553', '3.4630', '3.4640'] }),
    );
    expect(await getGeocoder().geocode(BERLIN)).toBeNull();
  });

  it('sends the street address alone, never with the building name appended', async () => {
    // Not a style preference. "Boxhagener Strasse 40" resolves to a building
    // and "Boxhagener Strasse 40 Hofgarten" resolves to nothing at all.
    const fetchMock = stubFetch(nominatimResult());
    await getGeocoder().geocode({ ...BERLIN, buildingName: 'Hofgarten' });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(new URL(url).searchParams.get('street')).toBe('Boxhagener Strasse 40');
  });

  it('identifies itself, because the usage policy requires it', async () => {
    const fetchMock = stubFetch(nominatimResult());
    await getGeocoder().geocode(BERLIN);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('Livd property geocoder (https://example.test/livd)');
  });
});

/* -------------------------------------------------------------------------
 * Configuration and the chain
 * ---------------------------------------------------------------------- */

describe('configuration', () => {
  it('does nothing at all by default', async () => {
    vi.stubEnv('LIVD_GEOCODER', '');
    resetGeocoder();
    const fetchMock = stubFetch(googleResult());

    const geocoder = getGeocoder();

    expect(geocoder.name).toBe('none');
    expect(await geocoder.geocode(LAGOS)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips a provider whose key is missing, and says which', async () => {
    vi.stubEnv('LIVD_GEOCODER', 'google');
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    resetGeocoder();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(getGeocoder().name).toBe('none');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GOOGLE_MAPS_API_KEY'));
    warn.mockRestore();
  });

  it('refuses to use Nominatim without a contact rather than breaching its policy', async () => {
    vi.stubEnv('LIVD_GEOCODER', 'nominatim');
    vi.stubEnv('LIVD_GEOCODER_CONTACT', '');
    resetGeocoder();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(getGeocoder().name).toBe('none');
    warn.mockRestore();
  });

  it('warns about an unknown provider instead of failing silently', () => {
    vi.stubEnv('LIVD_GEOCODER', 'gogle');
    resetGeocoder();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(getGeocoder().name).toBe('none');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('gogle'));
    warn.mockRestore();
  });
});

describe('the fallback chain', () => {
  beforeEach(() => {
    vi.stubEnv('LIVD_GEOCODER', 'google,nominatim');
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key');
    vi.stubEnv('LIVD_GEOCODER_CONTACT', 'https://example.test/livd');
    resetGeocoder();
  });

  it('names both providers, in order', () => {
    expect(getGeocoder().name).toBe('google → nominatim');
  });

  it('stops at the first confident answer', async () => {
    const fetchMock = stubFetch(googleResult());

    expect(await getGeocoder().geocode(LAGOS)).toEqual({ latitude: 6.4423, longitude: 3.4712 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls through to the next provider when the first cannot answer', async () => {
    // The point of the chain: a commercial provider fails on quota, billing and
    // outage; Nominatim fails on coverage. Chaining them means a lapsed card
    // degrades coverage rather than removing geocoding everywhere.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'ZERO_RESULTS', results: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => nominatimResult() });
    vi.stubGlobal('fetch', fetchMock);

    expect(await getGeocoder().geocode(BERLIN)).toEqual({
      latitude: 52.5114,
      longitude: 13.4624,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls through when the first provider refuses on precision', async () => {
    // A road from Google is not an error and must not stop the chain — the next
    // provider may hold better data for that address.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          googleResult({
            types: ['route'],
            geometry: { location: { lat: 1, lng: 1 }, location_type: 'GEOMETRIC_CENTER' },
          }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => nominatimResult() });
    vi.stubGlobal('fetch', fetchMock);

    expect(await getGeocoder().geocode(BERLIN)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null, never throws, when every provider fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );
    // A contributor is adding a property. A total geocoding outage must cost
    // them a coordinate, never their contribution.
    await expect(getGeocoder().geocode(LAGOS)).resolves.toBeNull();
  });
});

describe('bad coordinates are refused whatever the provider says', () => {
  beforeEach(() => {
    vi.stubEnv('LIVD_GEOCODER', 'google');
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key');
    resetGeocoder();
  });

  it('refuses null island, which is a coerced null far more often than a place', async () => {
    stubFetch(googleResult({ geometry: { location: { lat: 0, lng: 0 }, location_type: 'ROOFTOP' } }));
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('refuses an out-of-range coordinate', async () => {
    stubFetch(
      googleResult({ geometry: { location: { lat: 91.5, lng: 3.4 }, location_type: 'ROOFTOP' } }),
    );
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });

  it('refuses a missing coordinate', async () => {
    stubFetch(googleResult({ geometry: { location: {}, location_type: 'ROOFTOP' } }));
    expect(await getGeocoder().geocode(LAGOS)).toBeNull();
  });
});
