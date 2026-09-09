import type { CreatePropertyInput } from '@/server/data/repository';
import { acceptCandidate, spanMeters } from '../precision';
import type { GeocodeCandidate, GeocodePrecision, GeocodeResult, Geocoder } from '../types';

/**
 * OpenStreetMap's Nominatim.
 *
 * The free option, and a reasonable last resort behind a commercial provider.
 * Its building coverage is excellent in Germany, the Netherlands and much of
 * Western Europe, good in the US and UK, and thin in parts of Africa, the Gulf
 * and South Asia — which is precisely the gap the commercial providers exist to
 * close.
 *
 * Its usage policy requires a genuine contact in the User-Agent and permits
 * roughly one request a second, so `LIVD_GEOCODER_CONTACT` is mandatory rather
 * than decorative and the provider refuses to construct without it rather than
 * quietly violating someone else's terms of service.
 */

/**
 * Nominatim's `place_rank`: 30 is a house number or a building, 26 is a street,
 * and everything below that is a suburb, a city or larger.
 */
const BUILDING_PLACE_RANK = 30;
const STREET_PLACE_RANK = 26;

interface NominatimResult {
  lat?: string;
  lon?: string;
  place_rank?: number;
  addresstype?: string;
  /** [south, north, west, east], as strings. */
  boundingbox?: [string, string, string, string];
  address?: Record<string, string | undefined>;
}

function precisionOf(result: NominatimResult): GeocodePrecision {
  const rank = result.place_rank ?? 0;
  if (rank >= BUILDING_PLACE_RANK) return 'building';
  if (rank >= STREET_PLACE_RANK) return 'street';
  return 'area';
}

function localityOf(result: NominatimResult): string | null {
  const address = result.address;
  if (!address) return null;

  return (
    address.city ??
    address.town ??
    address.village ??
    address.municipality ??
    address.city_district ??
    address.suburb ??
    address.county ??
    null
  );
}

export class NominatimGeocoder implements Geocoder {
  readonly name = 'nominatim';

  constructor(private readonly contact: string) {}

  async geocode(input: CreatePropertyInput): Promise<GeocodeResult | null> {
    /*
     * The `street` field takes "housenumber street" and nothing else.
     *
     * Appending the building name to it does not add a hint, it breaks the
     * match outright: "Boxhagener Strasse 40" resolves to a building, and
     * "Boxhagener Strasse 40 Hofgarten" resolves to nothing at all. The
     * building name is only worth sending when there is no street address, and
     * a property must have one or the other.
     *
     * This is why Nominatim does not use `singleLineAddress` while the others
     * do — its structured mode is materially better, and its structured mode
     * has this constraint.
     */
    const street = input.streetAddress?.trim() || input.buildingName?.trim();
    if (!street) return null;

    const params = new URLSearchParams({
      street,
      city: input.locality,
      country: input.countryCode,
      format: 'jsonv2',
      limit: '1',
      addressdetails: '1',
    });

    if (input.adminArea) params.set('state', input.adminArea);
    if (input.postalCode) params.set('postalcode', input.postalCode);

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: {
          // Required by the usage policy, and the reason `contact` is not
          // optional.
          'User-Agent': `Livd property geocoder (${this.contact})`,
          Accept: 'application/json',
        },
        // A cold lookup measured about 2.6 seconds and a warm one about 250ms.
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });

      if (!response.ok) return null;

      const results = (await response.json()) as NominatimResult[];
      const first = results[0];
      if (!first?.lat || !first?.lon) return null;

      const candidate: GeocodeCandidate = {
        latitude: Number.parseFloat(first.lat),
        longitude: Number.parseFloat(first.lon),
        precision: precisionOf(first),
        spanMeters: first.boundingbox
          ? spanMeters({
              south: Number(first.boundingbox[0]),
              north: Number(first.boundingbox[1]),
              west: Number(first.boundingbox[2]),
              east: Number(first.boundingbox[3]),
            })
          : // Nominatim always returns a box. Its absence means a response shape
            // we do not recognise, which is not something to accept a
            // coordinate from.
            Number.POSITIVE_INFINITY,
        locality: localityOf(first),
      };

      return acceptCandidate(candidate, input);
    } catch {
      return null;
    }
  }
}
