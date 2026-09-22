import { CORE_CATEGORIES, suggestedExtendedCategories } from '@/config/categories';
import { getMarket } from '@/config/markets';
import { propertySlug, slugify } from '@/lib/utils';
import type { CategoryRating, Property, PropertyTypeKey, Review, ResidencyStatus } from '@/types/domain';
import { flavourFor, type MarketFlavour } from './flavour';
import { SEED_GEOGRAPHY } from './geography';
import { MAX_PER_NEIGHBOURHOOD, type SeedCity, type SeedCountry } from './geography/types';
import { buildingName, nameSuitsSingleDwelling, SINGLE_DWELLING, slotFor } from './names';
import { composeReviewBody } from './prose';
import { drawRating, hashSeed, intBetween, pick, pickSome, pickWeighted, rngFor } from './random';

/**
 * The expanded sample dataset.
 *
 * Several thousand invented properties in real neighbourhoods of real cities,
 * each with a handful to a few dozen sample reviews written against Livd's
 * existing review model — the same residency types, the same categories, tags
 * and departure reasons, the same verification levels the legacy seed uses.
 * Nothing here is a new kind of record; it is more of the kind that exists,
 * every one marked `isDemo`.
 *
 * See `geography/types.ts` for how to grow it safely, and docs/sample-data.md
 * for how it reaches a database.
 */

/**
 * The moment the dataset describes. No sample review is dated after it.
 *
 * Fixed rather than "now", so a re-run produces identical rows. It must also
 * sit safely in the past when the seed is applied: the Trust & Safety
 * detectors (`livd_detect_property_flags`, `livd_detect_account_signals`)
 * look at the last 48 hours of reviews, and seeded reviews dated inside that
 * window would raise signals about sample accounts. The loader refuses to run
 * if this is less than three days ago.
 */
export const SAMPLE_AS_OF = new Date('2026-09-01T00:00:00.000Z');

/** Demo contributor accounts, created by the legacy seed and reused here. */
export const DEMO_AUTHOR_COUNT = 120;

export interface ExpandedSeedOptions {
  /** Only these markets, by ISO code. */
  countries?: readonly string[];
  /** Only these cities, as `CC/City` (case-insensitive). */
  cities?: readonly string[];
  /** At most this many properties per city — the local development store. */
  maxPerCity?: number;
}

export interface PlanRow {
  countryCode: string;
  region: string;
  city: string;
  tier: SeedCity['tier'];
  neighbourhood: string;
  properties: number;
}

export interface ExpandedSeed {
  properties: Property[];
  reviews: Review[];
  plan: PlanRow[];
}

/* -------------------------------------------------------------------------
 * Property profiles
 *
 * The shape a property's reviews take. A property whose maintenance is poor
 * accumulates low maintenance scores, slow-repair tags, maintenance departures
 * and prose that complains about repairs — because all of them are drawn from
 * the same profile, they agree with each other.
 * ---------------------------------------------------------------------- */

interface Archetype {
  key: string;
  baseline: readonly [number, number];
  strong: readonly string[];
  weak: readonly string[];
  shift?: readonly [number, number];
  rentFactor: number;
  /** Relative frequency, by market concern. `default` applies everywhere. */
  weight: Partial<Record<'default' | 'power' | 'water' | 'heating' | 'damp' | 'security' | 'cooling', number>>;
}

