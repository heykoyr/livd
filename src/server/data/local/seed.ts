/**
 * Development seed data.
 *
 * Sixteen properties across eight markets, generated deterministically so the
 * dataset is identical on every machine and every run.
 *
 * Each property has a *profile* — a shape its reviews should take — rather than
 * hand-written records. That produces data with genuine internal consistency:
 * a property whose maintenance scores are poor also accumulates slow-repair
 * tags, maintenance departure reasons, and prose that matches. Hand-written
 * fixtures drift out of agreement with themselves; generated ones cannot.
 *
 * Everything here is flagged `isDemo`, is labelled as sample data wherever it
 * renders, and is never loaded when LIVD_SHOW_DEMO_DATA=false.
 */

import { CORE_CATEGORIES, suggestedExtendedCategories } from '@/config/categories';
import { getMarket } from '@/config/markets';
import type {
  Property,
  PropertyTypeKey,
  Review,
  ResidencyStatus,
  UserProfile,
} from '@/types/domain';
import { propertySlug } from '@/lib/utils';

/* -------------------------------------------------------------------------
 * Deterministic randomness
 * ---------------------------------------------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function pickSome<T>(random: () => number, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const chosen: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
  }
  return chosen;
}

/** Clamped 1–5 draw around a mean, so a profile produces a spread not a constant. */
function drawRating(random: () => number, mean: number, spread = 0.9): number {
  const noise = (random() + random() + random() - 1.5) * spread * 1.4;
  return Math.max(1, Math.min(5, Math.round(mean + noise)));
}

/* -------------------------------------------------------------------------
 * Property profiles
 * ---------------------------------------------------------------------- */

interface PropertyProfile {
  key: string;
  buildingName: string | null;
  streetAddress: string;
  neighbourhood: string | null;
  locality: string;
  adminArea: string | null;
  postalCode: string | null;
  countryCode: string;
  propertyType: PropertyTypeKey;
  yearBuilt: number | null;
  unitCount: number | null;
  coordinates: { latitude: number; longitude: number } | null;

  /** How many reviews to generate. */
  reviewCount: number;
  /** Baseline mean rating, 1–5. */
  baseline: number;
  /** Categories that run notably above baseline. */
  strong: string[];
  /** Categories that run notably below baseline. */
  weak: string[];
  /** Applied to reviews in the most recent window, to create a trend. */
  recentShift: number;
  /** Share of reviews that are verified. */
  verifiedShare: number;
  /** Share of former residents; the rest are current. */
  formerShare: number;
  /** Year the managing agent changed, if residents reported one. */
  managementChangeYear: number | null;
  /** Monthly rent in minor units, and the currency it is quoted in. */
  rentMinor: number;
  rentCurrency: string;
  /** Annual rent drift, as a multiplier per year. */
  rentDrift: number;
  /** Earliest and latest tenancy end years. */
  fromYear: number;
  toYear: number;
}

