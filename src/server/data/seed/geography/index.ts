import { UNITED_ARAB_EMIRATES } from './ae';
import { AUSTRALIA } from './au';
import { CANADA } from './ca';
import { GERMANY } from './de';
import { FRANCE } from './fr';
import { UNITED_KINGDOM } from './gb';
import { IRELAND } from './ie';
import { INDIA } from './in';
import { NIGERIA } from './ng';
import { NETHERLANDS } from './nl';
import type { SeedCountry } from './types';
import { UNITED_STATES } from './us';
import { SOUTH_AFRICA } from './za';

/**
 * Every market the sample dataset covers.
 *
 * The markets are Livd's own — `MARKETS` in src/config/markets.ts and the
 * `countries` table — and nothing here adds one. Order does not affect any
 * property's content, which depends only on its own key.
 */
export const SEED_GEOGRAPHY: readonly SeedCountry[] = [
  NIGERIA,
  UNITED_KINGDOM,
  UNITED_STATES,
  CANADA,
  AUSTRALIA,
  GERMANY,
  NETHERLANDS,
  IRELAND,
  FRANCE,
  SOUTH_AFRICA,
  UNITED_ARAB_EMIRATES,
  INDIA,
];

export type { CityTier, NeighbourhoodEntry, SeedCity, SeedCountry } from './types';
