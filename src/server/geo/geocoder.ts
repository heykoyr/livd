import 'server-only';

import type { CreatePropertyInput } from '@/server/data/repository';
import { GoogleGeocoder } from './providers/google';
import { MapboxGeocoder } from './providers/mapbox';
import { NominatimGeocoder } from './providers/nominatim';
import type { GeocodeResult, Geocoder } from './types';

export type { GeocodeResult, Geocoder } from './types';
export { MAXIMUM_FEATURE_SPAN_METERS, ACCEPTABLE_PRECISION } from './precision';

/**
 * Turning an address into a coordinate.
 *
 * This exists because of a gap the verification work turned up:
 * `createProperty` stored `coordinates: null`, so only the seeded demonstration
 * properties ever had a position, and location verification would have worked
 * on demo data and on nothing a real contributor added.
 *
 * Four constraints shape the whole directory, and the third is the one that
 * took the work:
 *
 *   1. It must be optional. A fresh clone runs with no keys and no outbound
 *      network, which is the point of the local adapter, so the default
 *      resolves nothing and says so.
 *
 *   2. It must never block a contribution. Somebody adding a property is doing
 *      Livd a favour. A slow, rate-limited, broken or simply wrong geocoder
 *      costs that property a coordinate, never the contribution.
 *
 *   3. IT MUST REFUSE A COORDINATE IT IS NOT SURE OF. A wrong coordinate is
 *      materially worse than none: without one the wizard does not offer the
 *      verification step, and with a wrong one it offers a step the resident
 *      cannot pass — they are told they are not standing where they plainly
 *      are. The shared gate in `precision.ts` is where that is enforced, and
 *      every provider goes through it.
 *
 *   4. It must not leak the contributor. The request carries an address, which
 *      is public information about a building. It carries no user id, no
 *      session and nothing that ties the lookup to the person making it.
 *
 * Why more than one provider: coverage is the entire point and it is not
 * uniform. Measured against real addresses, OpenStreetMap resolves Berlin,
 * Austin and London to buildings, returns only a road for Lagos and Cape Town,
 * and finds nothing for Dubai. Livd is a global product and cannot have a trust
 * feature that works in Europe and not in Nigeria.
 */

/* -------------------------------------------------------------------------
 * The chain
 * ---------------------------------------------------------------------- */

/**
 * Tries each provider in turn and takes the first confident answer.
 *
 * The order is the configuration's, not this file's opinion — but the useful
 * arrangement is a commercial provider followed by Nominatim, because the two
 * fail differently. A commercial provider fails on quota, billing and outage;
 * Nominatim fails on coverage. Chaining them means a lapsed card degrades
 * coverage in the Gulf rather than removing geocoding everywhere.
 *
 * A provider that refuses on precision is not an error and does not stop the
 * chain: the next one may hold better data for that address, which is exactly
 * the Lagos case.
 */
class GeocoderChain implements Geocoder {
  readonly name: string;

  constructor(private readonly providers: Geocoder[]) {
    this.name = providers.map((p) => p.name).join(' → ');
  }

  async geocode(input: CreatePropertyInput): Promise<GeocodeResult | null> {
    for (const provider of this.providers) {
      const result = await provider.geocode(input);
      if (result) return result;
    }
    return null;
  }
}

/**
 * The default. Resolves nothing, and is not a failure state.
 *
 * A deployment with no geocoder has properties without coordinates, which means
 * those properties do not offer the verification step. Everything else about
 * Livd works exactly as before.
 */
class NoGeocoder implements Geocoder {
  readonly name = 'none';

  async geocode(): Promise<GeocodeResult | null> {
    return null;
  }
}

/* -------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------- */

let cached: Geocoder | null = null;

/**
 * Builds one provider, or explains in the log why it could not.
 *
 * A misconfigured provider is skipped rather than fatal — a typo in one key
 * must not take out a chain whose other links are fine — but it is never
 * skipped silently. A geocoder that is on in the environment and off in fact is
 * the hardest kind of thing to notice, because the symptom is properties
 * quietly not offering verification.
 */
function build(name: string): Geocoder | null {
  switch (name) {
    case 'google': {
      const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
      if (!key) {
        console.warn(
          '[livd] LIVD_GEOCODER lists "google" but GOOGLE_MAPS_API_KEY is not ' +
            'set. Skipping it. See .env.example.',
        );
        return null;
      }
      return new GoogleGeocoder(key);
    }

    case 'mapbox': {
      const token = process.env.MAPBOX_ACCESS_TOKEN?.trim();
      if (!token) {
        console.warn(
          '[livd] LIVD_GEOCODER lists "mapbox" but MAPBOX_ACCESS_TOKEN is not ' +
            'set. Skipping it. See .env.example.',
        );
        return null;
      }
      return new MapboxGeocoder(token);
    }

    case 'nominatim': {
      const contact = process.env.LIVD_GEOCODER_CONTACT?.trim();
      if (!contact) {
        console.warn(
          '[livd] LIVD_GEOCODER lists "nominatim" but LIVD_GEOCODER_CONTACT is ' +
            "not set. Nominatim's usage policy requires an identifying contact " +
            'in the User-Agent, so it is skipped rather than used in breach of ' +
            'it. See .env.example.',
        );
        return null;
      }
      return new NominatimGeocoder(contact);
    }

    case '':
      return null;

    default:
      console.warn(
        `[livd] LIVD_GEOCODER lists unknown provider "${name}". Known providers ` +
          'are google, mapbox and nominatim.',
      );
      return null;
  }
}

/**
 * The configured geocoder.
 *
 * `LIVD_GEOCODER` is a comma-separated list tried in order — for example
 * `google,nominatim`. Unset, or naming nothing usable, gives the no-op.
 */
export function getGeocoder(): Geocoder {
  if (cached) return cached;

  const names = (process.env.LIVD_GEOCODER ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  const providers = names
    .map(build)
    .filter((provider): provider is Geocoder => provider !== null);

  cached = providers.length > 0 ? new GeocoderChain(providers) : new NoGeocoder();
  return cached;
}

/** Test helper — forces the next `getGeocoder` call to re-read the environment. */
export function resetGeocoder(): void {
  cached = null;
}