const ARCHETYPES: readonly Archetype[] = [
  {
    key: 'well_run',
    baseline: [4.2, 4.7],
    strong: ['building_maintenance', 'management', 'cleanliness', 'safety', 'power_reliability'],
    weak: ['value'],
    rentFactor: 1.15,
    weight: { default: 10 },
  },
  {
    key: 'solid_but_pricey',
    baseline: [3.7, 4.0],
    strong: ['location', 'safety', 'internet'],
    weak: ['value', 'parking'],
    rentFactor: 1.2,
    weight: { default: 10 },
  },
  {
    key: 'good_area_poor_landlord',
    baseline: [3.0, 3.4],
    strong: ['location', 'neighbours', 'natural_light'],
    weak: ['management', 'building_maintenance'],
    rentFactor: 1.0,
    weight: { default: 11 },
  },
  {
    key: 'tired_block',
    baseline: [2.5, 3.0],
    strong: ['value', 'location'],
    weak: ['building_maintenance', 'cleanliness', 'damp_mould', 'heating_cooling', 'pests'],
    rentFactor: 0.82,
    weight: { default: 8, damp: 4, heating: 3 },
  },
  {
    key: 'utilities_trouble',
    baseline: [2.6, 3.2],
    strong: ['location', 'safety', 'neighbours'],
    weak: ['power_reliability', 'water_supply', 'drainage', 'utilities'],
    rentFactor: 0.9,
    weight: { power: 12, water: 6 },
  },
  {
    key: 'noisy_central',
    baseline: [3.2, 3.6],
    strong: ['location', 'internet', 'natural_light'],
    weak: ['noise', 'value'],
    rentFactor: 1.05,
    weight: { default: 9 },
  },
  {
    key: 'quiet_suburban',
    baseline: [3.6, 4.1],
    strong: ['noise', 'neighbours', 'parking', 'safety'],
    weak: ['location'],
    rentFactor: 0.95,
    weight: { default: 9 },
  },
  {
    key: 'problem_building',
    baseline: [1.9, 2.5],
    strong: ['location'],
    weak: ['management', 'building_maintenance', 'safety', 'pests', 'accessibility'],
    rentFactor: 0.85,
    weight: { default: 5, security: 2 },
  },
  {
    key: 'mixed',
    baseline: [3.2, 3.7],
    strong: [],
    weak: [],
    rentFactor: 1.0,
    weight: { default: 12 },
  },
  {
    key: 'improving',
    baseline: [2.9, 3.4],
    strong: ['location'],
    weak: ['building_maintenance'],
    shift: [0.5, 0.9],
    rentFactor: 1.0,
    weight: { default: 5 },
  },
  {
    key: 'declining',
    baseline: [3.5, 3.9],
    strong: ['location', 'neighbours'],
    weak: ['management'],
    shift: [-0.9, -0.5],
    rentFactor: 1.05,
    weight: { default: 5 },
  },
];

interface Profile {
  archetype: string;
  baseline: number;
  strong: string[];
  weak: string[];
  recentShift: number;
  verifiedShare: number;
  formerShare: number;
  managementChangeYear: number | null;
  rentMinor: number;
}

/* -------------------------------------------------------------------------
 * Tags and departure reasons, kept consistent with the ratings
 * ---------------------------------------------------------------------- */

const POSITIVE_TAGS: Record<string, readonly string[]> = {
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
  power_reliability: ['reliable_utilities'],
  water_supply: ['reliable_utilities'],
  parking: ['easy_parking'],
  accessibility: ['step_free'],
};

const PROBLEM_TAGS: Record<string, readonly string[]> = {
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
};

/** Tags only a former resident can honestly choose. */
const FORMER_ONLY_TAGS = new Set(['deposit_returned', 'deposit_withheld']);

