import type { CreatePropertyInput } from '@/server/data/repository';

/**
 * The shared vocabulary every geocoding provider is translated into.
 *
 * Providers disagree about almost everything — Nominatim has `place_rank`,
 * Google has `location_type`, Mapbox has `accuracy` — but Livd only ever asks
 * them one question: *is this precise enough to verify a resident against?*
 *
 * So each provider's answer is normalised into a `GeocodeCandidate` and then
 * judged by one shared gate. That keeps the rule in a single place rather than
 * scattered across three response parsers, which matters because the rule is
 * the part that protects residents from being told they are not somewhere they
 * demonstrably are.
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
 * How precisely a provider claims to have located the address.
 *
 * Ordered, and the ordering is the whole point:
 *
 *   `building`      A specific building, parcel or rooftop. What we want.
 *   `interpolated`  Estimated along a street between two known house numbers.
 *                   Usually within a few tens of metres in a dense city, which
 *                   the verification budget absorbs. Accepted, and it is the
 *                   difference between working in Lagos and not.
 *   `street`        Somewhere on a road. Refused: Admiralty Way is 1.7km long,
 *                   and a point on it can be most of a kilometre from the door.
 *   `area`          A district, city or larger. Refused, obviously.
 */
export type GeocodePrecision = 'building' | 'interpolated' | 'street' | 'area';

/** One provider's answer, translated into terms the shared gate understands. */
export interface GeocodeCandidate {
  latitude: number;
  longitude: number;
  precision: GeocodePrecision;
  /**
   * The longest side of the matched feature's bounding box, in metres, where
   * the provider gave one.
   *
   * An independent measurement rather than a second opinion on the same thing:
   * a precision label is a classification and classifications drift, but a
   * feature two kilometres across is not a building whatever it is called.
   * Null when the provider returned no box — then the label carries the
   * decision alone.
   */
  spanMeters: number | null;
  /**
   * The locality the provider says the result is in, if it said.
   *
   * Checked against the locality we asked about, because a precise answer in
   * the wrong town is the most dangerous kind of wrong: "Hofgarten, Berlin"
   * resolves to an exact amenity two and a half kilometres from the intended
   * one, and precision is exactly what makes that mistake survive a review.
   */
  locality: string | null;
}