const PROFILES: PropertyProfile[] = [
  /* ---------------- United States ---------------- */
  {
    key: 'us-brooklyn-franklin',
    buildingName: 'The Franklin',
    streetAddress: '218 Franklin Avenue',
    neighbourhood: 'Bedford-Stuyvesant',
    locality: 'Brooklyn',
    adminArea: 'NY',
    postalCode: '11205',
    countryCode: 'US',
    propertyType: 'apartment',
    yearBuilt: 1928,
    unitCount: 42,
    coordinates: { latitude: 40.694, longitude: -73.957 },
    reviewCount: 23,
    baseline: 3.1,
    strong: ['location', 'neighbours', 'natural_light'],
    weak: ['building_maintenance', 'management', 'heating_cooling'],
    recentShift: -0.5,
    verifiedShare: 0.45,
    formerShare: 0.78,
    managementChangeYear: 2023,
    rentMinor: 289_000,
    rentCurrency: 'USD',
    rentDrift: 1.06,
    fromYear: 2019,
    toYear: 2026,
  },
  {
    key: 'us-austin-cedar',
    buildingName: 'Cedar Row',
    streetAddress: '1140 East 6th Street',
    neighbourhood: 'East Austin',
    locality: 'Austin',
    adminArea: 'TX',
    postalCode: '78702',
    countryCode: 'US',
    propertyType: 'apartment',
    yearBuilt: 2016,
    unitCount: 88,
    coordinates: { latitude: 30.264, longitude: -97.727 },
    reviewCount: 19,
    baseline: 4.2,
    strong: ['building_maintenance', 'management', 'safety', 'internet'],
    weak: ['value', 'parking'],
    recentShift: 0.1,
    verifiedShare: 0.63,
    formerShare: 0.6,
    managementChangeYear: null,
    rentMinor: 218_000,
    rentCurrency: 'USD',
    rentDrift: 1.05,
    fromYear: 2020,
    toYear: 2026,
  },
  {
    key: 'us-chicago-logan',
    buildingName: null,
    streetAddress: '2437 North Kedzie Boulevard',
    neighbourhood: 'Logan Square',
    locality: 'Chicago',
    adminArea: 'IL',
    postalCode: '60647',
    countryCode: 'US',
    propertyType: 'apartment',
    yearBuilt: 1911,
    unitCount: 6,
    coordinates: { latitude: 41.925, longitude: -87.708 },
    reviewCount: 7,
    baseline: 3.7,
    strong: ['natural_light', 'noise', 'neighbours'],
    weak: ['heating_cooling', 'laundry'],
    recentShift: 0.3,
    verifiedShare: 0.29,
    formerShare: 0.71,
    managementChangeYear: null,
    rentMinor: 172_500,
    rentCurrency: 'USD',
    rentDrift: 1.04,
    fromYear: 2021,
    toYear: 2026,
  },

  /* ---------------- United Kingdom ---------------- */
  {
    key: 'gb-london-hackney',
    buildingName: 'Meridian Court',
    streetAddress: '14 Morning Lane',
    neighbourhood: 'Hackney',
    locality: 'London',
    adminArea: 'Greater London',
    postalCode: 'E9 6ND',
    countryCode: 'GB',
    propertyType: 'apartment',
    yearBuilt: 2007,
    unitCount: 64,
    coordinates: { latitude: 51.546, longitude: -0.052 },
    reviewCount: 31,
    baseline: 3.4,
    strong: ['location', 'safety', 'internet'],
    weak: ['damp_mould', 'building_maintenance', 'value'],
    recentShift: 0.7,
    verifiedShare: 0.55,
    formerShare: 0.71,
    managementChangeYear: 2024,
    rentMinor: 210_000,
    rentCurrency: 'GBP',
    rentDrift: 1.07,
    fromYear: 2018,
    toYear: 2026,
  },
  {
    key: 'gb-manchester-ancoats',
    buildingName: 'Cutler Works',
    streetAddress: '3 Blossom Street',
    neighbourhood: 'Ancoats',
    locality: 'Manchester',
    adminArea: 'Greater Manchester',
    postalCode: 'M4 6AJ',
    countryCode: 'GB',
    propertyType: 'apartment',
    yearBuilt: 2019,
    unitCount: 120,
    coordinates: { latitude: 53.484, longitude: -2.226 },
    reviewCount: 16,
    baseline: 4.0,
    strong: ['building_maintenance', 'cleanliness', 'safety', 'location'],
    weak: ['noise', 'value'],
    recentShift: -0.2,
    verifiedShare: 0.5,
    formerShare: 0.5,
    managementChangeYear: null,
    rentMinor: 132_500,
    rentCurrency: 'GBP',
    rentDrift: 1.06,
    fromYear: 2020,
    toYear: 2026,
  },
  {
    key: 'gb-bristol-totterdown',
    buildingName: null,
    streetAddress: '52 Wells Road',
    neighbourhood: 'Totterdown',
    locality: 'Bristol',
    adminArea: 'Bristol',
    postalCode: 'BS4 2AG',
    countryCode: 'GB',
    propertyType: 'townhouse',
    yearBuilt: 1898,
    unitCount: 1,
    coordinates: { latitude: 51.437, longitude: -2.579 },
    reviewCount: 5,
    baseline: 2.6,
    strong: ['location', 'neighbours'],
    weak: ['damp_mould', 'heating_cooling', 'management', 'building_maintenance'],
    recentShift: -0.3,
    verifiedShare: 0.2,
    formerShare: 1,
    managementChangeYear: null,
    rentMinor: 148_000,
    rentCurrency: 'GBP',
    rentDrift: 1.05,
    fromYear: 2021,
    toYear: 2025,
  },

  /* ---------------- Nigeria ---------------- */
  {
    key: 'ng-lagos-admiralty',
    buildingName: 'Admiralty Heights',
    streetAddress: '8 Admiralty Way',
    neighbourhood: 'Lekki Phase 1',
    locality: 'Lagos',
    adminArea: 'Lagos State',
    postalCode: null,
    countryCode: 'NG',
    propertyType: 'apartment',
    yearBuilt: 2015,
    unitCount: 24,
    coordinates: { latitude: 6.442, longitude: 3.472 },
    reviewCount: 27,
    baseline: 3.5,
    strong: ['safety', 'location', 'neighbours'],
    weak: ['water_supply', 'power_reliability', 'building_maintenance'],
    recentShift: 0.4,
    verifiedShare: 0.48,
    formerShare: 0.74,
    managementChangeYear: 2024,
    rentMinor: 450_000_00,
    rentCurrency: 'NGN',
    rentDrift: 1.18,
    fromYear: 2019,
    toYear: 2026,
  },
  {
    key: 'ng-lagos-adewale',
    buildingName: null,
    streetAddress: '12 Adewale Street',
    neighbourhood: 'Yaba',
    locality: 'Lagos',
    adminArea: 'Lagos State',
    postalCode: null,
    countryCode: 'NG',
    propertyType: 'apartment',
    yearBuilt: 2009,
    unitCount: 12,
    coordinates: { latitude: 6.512, longitude: 3.379 },
    reviewCount: 14,
    baseline: 2.8,
    strong: ['location', 'value'],
    weak: ['power_reliability', 'drainage', 'management', 'water_supply'],
    recentShift: -0.4,
    verifiedShare: 0.29,
    formerShare: 0.86,
    managementChangeYear: null,
    rentMinor: 180_000_00,
    rentCurrency: 'NGN',
    rentDrift: 1.2,
    fromYear: 2020,
    toYear: 2026,
  },
  {
    key: 'ng-abuja-wuse',
    buildingName: 'Cardinal Court',
    streetAddress: '31 Aminu Kano Crescent',
    neighbourhood: 'Wuse 2',
    locality: 'Abuja',
    adminArea: 'FCT',
    postalCode: null,
    countryCode: 'NG',
    propertyType: 'apartment',
    yearBuilt: 2018,
    unitCount: 18,
    coordinates: { latitude: 9.077, longitude: 7.482 },
    reviewCount: 11,
    baseline: 4.1,
    strong: ['safety', 'power_reliability', 'management', 'cleanliness'],
    weak: ['value', 'noise'],
    recentShift: 0.0,
    verifiedShare: 0.55,
    formerShare: 0.55,
    managementChangeYear: null,
    rentMinor: 620_000_00,
    rentCurrency: 'NGN',
    rentDrift: 1.15,
    fromYear: 2021,
    toYear: 2026,
  },

  /* ---------------- Canada ---------------- */
  {
    key: 'ca-toronto-junction',
    buildingName: 'The Junction Lofts',
    streetAddress: '2946 Dundas Street West',
    neighbourhood: 'The Junction',
    locality: 'Toronto',
    adminArea: 'ON',
    postalCode: 'M6P 1Y8',
    countryCode: 'CA',
    propertyType: 'apartment',
    yearBuilt: 2013,
    unitCount: 56,
    coordinates: { latitude: 43.665, longitude: -79.469 },
    reviewCount: 18,
    baseline: 3.9,
    strong: ['location', 'building_maintenance', 'natural_light'],
    weak: ['value', 'noise', 'laundry'],
    recentShift: -0.4,
    verifiedShare: 0.44,
    formerShare: 0.67,
    managementChangeYear: 2025,
    rentMinor: 245_000,
    rentCurrency: 'CAD',
    rentDrift: 1.07,
    fromYear: 2019,
    toYear: 2026,
  },
  {
    key: 'ca-vancouver-mtpleasant',
    buildingName: null,
    streetAddress: '178 East 8th Avenue',
    neighbourhood: 'Mount Pleasant',
    locality: 'Vancouver',
    adminArea: 'BC',
    postalCode: 'V5T 1R7',
    countryCode: 'CA',
    propertyType: 'apartment',
    yearBuilt: 1994,
    unitCount: 22,
    coordinates: { latitude: 49.264, longitude: -123.1 },
    reviewCount: 9,
    baseline: 3.3,
    strong: ['location', 'neighbours'],
    weak: ['value', 'building_maintenance', 'damp_mould'],
    recentShift: 0.2,
    verifiedShare: 0.33,
    formerShare: 0.78,
    managementChangeYear: null,
    rentMinor: 268_000,
    rentCurrency: 'CAD',
    rentDrift: 1.06,
    fromYear: 2021,
    toYear: 2026,
  },

  /* ---------------- Australia ---------------- */
  {
    key: 'au-sydney-newtown',
    buildingName: 'Enmore Terraces',
    streetAddress: '61 Enmore Road',
    neighbourhood: 'Newtown',
    locality: 'Sydney',
    adminArea: 'NSW',
    postalCode: '2042',
    countryCode: 'AU',
    propertyType: 'apartment',
    yearBuilt: 2004,
    unitCount: 30,
    coordinates: { latitude: -33.897, longitude: 151.177 },
    reviewCount: 15,
    baseline: 3.6,
    strong: ['location', 'neighbours', 'internet'],
    weak: ['noise', 'value', 'damp_mould'],
    recentShift: 0.3,
    verifiedShare: 0.4,
    formerShare: 0.73,
    managementChangeYear: null,
    rentMinor: 620_00,
    rentCurrency: 'AUD',
    rentDrift: 1.08,
    fromYear: 2020,
    toYear: 2026,
  },

  /* ---------------- Germany ---------------- */
  {
    key: 'de-berlin-neukolln',
    buildingName: null,
    streetAddress: 'Weserstraße 142',
    neighbourhood: 'Neukölln',
    locality: 'Berlin',
    adminArea: 'Berlin',
    postalCode: '12045',
    countryCode: 'DE',
    propertyType: 'apartment',
    yearBuilt: 1908,
    unitCount: 16,
    coordinates: { latitude: 52.482, longitude: 13.433 },
    reviewCount: 13,
    baseline: 3.8,
    strong: ['value', 'location', 'natural_light', 'neighbours'],
    weak: ['heating_cooling', 'building_maintenance'],
    recentShift: 0.1,
    verifiedShare: 0.38,
    formerShare: 0.62,
    managementChangeYear: null,
    rentMinor: 98_000,
    rentCurrency: 'EUR',
    rentDrift: 1.04,
    fromYear: 2019,
    toYear: 2026,
  },

  /* ---------------- Netherlands ---------------- */
  {
    key: 'nl-amsterdam-oost',
    buildingName: 'Javakade 41',
    streetAddress: 'Javakade 41',
    neighbourhood: 'Oostelijk Havengebied',
    locality: 'Amsterdam',
    adminArea: 'Noord-Holland',
    postalCode: '1019 SB',
    countryCode: 'NL',
    propertyType: 'apartment',
    yearBuilt: 2001,
    unitCount: 48,
    coordinates: { latitude: 52.375, longitude: 4.94 },
    reviewCount: 12,
    baseline: 4.3,
    strong: ['building_maintenance', 'management', 'cleanliness', 'bike_storage'],
    weak: ['value', 'noise'],
    recentShift: 0.0,
    verifiedShare: 0.58,
    formerShare: 0.5,
    managementChangeYear: null,
    rentMinor: 168_000,
    rentCurrency: 'EUR',
    rentDrift: 1.05,
    fromYear: 2020,
    toYear: 2026,
  },

  /* ---------------- Ireland ---------------- */
  {
    key: 'ie-dublin-portobello',
    buildingName: null,
    streetAddress: '27 Lennox Street',
    neighbourhood: 'Portobello',
    locality: 'Dublin',
    adminArea: 'County Dublin',
    postalCode: 'D08 F925',
    countryCode: 'IE',
    propertyType: 'apartment',
    yearBuilt: 1890,
    unitCount: 4,
    coordinates: { latitude: 53.331, longitude: -6.266 },
    reviewCount: 2,
    baseline: 3.5,
    strong: ['location'],
    weak: ['heating_cooling', 'value'],
    recentShift: 0,
    verifiedShare: 0.5,
    formerShare: 0.5,
    managementChangeYear: null,
    rentMinor: 195_000,
    rentCurrency: 'EUR',
    rentDrift: 1.06,
    fromYear: 2024,
    toYear: 2026,
  },

  /* ---------------- Unreviewed, for the empty state ---------------- */
  {
    key: 'us-seattle-ballard',
    buildingName: 'Ballard Yard',
    streetAddress: '5410 22nd Avenue Northwest',
    neighbourhood: 'Ballard',
    locality: 'Seattle',
    adminArea: 'WA',
    postalCode: '98107',
    countryCode: 'US',
    propertyType: 'apartment',
    yearBuilt: 2021,
    unitCount: 74,
    coordinates: { latitude: 47.668, longitude: -122.386 },
    reviewCount: 0,
    baseline: 0,
    strong: [],
    weak: [],
    recentShift: 0,
    verifiedShare: 0,
    formerShare: 0,
    managementChangeYear: null,
    rentMinor: 0,
    rentCurrency: 'USD',
    rentDrift: 1,
    fromYear: 2026,
    toYear: 2026,
  },
];

