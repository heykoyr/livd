import type { CreatePropertyInput } from '@/server/data/repository';
import { acceptCandidate, singleLineAddress, spanMeters } from '../precision';
import type { GeocodeCandidate, GeocodePrecision, GeocodeResult, Geocoder } from '../types';

/**
 * Google's Geocoding API.
 *
 * Here because OpenStreetMap's building coverage runs out exactly where Livd
 * most needs it. Measured against real addresses, Nominatim resolves Berlin,
 * Austin and London to buildings and returns only a road for Lagos and Cape
 * Town, and nothing at all for Dubai. Google holds building and
 * establishment-level data in all of those.
 *
 * It costs money per request, which is the trade. Property creation is already
 * rate-limited to five an hour per contributor and `findDuplicateProperty`
 * stops the same address being added twice, so the request volume is bounded by
 * how fast people add genuinely new buildings — a few thousand a month at most,
 * which is single-digit dollars.
 *
 * Note what is not sent: no user id, no session, no IP Livd controls. The
 * request carries an address, which is public information about a building.
 */

/**
 * Google's `location_type`, translated.
 *
 *   ROOFTOP             the building itself.
 *   RANGE_INTERPOLATED  estimated between two known house numbers on the
 *                       street. Accepted — in a dense city it lands within a
 *                       few tens of metres, which the verification budget
 *                       absorbs, and refusing it would lose most of Lagos.
 *   GEOMETRIC_CENTER    the middle of a road or polygon. This is the Admiralty
 *                       Way case and it is refused.
 *   APPROXIMATE         a district or a city.
 */
const LOCATION_TYPE_PRECISION: Record<string, GeocodePrecision> = {
  ROOFTOP: 'building',
  RANGE_INTERPOLATED: 'interpolated',
  GEOMETRIC_CENTER: 'street',
  APPROXIMATE: 'area',
};

/**
 * Result types that describe a *place* rather than a *road*.
 *
 * Checked alongside `location_type` because the two can disagree: a POI can be
 * returned as ROOFTOP with a type of `route`, and a named building — which is
 * exactly what Livd holds for much of Lagos and Dubai — comes back as
 * `establishment` or `premise` rather than `street_address`.
 */
const PLACE_TYPES = new Set([
  'street_address',
  'premise',
  'subpremise',
  'establishment',
  'point_of_interest',
  'building',
]);

/** Types that mean "a road", however precisely they were located. */
const ROAD_TYPES = new Set(['route', 'intersection']);

interface GoogleResult {
  formatted_address?: string;
  partial_match?: boolean;
  types?: string[];
  geometry?: {
    location?: { lat?: number; lng?: number };
    location_type?: string;
    bounds?: {
      northeast?: { lat?: number; lng?: number };
      southwest?: { lat?: number; lng?: number };
    };
    viewport?: {
      northeast?: { lat?: number; lng?: number };
      southwest?: { lat?: number; lng?: number };
    };
  };
  address_components?: Array<{
    long_name?: string;
    short_name?: string;
    types?: string[];
  }>;
}

interface GoogleResponse {
  status?: string;
  results?: GoogleResult[];
  error_message?: string;
}

/** The locality Google says the result is in, under whichever key it used. */
function localityOf(result: GoogleResult): string | null {
  const components = result.address_components ?? [];

  for (const wanted of ['locality', 'postal_town', 'administrative_area_level_2']) {
    const hit = components.find((c) => c.types?.includes(wanted));
    if (hit?.long_name) return hit.long_name;
  }

  return null;
}

function precisionOf(result: GoogleResult): GeocodePrecision {
  const types = result.types ?? [];

  // A road is a road however precisely its centre was computed.
  if (types.some((t) => ROAD_TYPES.has(t)) && !types.some((t) => PLACE_TYPES.has(t))) {
    return 'street';
  }

  const fromLocationType = LOCATION_TYPE_PRECISION[result.geometry?.location_type ?? ''];
  if (fromLocationType) return fromLocationType;

  // An unrecognised label is treated as the weakest thing it could be. A new
  // Google enum value must not be able to widen this gate by surprise.
  return 'area';
}

export class GoogleGeocoder implements Geocoder {
  readonly name = 'google';

  constructor(private readonly apiKey: string) {}

  async geocode(input: CreatePropertyInput): Promise<GeocodeResult | null> {
    const address = singleLineAddress(input);
    if (!address) return null;

    const params = new URLSearchParams({
      address,
      key: this.apiKey,
      // Biases results toward the right country without hard-excluding a
      // correct answer whose administrative data disagrees with ours.
      components: `country:${input.countryCode.toUpperCase()}`,
    });

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
        {
          headers: { Accept: 'application/json' },
          // A contributor is waiting on a redirect.
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        },
      );

      if (!response.ok) return null;

      const body = (await response.json()) as GoogleResponse;

      // ZERO_RESULTS is an ordinary answer. The rest are worth a log line,
      // because a wrong key or an exhausted quota is a configuration problem
      // that otherwise looks exactly like "this address does not exist".
      if (body.status !== 'OK') {
        if (body.status && body.status !== 'ZERO_RESULTS') {
          console.warn(
            `[livd] Google geocoding returned ${body.status}${
              body.error_message ? `: ${body.error_message}` : ''
            }`,
          );
        }
        return null;
      }

      const result = body.results?.[0];
      if (!result) return null;

      const lat = result.geometry?.location?.lat;
      const lng = result.geometry?.location?.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number') return null;

      // `bounds` is the feature's real extent; `viewport` is a display hint and
      // is padded, so it is only used when there is nothing better and is
      // measured against the same limit.
      const box = result.geometry?.bounds ?? result.geometry?.viewport;
      const candidate: GeocodeCandidate = {
        latitude: lat,
        longitude: lng,
        precision: precisionOf(result),
        spanMeters:
          box?.northeast?.lat !== undefined &&
          box.southwest?.lat !== undefined &&
          box.northeast.lng !== undefined &&
          box.southwest.lng !== undefined
            ? spanMeters({
                north: box.northeast.lat,
                south: box.southwest.lat,
                east: box.northeast.lng,
                west: box.southwest.lng,
              })
            : null,
        locality: localityOf(result),
      };

      // `partial_match` means Google could not match the whole address and
      // guessed at part of it. Tolerable when it still landed on a building;
      // not tolerable as the basis for anything softer.
      if (result.partial_match && candidate.precision !== 'building') return null;

      return acceptCandidate(candidate, input);
    } catch {
      // Timeout, network failure, malformed response. All mean the same thing:
      // this property has no coordinate yet, and none of them is worth failing
      // a contribution over.
      return null;
    }
  }
}
