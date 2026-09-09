import type { CreatePropertyInput } from '@/server/data/repository';
import { acceptCandidate, singleLineAddress, spanMeters } from '../precision';
import type { GeocodeCandidate, GeocodePrecision, GeocodeResult, Geocoder } from '../types';

/**
 * Mapbox's Geocoding API.
 *
 * The middle option, and it is here for a practical reason rather than a
 * technical one: its free tier does not ask for a card, so a founder can turn
 * better coverage on in five minutes without a billing relationship. Coverage
 * sits between OpenStreetMap and Google — clearly better than Nominatim in the
 * Gulf and South Asia, less complete than Google in Nigeria.
 *
 * Same contract as every other provider: an address goes out, a coordinate or
 * nothing comes back, and nothing about the contributor is sent.
 */

/**
 * Mapbox reports precision twice and the two disagree often enough to matter.
 *
 * `place_type` says what kind of thing was found; `properties.accuracy` says
 * how exactly it was placed. A result is only as good as the weaker of them,
 * which is how `address` + `accuracy: street` gets refused — that combination
 * is a house number Mapbox could not actually find, snapped to the road.
 */
const ACCURACY_PRECISION: Record<string, GeocodePrecision> = {
  rooftop: 'building',
  parcel: 'building',
  point: 'building',
  interpolated: 'interpolated',
  approximate: 'street',
  intersection: 'street',
  street: 'street',
};

const PLACE_TYPE_PRECISION: Record<string, GeocodePrecision> = {
  address: 'building',
  poi: 'building',
  street: 'street',
  neighborhood: 'area',
  locality: 'area',
  place: 'area',
  district: 'area',
  region: 'area',
  country: 'area',
  postcode: 'area',
};

/** Ranked weakest-last, so "the weaker of the two" is a lookup rather than a branch. */
const PRECISION_ORDER: GeocodePrecision[] = ['building', 'interpolated', 'street', 'area'];

function weaker(a: GeocodePrecision, b: GeocodePrecision): GeocodePrecision {
  return PRECISION_ORDER.indexOf(a) >= PRECISION_ORDER.indexOf(b) ? a : b;
}

interface MapboxFeature {
  center?: [number, number];
  place_type?: string[];
  relevance?: number;
  /** [west, south, east, north]. Present on areas, usually absent on addresses. */
  bbox?: [number, number, number, number];
  properties?: { accuracy?: string };
  context?: Array<{ id?: string; text?: string }>;
}

interface MapboxResponse {
  features?: MapboxFeature[];
  message?: string;
}

/**
 * Mapbox nests the containing places in `context`, keyed by a prefixed id.
 * The locality is whichever of `place` or `locality` is present.
 */
function localityOf(feature: MapboxFeature): string | null {
  const context = feature.context ?? [];

  for (const prefix of ['place', 'locality', 'district']) {
    const hit = context.find((c) => c.id?.startsWith(`${prefix}.`));
    if (hit?.text) return hit.text;
  }

  return null;
}

function precisionOf(feature: MapboxFeature): GeocodePrecision {
  const placeType = feature.place_type?.[0] ?? '';
  // An unrecognised label is treated as the weakest thing it could be, so a new
  // Mapbox value cannot widen this gate by surprise.
  const fromPlaceType = PLACE_TYPE_PRECISION[placeType] ?? 'area';

  const accuracy = feature.properties?.accuracy;
  if (!accuracy) return fromPlaceType;

  return weaker(fromPlaceType, ACCURACY_PRECISION[accuracy] ?? 'area');
}

export class MapboxGeocoder implements Geocoder {
  readonly name = 'mapbox';

  constructor(private readonly token: string) {}

  async geocode(input: CreatePropertyInput): Promise<GeocodeResult | null> {
    const address = singleLineAddress(input);
    if (!address) return null;

    const params = new URLSearchParams({
      access_token: this.token,
      country: input.countryCode.toLowerCase(),
      types: 'address,poi',
      limit: '1',
      // Not a map view. Nothing here is being displayed to anyone, and saying
      // so is what keeps the request within the terms for a permanent store.
      autocomplete: 'false',
    });

    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          address,
        )}.json?${params}`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        },
      );

      if (!response.ok) {
        // A bad token and an unroutable address look identical from here
        // otherwise, and the first is a configuration problem worth surfacing.
        if (response.status === 401 || response.status === 403) {
          console.warn(
            '[livd] Mapbox geocoding rejected the access token. New properties ' +
              'will have no coordinates until it is corrected.',
          );
        }
        return null;
      }

      const body = (await response.json()) as MapboxResponse;
      const feature = body.features?.[0];
      if (!feature?.center) return null;

      const [longitude, latitude] = feature.center;
      if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;

      // Mapbox scores how well the query matched. Below this it is guessing,
      // and a confident-looking coordinate from a guess is the failure mode
      // this whole layer exists to avoid.
      if (typeof feature.relevance === 'number' && feature.relevance < 0.8) return null;

      const candidate: GeocodeCandidate = {
        latitude,
        longitude,
        precision: precisionOf(feature),
        spanMeters: feature.bbox
          ? spanMeters({
              west: feature.bbox[0],
              south: feature.bbox[1],
              east: feature.bbox[2],
              north: feature.bbox[3],
            })
          : null,
        locality: localityOf(feature),
      };

      return acceptCandidate(candidate, input);
    } catch {
      return null;
    }
  }
}