/* -------------------------------------------------------------------------
 * Prose
 *
 * Sentence banks keyed by theme. Bodies are assembled from the themes a review
 * actually rated highly or poorly, so the prose agrees with the numbers.
 * Every line is written to be publishable — no names, no contact details, no
 * unit numbers — because the seed must pass the same content linter real
 * submissions do.
 * ---------------------------------------------------------------------- */

const OPENERS = [
  'Lived here for a while and it was a mixed experience overall.',
  'On balance I would say the good outweighed the bad, but only just.',
  'It looked great at the viewing and mostly lived up to it.',
  'Worth knowing what you are getting into before you sign.',
  'It served its purpose but I was ready to move on by the end.',
  'A decent place to live, with a few things I wish someone had told me.',
  'Genuinely one of the better places I have rented.',
  'I would think carefully before signing here again.',
];

const PRAISE: Record<string, string[]> = {
  building_maintenance: [
    'Anything that broke was fixed within a couple of days, which I did not expect.',
    'The building is clearly looked after — communal areas were repainted while I was there.',
  ],
  management: [
    'Whoever handles the building actually answers emails, which turned out to be rare.',
    'The deposit came back in full without me having to chase it.',
    'Rent reviews were reasonable and always explained in advance.',
  ],
  value: [
    'For what you pay in this area it is genuinely good value.',
    'The rent stayed sensible while everything around it went up.',
  ],
  safety: [
    'I came home late often and never once felt uneasy on the street or in the entrance.',
    'Entry is properly controlled and the lighting outside is good.',
  ],
  noise: [
    'Surprisingly quiet for how central it is — you rarely hear the neighbours.',
    'The walls are thicker than they look and traffic noise never carried up.',
  ],
  location: [
    'You can walk to almost everything and transport is a few minutes away.',
    'The location is the main reason I stayed as long as I did.',
  ],
  neighbours: [
    'The other residents are friendly without being in your business.',
    'People hold the door and take in parcels, which sounds small until you live somewhere they do not.',
  ],
  natural_light: [
    'The light through the main rooms is excellent from the morning onwards.',
    'Big windows and a proper cross-breeze in summer.',
  ],
  internet: ['Fibre was already installed and it never dropped once.'],
  cleanliness: ['Communal areas were cleaned properly every week, bins included.'],
  power_reliability: ['Backup power came on within seconds and covered the whole apartment.'],
  water_supply: ['Water ran reliably the entire time I lived there.'],
  bike_storage: ['Secure bike storage that actually had space in it.'],
  safety_generic: ['It felt like somewhere you could settle rather than just pass through.'],
};