const DEPARTURE_FOR_CATEGORY: Record<string, string> = {
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

const PERSONAL_DEPARTURES = ['relocation', 'work_study', 'bought_home', 'space', 'life_change', 'lease_ended'];

/* -------------------------------------------------------------------------
 * Allocation
 * ---------------------------------------------------------------------- */

/**
 * A city's properties across its neighbourhoods, by weight.
 *
 * Largest remainder, so the parts sum to the whole; capped per neighbourhood,
 * with whatever the cap refuses spread over the rest. Every neighbourhood gets
 * at least one property while the city has enough to go round.
 */
export function allocate(city: SeedCity, total = city.properties): number[] {
  const count = city.neighbourhoods.length;
  const weights = city.neighbourhoods.map(([, , , weight = 1]) => weight);
  const result = new Array<number>(count).fill(0);
  if (total <= 0 || count === 0) return result;

  const floor = total >= count ? 1 : 0;
  let remaining = total - floor * count;
  for (let i = 0; i < count; i += 1) result[i] = floor;

  // Distribute by weight among neighbourhoods still under the cap.
  while (remaining > 0) {
    const open = result
      .map((value, index) => ({ index, value }))
      .filter(({ value }) => value < MAX_PER_NEIGHBOURHOOD);
    if (open.length === 0) break;

    const weightSum = open.reduce((sum, { index }) => sum + weights[index]!, 0);
    const shares = open.map(({ index }) => ({
      index,
      exact: (remaining * weights[index]!) / weightSum,
    }));

    let handed = 0;
    for (const share of shares) {
      const whole = Math.min(Math.floor(share.exact), MAX_PER_NEIGHBOURHOOD - result[share.index]!);
      result[share.index]! += whole;
      handed += whole;
    }

    if (handed === 0) {
      // Everything left is a remainder; hand it out largest-first, one each.
      const ordered = [...shares].sort(
        (a, b) => (b.exact % 1) - (a.exact % 1) || weights[b.index]! - weights[a.index]! || a.index - b.index,
      );
      for (const share of ordered) {
        if (remaining - handed <= 0) break;
        if (result[share.index]! < MAX_PER_NEIGHBOURHOOD) {
          result[share.index]! += 1;
          handed += 1;
        }
      }
    }
    remaining -= handed;
  }

  return result;
}

/* -------------------------------------------------------------------------
 * Generation
 * ---------------------------------------------------------------------- */

export function generateExpandedSeed(options: ExpandedSeedOptions = {}): ExpandedSeed {
  const properties: Property[] = [];
  const reviews: Review[] = [];
  const plan: PlanRow[] = [];

  const countryFilter = options.countries?.map((code) => code.toUpperCase());
  const cityFilter = options.cities?.map((entry) => entry.toLowerCase());

  for (const country of SEED_GEOGRAPHY) {
    if (countryFilter && !countryFilter.includes(country.code)) continue;
    const flavour = flavourFor(country.code);

    for (const city of country.cities) {
      if (cityFilter && !cityFilter.includes(`${country.code}/${city.name}`.toLowerCase())) continue;

      const total =
        options.maxPerCity === undefined
          ? city.properties
          : Math.min(city.properties, options.maxPerCity);
      const allocation = allocate(city, total);

      city.neighbourhoods.forEach((entry, neighbourhoodIndex) => {
        const count = allocation[neighbourhoodIndex]!;
        plan.push({
          countryCode: country.code,
          region: city.region,
          city: city.name,
          tier: city.tier,
          neighbourhood: entry[0],
          properties: count,
        });

        for (let index = 0; index < count; index += 1) {
          const generated = generateProperty(country, city, flavour, neighbourhoodIndex, index);
          properties.push(generated.property);
          reviews.push(...generated.reviews);
        }
      });
    }
  }

  return { properties, reviews, plan };
}

/** The stable identity everything about a property is derived from. */
export function propertyKey(countryCode: string, city: string, neighbourhood: string, index: number): string {
  return `${countryCode}/${slugify(city)}/${slugify(neighbourhood)}/${String(index).padStart(3, '0')}`;
}

function generateProperty(
  country: SeedCountry,
  city: SeedCity,
  flavour: MarketFlavour,
  neighbourhoodIndex: number,
  index: number,
): { property: Property; reviews: Review[] } {
  const [neighbourhood, latitude, longitude, , rentFactor = 1] = city.neighbourhoods[neighbourhoodIndex]!;
  const key = propertyKey(country.code, city.name, neighbourhood, index);
  const random = rngFor(`property:${key}`);

  const name = buildingName(
    flavour.nameStyle,
    `${country.code}/${slugify(city.name)}`,
    slotFor(neighbourhoodIndex, index),
  );

  let propertyType = pickWeighted(random, flavour.propertyTypes);
  if (SINGLE_DWELLING.has(propertyType) && !nameSuitsSingleDwelling(name)) propertyType = 'apartment';

  const yearBuilt = random() < 0.2 ? null : drawYearBuilt(random, flavour, propertyType);
  const unitCount = random() < 0.15 ? null : drawUnitCount(random, flavour, propertyType);
  const coordinates = jitter(random, latitude, longitude, city.spreadMeters ?? 450);

  const profile = drawProfile(random, country.code, flavour, city, rentFactor, propertyType);
  const reviewCount = drawReviewCount(random, city.tier);

  const propertyId = `demo-prop:${key}`;
  const available = new Set([
    ...CORE_CATEGORIES.map((c) => c.key),
    ...suggestedExtendedCategories(country.code).map((c) => c.key),
  ]);

  // Reviews are written against the time the building has existed.
  const earliest = new Date(
    Math.max(
      SAMPLE_AS_OF.getTime() - 6.5 * 365.25 * 86_400_000,
      yearBuilt ? Date.UTC(yearBuilt + 1, 0, 1) : 0,
    ),
  );

  const used = new Set<string>();
  const reviews: Review[] = [];
  const authorBase = hashSeed(key) % DEMO_AUTHOR_COUNT;

  for (let i = 0; i < reviewCount; i += 1) {
    reviews.push(
      generateReview({
        key,
        index: i,
        propertyId,
        countryCode: country.code,
        flavour,
        propertyType,
        profile,
        available,
        earliest,
        used,
        // Seven is coprime with 120, so consecutive reviews of one property
        // always have different authors — which is what the database's
        // one-review-per-tenancy index requires of them.
        author: `demo-user-${String((authorBase + i * 7) % DEMO_AUTHOR_COUNT).padStart(3, '0')}`,
      }),
    );
  }

  const firstReview = reviews.reduce<string | null>(
    (min, review) => (min === null || review.createdAt < min ? review.createdAt : min),
    null,
  );
  const lastReview = reviews.reduce<string | null>(
    (max, review) => (max === null || review.createdAt > max ? review.createdAt : max),
    null,
  );
  // Listed a little before anyone wrote about it.
  const createdAt = new Date(
    new Date(firstReview ?? SAMPLE_AS_OF.toISOString()).getTime() - intBetween(random, 3, 40) * 86_400_000,
  ).toISOString();

  const property: Property = {
    id: propertyId,
    slug: propertySlug({
      buildingName: name,
      locality: city.name,
      discriminator: hashSeed(`slug:${key}`).toString(36).padStart(6, '0'),
    }),
    address: {
      buildingName: name,
      // Deliberately none. A real street with an invented number is an address
      // that belongs to somebody; a sample property is placed by its
      // neighbourhood and never at a door.
      streetAddress: null,
      neighbourhood,
      locality: city.name,
      adminArea: city.region,
      postalCode: null,
      countryCode: country.code,
    },
    propertyType,
    coordinates,
    unitCount,
    yearBuilt,
    status: 'active',
    mergedInto: null,
    isDemo: true,
    createdAt,
    updatedAt: lastReview ?? createdAt,
  };

  return { property, reviews };
}

/**
 * A point near the neighbourhood's, uniformly within `spread` metres, rounded
 * as the database rounds (0003) — to about 110 metres, which is a street
 * block, never a building.
 */
function jitter(
  random: () => number,
  latitude: number,
  longitude: number,
  spread: number,
): { latitude: number; longitude: number } {
  const distance = spread * Math.sqrt(random());
  const bearing = random() * 2 * Math.PI;
  const dLat = (distance * Math.cos(bearing)) / 111_320;
  const dLng = (distance * Math.sin(bearing)) / (111_320 * Math.cos((latitude * Math.PI) / 180));
  return {
    latitude: Math.round((latitude + dLat) * 1000) / 1000,
    longitude: Math.round((longitude + dLng) * 1000) / 1000,
  };
}

function drawYearBuilt(random: () => number, flavour: MarketFlavour, type: PropertyTypeKey): number {
  const [oldest, newest] = flavour.yearBuilt;
  // Newer stock is more common than old, but not overwhelmingly.
  const skew = type === 'townhouse' || type === 'house' ? 0.8 : 0.6;
  const year = Math.round(newest - (newest - oldest) * Math.pow(random(), 1 / skew) * 0.999);
  return Math.min(Math.max(year, oldest), newest);
}

function drawUnitCount(random: () => number, flavour: MarketFlavour, type: PropertyTypeKey): number {
  const [small, large] = flavour.blockUnits;
  switch (type) {
    case 'apartment':
    case 'building': {
      // Many small blocks, a few big ones.
      const u = Math.pow(random(), 2.2);
      return Math.max(small, Math.round(small + (large - small) * u));
    }
    case 'studio':
      return Math.max(4, Math.round(small + (large - small) * Math.pow(random(), 2) * 0.6));
    case 'duplex':
      return flavour.nameStyle === 'nigerian' ? intBetween(random, 2, 8) : intBetween(random, 1, 2);
    default:
      return 1;
  }
}

function concernWeight(archetype: Archetype, flavour: MarketFlavour): number {
  let weight = archetype.weight.default ?? 0;
  for (const concern of flavour.concerns) {
    weight += archetype.weight[concern as keyof Archetype['weight']] ?? 0;
  }
  return weight;
}

function drawProfile(
  random: () => number,
  countryCode: string,
  flavour: MarketFlavour,
  city: SeedCity,
  neighbourhoodRent: number,
  type: PropertyTypeKey,
): Profile {
  const archetype = pickWeighted(
    random,
    ARCHETYPES.map((entry) => [entry, concernWeight(entry, flavour)] as const).filter(
      ([, weight]) => weight > 0,
    ),
  );

  const available = new Set([
    ...CORE_CATEGORIES.map((c) => c.key),
    ...suggestedExtendedCategories(countryCode).map((c) => c.key),
  ]);
  const usable = (keys: readonly string[]) => keys.filter((key) => available.has(key));

  let strong = usable(archetype.strong);
  let weak = usable(archetype.weak);
  if (archetype.key === 'mixed') {
    const pool = [...available];
    strong = pickSome(random, pool, 2);
    weak = pickSome(
      random,
      pool.filter((key) => !strong.includes(key)),
      2,
    );
  } else {
    // Not every well-run building is well run in exactly the same ways.
    strong = pickSome(random, strong, Math.max(1, Math.min(strong.length, 2 + Math.floor(random() * 2))));
    weak = pickSome(random, weak, Math.max(weak.length > 0 ? 1 : 0, Math.min(weak.length, 1 + Math.floor(random() * 2))));
  }

  const [low, high] = archetype.baseline;
  const shift = archetype.shift
    ? archetype.shift[0] + random() * (archetype.shift[1] - archetype.shift[0])
    : (random() - 0.5) * 0.3;

  const typeRent: Partial<Record<PropertyTypeKey, number>> = {
    studio: 0.6,
    shared: 0.4,
    room: 0.3,
    house: 1.5,
    townhouse: 1.3,
    duplex: 1.7,
    bungalow: 1.3,
  };

  const rentMinor =
    flavour.rent.baseMinor *
    city.rentIndex *
    neighbourhoodRent *
    (typeRent[type] ?? 1) *
    archetype.rentFactor *
    (0.85 + random() * 0.3);

  return {
    archetype: archetype.key,
    baseline: low + random() * (high - low),
    strong,
    weak,
    recentShift: shift,
    verifiedShare: 0.15 + random() * 0.35,
    formerShare: 0.45 + random() * 0.4,
    managementChangeYear: random() < 0.15 ? intBetween(random, 2021, 2025) : null,
    rentMinor,
  };
}

/**
 * How many reviews a property has.
 *
 * Deliberately uneven. Most properties have a handful; some have a couple;
 * a few have twenty or more. Smaller cities lean lighter. The product's whole
 * premise is that properties differ in how much residents have said about
 * them, and a dataset where every property has eight reviews would hide that.
 */
function drawReviewCount(random: () => number, tier: SeedCity['tier']): number {
  const heavy = tier === 'major' ? 1.2 : tier === 'secondary' ? 1 : 0.7;
  const bucket = pickWeighted(random, [
    [[1, 1], 5 / heavy],
    [[2, 3], 22 / heavy],
    [[4, 7], 33],
    [[8, 12], 22 * heavy],
    [[13, 20], 13 * heavy],
    [[21, 34], 5 * heavy],
  ] as const);
  return intBetween(random, bucket[0], bucket[1]);
}

interface ReviewInput {
  key: string;
  index: number;
  propertyId: string;
  countryCode: string;
  flavour: MarketFlavour;
  propertyType: PropertyTypeKey;
  profile: Profile;
  available: ReadonlySet<string>;
  earliest: Date;
  used: Set<string>;
  author: string;
}

const DAY = 86_400_000;

function monthStart(date: Date, offsetMonths = 0): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offsetMonths, 1));
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

