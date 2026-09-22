/**
 * The shape of the sample dataset's geography.
 *
 * Country → region → city → neighbourhood → property. The first four are real
 * places with real names and representative coordinates; only the properties
 * are invented. Nothing below a neighbourhood is ever a real building.
 *
 * EDITING THIS DATA SAFELY
 *
 * A property's identity is its city, its neighbourhood and its index within
 * that neighbourhood. Its content — name, coordinates, reviews — is derived
 * from that identity and nothing else. So:
 *
 *   - Raising `properties` on a city adds properties. The existing ones keep
 *     their ids and their content, and the loader inserts only what is new.
 *   - Adding a neighbourhood: append it to the end of the city's list. Its
 *     position is part of how building names are kept unique within a city,
 *     so inserting one in the middle renames the properties of every
 *     neighbourhood after it — harmless in the database, which never updates
 *     a row it already has, but it makes the generator and the database
 *     disagree.
 *   - Lowering a count or removing a neighbourhood removes nothing. The
 *     loader is additive; see docs/sample-data.md.
 */

export type CityTier = 'major' | 'secondary' | 'smaller';

/**
 * A neighbourhood: its name as residents write it, a representative point
 * inside it, and optionally how much of the city's properties it attracts and
 * how expensive it is relative to the city.
 *
 *   [name, latitude, longitude, weight = 1, rentFactor = 1]
 */
export type NeighbourhoodEntry = readonly [
  name: string,
  latitude: number,
  longitude: number,
  weight?: number,
  rentFactor?: number,
];

export interface SeedCity {
  /** The locality, spelled as it is stored and shown. */
  name: string;
  /** The first-level subdivision, in the market's own convention. */
  region: string;
  tier: CityTier;
  /** How many sample properties the city should hold. */
  properties: number;
  /** Rent relative to the market's baseline. */
  rentIndex: number;
  /**
   * How far from a neighbourhood's point a property may sit, in metres.
   * Smaller where a neighbourhood is small or runs up to water.
   */
  spreadMeters?: number;
  neighbourhoods: readonly NeighbourhoodEntry[];
}

export interface SeedCountry {
  code: string;
  cities: readonly SeedCity[];
}

/** Most properties any one neighbourhood receives, however large its city. */
export const MAX_PER_NEIGHBOURHOOD = 40;