const COMPLAINT: Record<string, string[]> = {
  building_maintenance: [
    'Repairs took weeks and usually needed chasing more than once.',
    'The same leak came back three times and was never properly fixed.',
    'Communal areas were visibly neglected by the time I left.',
  ],
  management: [
    'Getting a reply about anything took days, and often a second message.',
    'Charges appeared on statements that nobody would explain.',
    'The deposit took months to come back and required a formal letter.',
  ],
  value: [
    'The rent went up well beyond what the place was worth by the end.',
    'Once you add service charges it stops being competitive for the area.',
  ],
  safety: [
    'The main door lock was broken for long stretches and anyone could walk in.',
    'Lighting at the entrance was out for months.',
  ],
  noise: [
    'You hear everything through the floors — footsteps, conversations, all of it.',
    'Traffic noise from the main road carries straight into the bedroom.',
    'Weekend noise from nearby made sleeping difficult.',
  ],
  utilities: [
    'Service interruptions were frequent enough that you learned to plan around them.',
  ],
  water_supply: [
    'Water supply was unreliable — some weeks fine, others not at all.',
    'Pressure dropped to nothing whenever the building was busy.',
  ],
  power_reliability: [
    'Power cuts were routine and the backup did not cover much.',
    'Outages during the day were common and nothing was ever done about it.',
  ],
  heating_cooling: [
    'Heating struggled badly in winter and the bills were brutal.',
    'The place is impossible to keep cool in summer.',
  ],
  damp_mould: [
    'Damp came back every winter in the same corner no matter what I did.',
    'Mould around the windows was a constant battle.',
  ],
  drainage: ['The yard flooded whenever it rained heavily and it took days to drain.'],
  cleanliness: ['Bin areas were left to overflow and nobody took responsibility.'],
  parking: ['Parking is genuinely difficult and the permit process was a headache.'],
  pests: ['There was a recurring pest problem that treatment only ever paused.'],
  internet: ['Signal is poor at the back of the building and the broadband options are limited.'],
  neighbours: ['There were ongoing disputes in the building that made it uncomfortable.'],
  laundry: ['Shared laundry was often out of service and there is nowhere else nearby.'],
  accessibility: ['The lift was out often enough to be a real problem on the upper floors.'],
};

