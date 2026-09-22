import { UNITED_KINGDOM } from './gb';
import { NIGERIA } from './ng';
import type { SeedCountry } from './types';

/**
 * Every market the sample dataset covers, in the order they are generated.
 *
 * The markets are Livd's own — `MARKETS` in src/config/markets.ts and the
 * `countries` table — and nothing here adds one. A market listed there and
 * missing here simply has no sample data yet.
 */
export const SEED_GEOGRAPHY: readonly SeedCountry[] = [NIGERIA, UNITED_KINGDOM];

export type { CityTier, NeighbourhoodEntry, SeedCity, SeedCountry } from './types';
