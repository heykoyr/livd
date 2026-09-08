import 'server-only';

import type { CreatePropertyInput } from '@/server/data/repository';

/**
 * Turning an address into a coordinate.
 *
 * This exists because of a gap the audit turned up rather than because
 * geocoding is interesting: `createProperty` has always stored
 * `coordinates: null`, so only the sixteen seeded demonstration properties
 * have ever had a position. Without something here, location verification
 * would work on the demo data and on nothing a real contributor ever added —
 * which is a feature that appears to work and does not.
 *
 * Three constraints shaped it:
 *
 *   1. It must be optional. A fresh clone has to run with no keys and no
 *      outbound network, which is the whole point of the local adapter, so the
 *      default provider does nothing and says so.
 *
 *   2. It must never block a contribution. Somebody adding a property is doing
 *      Livd a favour. If the geocoder is slow, rate-limited, down or simply
 *      wrong about the address, the property is still created — without a
 *      coordinate, and therefore without the verification step, which the
 *      wizard already handles because a property may legitimately have no
 *      position for many other reasons.
 *
 *   3. It must not leak the contributor. The request carries an address, which
 *      is public information about a building. It carries no user id, no
 *      session, no IP that Livd controls and nothing that ties the lookup to
 *      the person making it.
 */

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

export interface Geocoder {
  readonly name: string;
  /** Returns null for anything it cannot resolve confidently. Never throws. */
  geocode(input: CreatePropertyInput): Promise<GeocodeResult | null>;
}

/**
 * The default. Resolves nothing, and is not a failure state.
 *
 * A deployment with no geocoder configured has properties without coordinates,
 * which means those properties cannot be location-verified and the wizard does
 * not offer the step for them. Everything else about Livd works exactly as
 * before.
 */
class NoGeocoder implements Geocoder {
  readonly name = 'none';

  async geocode(): Promise<GeocodeResult | null> {
    return null;
  }
}

/**
 * OpenStreetMap's Nominatim.
 *
 * Chosen because it needs no key, which means this can be switched on by a
 * founder with one environment variable rather than a billing relationship.
 * The trade is that its usage policy requires a genuine contact address in the
 * User-Agent and permits roughly one request a second — so
 * `LIVD_GEOCODER_CONTACT` is mandatory rather than decorative, and the
 * provider refuses to construct without it rather than quietly violating
 * someone else's terms of service.
 *
 * Called once per property creation, which is already rate-limited to five an
 * hour per contributor, so the policy limit is not close to being a constraint.
 */
class NominatimGeocoder implements Geocoder {
  readonly name = 'nominatim';

  constructor(private readonly contact: string) {}

  async geocode(input: CreatePropertyInput): Promise<GeocodeResult | null> {
    // Structured parameters rather than a single free-text string: Nominatim
    // resolves a decomposed address considerably better, and Livd already
    // holds the address decomposed because that is what makes it international.
    const params = new URLSearchParams({
      street: [input.streetAddress, input.buildingName].filter(Boolean).join(' ').trim(),
      city: input.locality,
      country: input.countryCode,
      format: 'jsonv2',
      limit: '1',
      addressdetails: '0',
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
        // A contributor is waiting on a redirect. Six seconds and then the
        // property is created without a coordinate.
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      });

      if (!response.ok) return null;

      const results = (await response.json()) as Array<{ lat?: string; lon?: string }>;
      const first = results[0];
      if (!first?.lat || !first?.lon) return null;

      const latitude = Number.parseFloat(first.lat);
      const longitude = Number.parseFloat(first.lon);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
      // 0,0 is in the Gulf of Guinea and is a parse failure far more often than
      // it is an address.
      if (latitude === 0 && longitude === 0) return null;

      return { latitude, longitude };
    } catch {
      // Timeout, network failure, rate limit, malformed response — all of them
      // mean the same thing here, which is that this property has no coordinate
      // yet. None of them is worth failing a contribution over.
      return null;
    }
  }
}

let cached: Geocoder | null = null;

/**
 * The configured geocoder.
 *
 * `LIVD_GEOCODER=nominatim` plus `LIVD_GEOCODER_CONTACT=<email or url>` turns
 * it on. Anything else, or a missing contact, gets the no-op — with a warning,
 * because a half-configured geocoder that silently does nothing is worse than
 * one that was never switched on.
 */
export function getGeocoder(): Geocoder {
  if (cached) return cached;

  const provider = process.env.LIVD_GEOCODER?.trim().toLowerCase();

  if (provider === 'nominatim') {
    const contact = process.env.LIVD_GEOCODER_CONTACT?.trim();
    if (!contact) {
      console.warn(
        '[livd] LIVD_GEOCODER=nominatim but LIVD_GEOCODER_CONTACT is not set. ' +
          "Nominatim's usage policy requires an identifying contact in the " +
          'User-Agent, so geocoding is disabled. New properties will have no ' +
          'coordinates and cannot be location-verified. See .env.example.',
      );
      cached = new NoGeocoder();
      return cached;
    }
    cached = new NominatimGeocoder(contact);
    return cached;
  }

  cached = new NoGeocoder();
  return cached;
}

/** Test helper — forces the next `getGeocoder` call to re-read the environment. */
export function resetGeocoder(): void {
  cached = null;
}