const CLOSERS_POSITIVE = [
  'I would live here again if the timing worked out.',
  'I left for reasons that had nothing to do with the building.',
  'Would recommend it to a friend without hesitating.',
];

const CLOSERS_NEGATIVE = [
  'I would not sign here again.',
  'Ask hard questions at the viewing and get the answers in writing.',
  'By the end I was counting down to the end of the tenancy.',
];

const CLOSERS_NEUTRAL = [
  'Worth viewing, but go in with your eyes open.',
  'Fine for a year or two, less so beyond that.',
];

/* -------------------------------------------------------------------------
 * Tag mapping — keeps chips consistent with category scores.
 * ---------------------------------------------------------------------- */

const CATEGORY_POSITIVE_TAGS: Record<string, string[]> = {
  building_maintenance: ['responsive_repairs'],
  management: ['fair_landlord', 'deposit_returned'],
  value: ['good_value'],
  safety: ['feels_safe', 'secure_entry'],
  noise: ['quiet'],
  location: ['well_connected'],
  neighbours: ['friendly_neighbours'],
  natural_light: ['good_light'],
  cleanliness: ['clean_shared_areas'],
  internet: ['good_internet'],
  utilities: ['reliable_utilities'],
  parking: ['easy_parking'],
  accessibility: ['step_free'],
};