function generateReview(input: ReviewInput): Review {
  const { profile, flavour } = input;
  const random = rngFor(`review:${input.key}/${input.index}`);

  // When it was written: skewed towards the recent, reaching back years.
  const span = SAMPLE_AS_OF.getTime() - input.earliest.getTime();
  const writtenAt = new Date(
    SAMPLE_AS_OF.getTime() - Math.pow(random(), 1.7) * span - intBetween(random, 0, 5) * DAY,
  );
  const written = writtenAt < input.earliest ? new Date(input.earliest.getTime() + 20 * DAY) : writtenAt;

  const residency: ResidencyStatus = random() < profile.formerShare ? 'former' : 'current';
  const floorMonth = monthStart(input.earliest);

  let movedIn: Date;
  let movedOut: Date | null = null;
  let monthsSinceLeaving = 0;

  if (residency === 'former') {
    monthsSinceLeaving = pickWeighted(random, [
      [0, 3],
      [1, 4],
      [2, 3],
      [3, 2],
      [4, 1],
    ] as const);
    movedOut = monthStart(written, -monthsSinceLeaving);
    const tenure = pickWeighted(random, [
      [intBetween(random, 6, 12), 4],
      [intBetween(random, 13, 24), 4],
      [intBetween(random, 25, 42), 3],
      [intBetween(random, 43, 66), 1],
    ] as const);
    movedIn = monthStart(movedOut, -tenure);
    if (movedIn < floorMonth) movedIn = floorMonth;
    if (movedOut <= movedIn) movedOut = monthStart(movedIn, 1);
  } else {
    const tenureSoFar = pickWeighted(random, [
      [intBetween(random, 2, 6), 3],
      [intBetween(random, 7, 18), 4],
      [intBetween(random, 19, 48), 3],
    ] as const);
    movedIn = monthStart(written, -tenureSoFar);
    if (movedIn < floorMonth) movedIn = floorMonth;
  }

  const tenureMonths = Math.max(1, monthsBetween(movedIn, movedOut ?? monthStart(written)));

  // A review cannot predate the tenancy it describes, nor the moment the
  // dataset represents.
  const tenancyEnd = movedOut ?? movedIn;
  let createdAtDate = written < tenancyEnd ? new Date(tenancyEnd.getTime() + intBetween(random, 3, 25) * DAY) : written;
  if (createdAtDate > SAMPLE_AS_OF) createdAtDate = new Date(SAMPLE_AS_OF.getTime() - intBetween(random, 1, 9) * DAY);
  const createdAt = createdAtDate.toISOString();

  const isRecent = SAMPLE_AS_OF.getTime() - createdAtDate.getTime() < 18 * 30 * DAY;
  // Some people are harder to please than others.
  const temperament = (random() - 0.5) * 1.3;
  const mean = Math.max(1, Math.min(5, profile.baseline + (isRecent ? profile.recentShift : 0) + temperament));

  // Which categories this resident bothered to rate.
  const core = CORE_CATEGORIES.map((c) => c.key);
  const extended = [...input.available].filter((key) => !core.includes(key));
  const rated = new Set<string>([
    ...pickSome(random, core, 5 + Math.floor(random() * 4)),
    ...profile.strong.filter(() => random() < 0.85),
    ...profile.weak.filter(() => random() < 0.9),
    ...(random() < 0.45 ? pickSome(random, extended, 1 + Math.floor(random() * 2)) : []),
  ]);

  const categoryRatings: CategoryRating[] = [...rated].map((categoryKey) => {
    let categoryMean = mean;
    if (profile.strong.includes(categoryKey)) categoryMean += 1.1;
    if (profile.weak.includes(categoryKey)) categoryMean -= 1.3;
    return { categoryKey, rating: drawRating(random, categoryMean) };
  });

  const categoryAverage =
    categoryRatings.reduce((sum, rating) => sum + rating.rating, 0) / Math.max(1, categoryRatings.length);
  // Most residents rate close to their own detail. A minority write in the
  // heat of it, and their overall verdict goes all the way — which is why
  // real review sets are lumpier at one and five than a bell curve would be.
  const emphatic = random() < 0.14;
  let overallRating = drawRating(random, 0.5 * mean + 0.5 * categoryAverage, 0.8);
  if (emphatic && mean >= 3.6) overallRating = 5;
  if (emphatic && mean <= 2.7) overallRating = 1;

  const positiveTags = new Set<string>();
  const problemTags = new Set<string>();
  for (const { categoryKey, rating } of categoryRatings) {
    const pool = rating >= 4 ? POSITIVE_TAGS[categoryKey] : rating <= 2 ? PROBLEM_TAGS[categoryKey] : undefined;
    for (const tag of pool ?? []) {
      if (FORMER_ONLY_TAGS.has(tag) && residency !== 'former') continue;
      if (random() < (rating >= 4 ? 0.55 : 0.65)) (rating >= 4 ? positiveTags : problemTags).add(tag);
    }
  }
  // The heat and the cold are different problems; keep the one that fits.
  if (problemTags.has('cold_in_winter') && problemTags.has('hot_in_summer')) {
    problemTags.delete(flavour.concerns.includes('cooling') ? 'cold_in_winter' : 'hot_in_summer');
  }

  let primaryDepartureReason: string | null = null;
  const secondaryDepartureReasons: string[] = [];
  if (residency === 'former') {
    const ascending = [...categoryRatings].sort((a, b) => a.rating - b.rating);
    const worst = ascending.find((c) => c.rating <= 2 && DEPARTURE_FOR_CATEGORY[c.categoryKey]);
    primaryDepartureReason =
      worst && random() < 0.7 ? DEPARTURE_FOR_CATEGORY[worst.categoryKey]! : pick(random, PERSONAL_DEPARTURES);

    const second = ascending
      .slice(1, 3)
      .map((c) => (c.rating <= 2 ? DEPARTURE_FOR_CATEGORY[c.categoryKey] : undefined))
      .find((reason): reason is string => Boolean(reason) && reason !== primaryDepartureReason);
    if (second && random() < 0.4) secondaryDepartureReasons.push(second);
  }

  const body =
    random() < 0.18
      ? null
      : composeReviewBody({
          random,
          flavour,
          propertyType: input.propertyType,
          residency,
          tenureMonths,
          monthsSinceLeaving,
          overallRating,
          ratings: categoryRatings,
          departureReason: primaryDepartureReason,
          used: input.used,
        });

  // Rent as it was when they lived there, not as it is now.
  const yearsBefore = (SAMPLE_AS_OF.getTime() - createdAtDate.getTime()) / (365.25 * DAY);
  const reportsRent = random() < 0.58;
  const rentAmount = roundTo(
    (profile.rentMinor / Math.pow(flavour.rent.annualGrowth, yearsBefore)) * (0.9 + random() * 0.2),
    flavour.rent.roundMinor,
  );

  const spansChange =
    profile.managementChangeYear !== null &&
    movedIn.getUTCFullYear() <= profile.managementChangeYear &&
    (movedOut ?? SAMPLE_AS_OF).getUTCFullYear() >= profile.managementChangeYear;

  const wouldRecommend =
    overallRating >= 4 ? random() < 0.94 : overallRating === 3 ? random() < 0.4 : random() < 0.04;

  return {
    id: `demo-review:${input.key}/${String(input.index).padStart(3, '0')}`,
    propertyId: input.propertyId,
    authorId: input.author,
    residencyStatus: residency,
    movedInMonth: movedIn.toISOString().slice(0, 10),
    movedOutMonth: movedOut ? movedOut.toISOString().slice(0, 10) : null,
    tenureMonths,
    overallRating,
    body,
    wouldRecommend,
    rent: reportsRent ? { amountMinor: rentAmount, currencyCode: currencyFor(input.countryCode) } : null,
    rentPeriod: reportsRent ? flavour.rent.period : null,
    categoryRatings,
    positiveTags: [...positiveTags],
    problemTags: [...problemTags],
    primaryDepartureReason,
    secondaryDepartureReasons,
    noticedManagementChange: spansChange ? random() < 0.7 : random() < 0.2 ? null : false,
    // As in the legacy seed: moderator-verified or nothing. A location
    // verification is evidence of standing at a real building, and inventing
    // one for a building that does not exist would fabricate exactly what that
    // feature exists to establish.
    verificationLevel: random() < profile.verifiedShare ? 'verified_resident' : 'unverified',
    verificationId: null,
    verifiedAt: null,
    status: 'published',
    safetyFlags: [],
    helpfulCount: Math.floor(Math.pow(random(), 2.2) * (body && body.length > 280 ? 18 : 9)),
    isDemo: true,
    createdAt,
    updatedAt: createdAt,
  };
}

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

/** The market's own currency, from the same configuration the product uses. */
function currencyFor(countryCode: string): string {
  return getMarket(countryCode).defaultCurrency;
}
