import 'server-only';

import type { CreatePropertyInput } from '@/server/data/repository';

/**
 * Turning an address into a coordinate.
 *
 * This exists because of a gap the verification audit turned up rather than
 * because geocoding is interesting: `createProperty` has always stored
 * `coordinates: null`, so only the sixteen seeded demonstration properties have
 * ever had a position. Without something here, location verification would work
 * on the demo data and on nothing a real contributor ever added — which is a
 * feature that appears to work and does not.
 *
 * Four constraints shaped it, and the third is the one that took the work:
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
 *   3. IT MUST REFUSE A COORDINATE IT IS NOT SURE OF. This is not a nicety.
 *      Nominatim answers "8 Admiralty Way, Lagos" with the *road* — a feature
 *      whose bounding box spans 1,716 metres — and hands back a point somewhere
 *      along it. Stored, that point can sit most of a kilometre from the
 *      building, which is far outside the verification budget, and the visible
 *      symptom is a resident standing at their own front door being told they
 *      are not there. A wrong coordinate is materially worse than no
 *      coordinate: no coordinate means the step is not offered, and a wrong one
 *      means the step is offered and cannot be passed.
 *
 *   4. It must not leak the contributor. The request carries an address, which
 *      is public information about a building. It carries no user id, no
 *      session, and nothing that ties the lookup to the person making it.
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

/* -------------------------------------------------------------------------
 * What counts as precise enough
 * ---------------------------------------------------------------------- */

/**
 * Nominatim's `place_rank`: 30 is a house number or a building, 26 is a street,
 * and everything below that is a suburb, a city or larger.
 *
 * Only 30 is any use here. A street-level answer is not a less precise version
 * of the right answer; it is a different answer to a different question, and
 * taking it would put a confident-looking coordinate hundreds of metres from
 * the property.
 */
const MINIMUM_PLACE_RANK = 30;

/**
 * And a second, independent gate on the size of the matched feature.
 *
 * `place_rank` is a classification and classifications drift. The bounding box
 * is a measurement: whatever Nominatim decided to call the thing it found, a
 * feature spanning more than a couple of hundred metres is not a building.
 * Generous enough for a genuinely large block, tight enough to exclude a road.
 */
const MAXIMUM_FEATURE_SPAN_METERS = 250;

interface NominatimResult {
  lat?: string;
  lon?: string;
  place_rank?: number;
  addresstype?: string;
  /** [south, north, west, east], as strings. */
  boundingbox?: [string, string, string, string];
  address?: Record<string, string | undefined>;
}

/** The longest side of a result's bounding box, in metres. */
function featureSpanMeters(box: [string, string, string, string]): number {
  const [south, north, west, east] = box.map(Number) as [number, number, number, number];
  if (![south, north, west, east].every(Number.isFinite)) return Number.POSITIVE_INFINITY;

  const latSpan = Math.abs(north - south) * 111_320;
  const lonSpan =
    Math.abs(east - west) * 111_320 * Math.cos((south * Math.PI) / 180);

  return Math.max(latSpan, lonSpan);
}

/**
 * Is the answer in the place we asked about?
 *
 * The country is already constrained by the request, so this is really asking
 * about the locality — and it exists for the case where a property has a
 * building name and no street address. "Hofgarten, Berlin" resolves to a
 * perfectly precise rank-30 amenity two and a half kilometres from the
 * Hofgarten that was meant. Precise and wrong is the failure mode this whole
 * file is arranged against, so a match that names a different town is refused.
 *
 * Lenient by design: Nominatim reports the locality under any of several keys
 * depending on how the area is administered, and an answer that names none of
 * them is accepted rather than second-guessed.
 */
function matchesLocality(
  address: Record<string, string | undefined> | undefined,
  locality: string,
): boolean {
  if (!address) return true;

  const candidates = [
    address.city,
    address.town,
    address.village,
    address.municipality,
    address.county,
    address.state_district,
    address.suburb,
    address.city_district,
  ].filter((value): value is string => Boolean(value));

  if (candidates.length === 0) return true;

  const normalise = (value: string) =>
    value
      .normalize('NFD')
      // The Unicode combining-mark block, so "Zürich" and "Zurich" compare
      // equal. Livd serves markets where the accented spelling and the
      // unaccented one are both in everyday use.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

  const wanted = normalise(locality);
  return candidates.some((candidate) => {
    const found = normalise(candidate);
    return found.includes(wanted) || wanted.includes(found);
  });
}

/**
 * OpenStreetMap's Nominatim.
 *
 * Chosen because it needs no key, which means this can be switched on by a
 * founder with two environment variables rather than a billing relationship.
 * The trade is that its usage policy requires a genuine contact in the
 * User-Agent and permits roughly one request a second — so
 * `LIVD_GEOCODER_CONTACT` is mandatory rather than decorative, and the provider
 * refuses to construct without it rather than quietly violating someone else's
 * terms of service.
 *
 * Called once per property creation, which is already rate-limited to five an
 * hour per contributor, so the policy limit is nowhere near a constraint.
 */
class NominatimGeocoder implements Geocoder {
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
     */
    const street = input.streetAddress?.trim() || input.buildingName?.trim();
    if (!street) return null;

    // Structured parameters rather than one free-text string: Nominatim
    // resolves a decomposed address considerably better, and Livd already holds
    // addresses decomposed because that is what makes it international.
    const params = new URLSearchParams({
      street,
      city: input.locality,
      country: input.countryCode,
      format: 'jsonv2',
      limit: '1',
      // Needed for the locality check below.
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
        // A contributor is waiting on a redirect. A cold lookup measured about
        // 2.6 seconds and a warm one about 250ms, so eight is generous without
        // being a hang; past that the property is created without a coordinate.
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });

      if (!response.ok) return null;

      const results = (await response.json()) as NominatimResult[];
      const first = results[0];
      if (!first?.lat || !first?.lon) return null;

      /* --- Is this precise enough to verify against? ------------------- */

      if ((first.place_rank ?? 0) < MINIMUM_PLACE_RANK) return null;

      if (
        !first.boundingbox ||
        featureSpanMeters(first.boundingbox) > MAXIMUM_FEATURE_SPAN_METERS
      ) {
        return null;
      }

      if (!matchesLocality(first.address, input.locality)) return null;

      /* --- Is it a coordinate? ----------------------------------------- */

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

/** Exported for tests, which assert the gates rather than trusting the comments. */
export const GEOCODER_PRECISION = {
  minimumPlaceRank: MINIMUM_PLACE_RANK,
  maximumFeatureSpanMeters: MAXIMUM_FEATURE_SPAN_METERS,
} as const;