const CATEGORY_PROBLEM_TAGS: Record<string, string[]> = {
  building_maintenance: ['slow_repairs', 'plumbing'],
  management: ['unresponsive_management', 'deposit_withheld', 'unexpected_charges'],
  value: ['steep_rent_rises', 'unexpected_charges'],
  safety: ['poor_security'],
  noise: ['noise_neighbours', 'noise_street'],
  water_supply: ['water_interruptions'],
  power_reliability: ['power_cuts'],
  heating_cooling: ['cold_in_winter', 'hot_in_summer'],
  damp_mould: ['damp_mould'],
  drainage: ['flooding'],
  cleanliness: ['dirty_shared_areas', 'waste_issues'],
  parking: ['parking_difficult'],
  pests: ['pests'],
  internet: ['weak_internet'],
  accessibility: ['lift_outages'],
  natural_light: ['dark_rooms'],
  laundry: ['small_space'],
};

const CATEGORY_DEPARTURE: Record<string, string> = {
  building_maintenance: 'maintenance',
  management: 'management',
  value: 'rent_increase',
  safety: 'safety',
  noise: 'noise',
  utilities: 'utilities',
  water_supply: 'utilities',
  power_reliability: 'utilities',
  heating_cooling: 'condition',
  damp_mould: 'condition',
  drainage: 'condition',
  neighbours: 'neighbours',
  location: 'commute',
};

const NEUTRAL_DEPARTURES = [
  'relocation',
  'work_study',
  'bought_home',
  'space',
  'life_change',
  'lease_ended',
];

/* -------------------------------------------------------------------------
 * Generation
 * ---------------------------------------------------------------------- */

export interface SeedData {
  properties: Property[];
  reviews: Review[];
  users: UserProfile[];
}

/** The point in time the seed is generated relative to. */
const SEED_NOW = new Date('2026-09-01T00:00:00.000Z');

function isoMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

export function generateSeed(): SeedData {
  const properties: Property[] = [];
  const reviews: Review[] = [];
  const users: UserProfile[] = [];

  // Demo contributor accounts. These exist so reviews have a real author id and
  // the duplicate-prevention rules behave exactly as they would in production.
  for (let i = 0; i < 120; i += 1) {
    users.push({
      id: `demo-user-${String(i).padStart(3, '0')}`,
      email: `resident${i}@demo.livd.invalid`,
      role: 'resident',
      status: 'active',
      countryCode: null,
      preferredLocale: 'en',
      createdAt: new Date(Date.UTC(2022, 0, 1)).toISOString(),
    });
  }

  users.push({
    id: 'demo-moderator',
    email: 'moderator@demo.livd.invalid',
    role: 'moderator',
    status: 'active',
    countryCode: null,
    preferredLocale: 'en',
    createdAt: new Date(Date.UTC(2022, 0, 1)).toISOString(),
  });

  let userCursor = 0;

  for (const profile of PROFILES) {
    const random = mulberry32(hashSeed(profile.key));
    const propertyId = `demo-prop-${profile.key}`;

    properties.push({
      id: propertyId,
      slug: propertySlug({
        buildingName: profile.buildingName,
        streetAddress: profile.streetAddress,
        locality: profile.locality,
      }),
      address: {
        buildingName: profile.buildingName,
        streetAddress: profile.streetAddress,
        neighbourhood: profile.neighbourhood,
        locality: profile.locality,
        adminArea: profile.adminArea,
        postalCode: profile.postalCode,
        countryCode: profile.countryCode,
      },
      propertyType: profile.propertyType,
      coordinates: profile.coordinates,
      unitCount: profile.unitCount,
      yearBuilt: profile.yearBuilt,
      status: 'active',
      mergedInto: null,
      isDemo: true,
      createdAt: new Date(Date.UTC(2022, 5, 1)).toISOString(),
      updatedAt: SEED_NOW.toISOString(),
    });

    const market = getMarket(profile.countryCode);
    const extended = suggestedExtendedCategories(profile.countryCode);
    const availableCategories = [...CORE_CATEGORIES, ...extended];

    for (let i = 0; i < profile.reviewCount; i += 1) {
      const author = users[userCursor % 120]!;
      userCursor += 1;

      const isFormer = random() < profile.formerShare;
      const residencyStatus: ResidencyStatus = isFormer ? 'former' : 'current';

      // Spread tenancies across the property's active years.
      //
      // Clamped to SEED_NOW: an unclamped December-2026 move-out produced a
      // review written in January 2027, which the property page then rendered
      // as "Last reviewed in 4 months". Demo data that describes the future is
      // not merely untidy — it makes the recency weighting look broken.
      const endYear =
        profile.fromYear +
        Math.floor(random() * Math.max(1, profile.toYear - profile.fromYear + 1));
      const endMonth =
        endYear >= SEED_NOW.getUTCFullYear()
          ? Math.floor(random() * (SEED_NOW.getUTCMonth() + 1))
          : Math.floor(random() * 12);
      const tenureMonths = 6 + Math.floor(random() * 42);

      const movedOut = isFormer ? isoMonth(endYear, endMonth) : null;
      const movedInDate = new Date(Date.UTC(endYear, endMonth - tenureMonths, 1));
      const movedInMonth = movedInDate.toISOString().slice(0, 10);

      // Reviews from the last two years get the profile's trend shift.
      const referenceYear = isFormer ? endYear : 2026;
      const isRecent = referenceYear >= 2025;
      const meanRating = Math.max(
        1,
        Math.min(5, profile.baseline + (isRecent ? profile.recentShift : 0)),
      );

      // Which categories this resident bothered to rate.
      const ratedCount = 5 + Math.floor(random() * 4);
      const rated = new Set<string>([
        ...pickSome(random, CORE_CATEGORIES.map((c) => c.key), ratedCount),
        ...profile.strong.filter((k) => availableCategories.some((c) => c.key === k)),
        ...profile.weak.filter((k) => availableCategories.some((c) => c.key === k)),
      ]);

      const categoryRatings = [...rated].map((categoryKey) => {
        let mean = meanRating;
        if (profile.strong.includes(categoryKey)) mean += 1.1;
        if (profile.weak.includes(categoryKey)) mean -= 1.3;
        return { categoryKey, rating: drawRating(random, mean) };
      });

      const overallRating = drawRating(random, meanRating, 0.7);

      // Tags follow the ratings this resident actually gave.
      const positiveTags = new Set<string>();
      const problemTags = new Set<string>();
      for (const { categoryKey, rating } of categoryRatings) {
        if (rating >= 4) {
          for (const tag of CATEGORY_POSITIVE_TAGS[categoryKey] ?? []) {
            if (random() < 0.6) positiveTags.add(tag);
          }
        } else if (rating <= 2) {
          for (const tag of CATEGORY_PROBLEM_TAGS[categoryKey] ?? []) {
            if (random() < 0.65) problemTags.add(tag);
          }
        }
      }

      // Departure reason: usually the worst category, sometimes personal.
      let primaryDepartureReason: string | null = null;
      const secondaryDepartureReasons: string[] = [];

      if (isFormer) {
        const worst = [...categoryRatings]
          .sort((a, b) => a.rating - b.rating)
          .find((c) => c.rating <= 2 && CATEGORY_DEPARTURE[c.categoryKey]);

        if (worst && random() < 0.72) {
          primaryDepartureReason = CATEGORY_DEPARTURE[worst.categoryKey]!;
        } else {
          primaryDepartureReason = pick(random, NEUTRAL_DEPARTURES);
        }

        const secondCandidate = [...categoryRatings]
          .sort((a, b) => a.rating - b.rating)
          .slice(1, 3)
          .map((c) => CATEGORY_DEPARTURE[c.categoryKey])
          .find((key): key is string => Boolean(key) && key !== primaryDepartureReason);

        if (secondCandidate && random() < 0.4) secondaryDepartureReasons.push(secondCandidate);
      }

      // Prose, assembled from the themes this resident actually rated.
      const body = random() < 0.72
        ? composeBody(random, categoryRatings, overallRating)
        : null;

      // Demonstration data predates the location-verification system and is
      // labelled honestly as what it is: a moderator-verified residency or
      // nothing. Fabricating a location verification for a property nobody has
      // ever stood outside would be inventing the exact evidence this feature
      // exists to establish.
      const verificationLevel =
        random() < profile.verifiedShare ? 'verified_resident' : 'unverified';

      const writtenAt = isFormer
        ? new Date(Date.UTC(endYear, endMonth + 1, 8 + Math.floor(random() * 20)))
        : new Date(Date.UTC(2026, 1 + Math.floor(random() * 6), 4 + Math.floor(random() * 24)));

      // A review cannot have been written after the moment the seed represents.
      const createdAt = (
        writtenAt > SEED_NOW ? SEED_NOW : writtenAt
      ).toISOString();

      // Rent drifts with the year, so the timeline has something real to report.
      const yearsFromStart = referenceYear - profile.fromYear;
      const rentAmount = Math.round(
        profile.rentMinor * Math.pow(profile.rentDrift, yearsFromStart) * (0.92 + random() * 0.16),
      );
      const reportsRent = profile.rentMinor > 0 && random() < 0.55;

      reviews.push({
        id: `demo-review-${profile.key}-${String(i).padStart(3, '0')}`,
        propertyId,
        authorId: author.id,
        residencyStatus,
        movedInMonth,
        movedOutMonth: movedOut,
        tenureMonths,
        overallRating,
        body,
        wouldRecommend: overallRating >= 4 || (overallRating === 3 && random() < 0.4),
        rent: reportsRent
          ? { amountMinor: rentAmount, currencyCode: profile.rentCurrency }
          : null,
        rentPeriod: reportsRent ? 'month' : null,
        categoryRatings,
        positiveTags: [...positiveTags],
        problemTags: [...problemTags],
        primaryDepartureReason,
        secondaryDepartureReasons,
        noticedManagementChange:
          profile.managementChangeYear !== null &&
          referenceYear >= profile.managementChangeYear &&
          random() < 0.55,
        verificationLevel,
        verificationId: null,
        verifiedAt: null,
        status: 'published',
        safetyFlags: [],
        helpfulCount: Math.floor(random() * 14),
        isDemo: true,
        createdAt,
        updatedAt: createdAt,
      });
    }

    // Keeps the reference to `market` meaningful — extended categories offered
    // in this market are the ones residents here could rate.
    void market;
  }

  return { properties, reviews, users };
}

function composeBody(
  random: () => number,
  categoryRatings: Array<{ categoryKey: string; rating: number }>,
  overallRating: number,
): string {
  const sentences: string[] = [pick(random, OPENERS)];

  const praised = categoryRatings.filter((c) => c.rating >= 4);
  const complained = categoryRatings.filter((c) => c.rating <= 2);

  for (const { categoryKey } of pickSome(random, praised, Math.min(2, praised.length))) {
    const bank = PRAISE[categoryKey];
    if (bank) sentences.push(pick(random, bank));
  }

  for (const { categoryKey } of pickSome(random, complained, Math.min(2, complained.length))) {
    const bank = COMPLAINT[categoryKey];
    if (bank) sentences.push(pick(random, bank));
  }

  if (overallRating >= 4) sentences.push(pick(random, CLOSERS_POSITIVE));
  else if (overallRating <= 2) sentences.push(pick(random, CLOSERS_NEGATIVE));
  else sentences.push(pick(random, CLOSERS_NEUTRAL));

  return sentences.join(' ');
}
