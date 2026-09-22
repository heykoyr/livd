// @vitest-environment node
import { createHash } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { CATEGORY_DEFINITIONS, CORE_CATEGORIES, suggestedExtendedCategories } from '@/config/categories';
import { DEPARTURE_REASONS } from '@/config/departure-reasons';
import { MARKETS } from '@/config/markets';
import { TAG_DEFINITIONS } from '@/config/tags';
import { lintContent } from '@/lib/safety/content-linter';
import { generateLegacySeed, generateSeed, type SeedData } from '@/server/data/local/seed';
import {
  allocate,
  DEMO_AUTHOR_COUNT,
  generateExpandedSeed,
  SAMPLE_AS_OF,
} from '@/server/data/seed/generate';
import { SEED_GEOGRAPHY } from '@/server/data/seed/geography';
import { MAX_PER_NEIGHBOURHOOD, type SeedCity } from '@/server/data/seed/geography/types';
import { flavourFor } from '@/server/data/seed/flavour';
import { nameSpace, slotFor } from '@/server/data/seed/names';
import type { Property, Review } from '@/types/domain';

/**
 * The sample dataset.
 *
 * What is held here is what the database would otherwise enforce the hard
 * way — halfway through a seed, on a production project — plus what nothing
 * else enforces at all: that sample text passes the same linter a resident's
 * does, that the dataset is deterministic, and that growing a city never
 * changes a property that already exists.
 *
 * The dataset runs to tens of thousands of reviews, so each check collects
 * what is wrong and asserts once. A hundred thousand `expect` calls is a slow
 * test; a list of the first five problems is also a more useful failure.
 */

let full: SeedData;
let generatedProperties: Property[];
let generatedReviews: Review[];
let reviewsByProperty: Map<string, Review[]>;
let propertyById: Map<string, Property>;

beforeAll(() => {
  full = generateSeed({ scale: 'full' });
  const legacy = generateLegacySeed();
  generatedProperties = full.properties.slice(legacy.properties.length);
  generatedReviews = full.reviews.slice(legacy.reviews.length);

  reviewsByProperty = new Map();
  for (const review of full.reviews) {
    const bucket = reviewsByProperty.get(review.propertyId) ?? [];
    bucket.push(review);
    reviewsByProperty.set(review.propertyId, bucket);
  }
  propertyById = new Map(full.properties.map((p) => [p.id, p]));
}, 120_000);

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const cityKey = (countryCode: string, name: string) => `${countryCode}/${name}`;
const allCities = (): Array<{ countryCode: string; city: SeedCity }> =>
  SEED_GEOGRAPHY.flatMap((country) => country.cities.map((city) => ({ countryCode: country.code, city })));

describe('identity', () => {
  it('is deterministic', () => {
    expect(hash(generateExpandedSeed({ countries: ['NG'] }))).toBe(
      hash(generateExpandedSeed({ countries: ['NG'] })),
    );
  });

  it('never changes an existing property when a city grows', () => {
    // A city capped at five and the same city uncapped must agree about the
    // properties they share, down to every review — which is what lets the
    // loader insert only what is new.
    const small = generateExpandedSeed({ cities: ['NG/Lagos'], maxPerCity: 5 });
    const large = generateExpandedSeed({ cities: ['NG/Lagos'] });
    const largeById = new Map(large.properties.map((p) => [p.id, p]));
    const largeReviews = new Map(large.reviews.map((r) => [r.id, r]));

    expect(small.properties).toHaveLength(5);
    expect(small.properties.every((p) => hash(largeById.get(p.id)) === hash(p))).toBe(true);
    expect(small.reviews.every((r) => hash(largeReviews.get(r.id)) === hash(r))).toBe(true);
  });

  it('leaves the original sixteen exactly as they are in production', () => {
    const legacy = generateLegacySeed();
    expect(legacy.properties).toHaveLength(16);
    expect(hash(full.properties.slice(0, 16))).toBe(hash(legacy.properties));
    expect(hash(full.reviews.slice(0, legacy.reviews.length))).toBe(hash(legacy.reviews));
  });

  it('has unique ids, slugs and addresses across the whole dataset', () => {
    const ids = full.properties.map((p) => p.id);
    const slugs = full.properties.map((p) => p.slug);
    const addresses = full.properties.map((p) =>
      [p.address.countryCode, p.address.locality, p.address.streetAddress ?? '', p.address.buildingName ?? '']
        .join('|')
        .toLowerCase(),
    );
    const reviewIds = full.reviews.map((r) => r.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(new Set(reviewIds).size).toBe(reviewIds.length);
  });
});

describe('provenance', () => {
  it('marks every property and review as sample data', () => {
    expect(full.properties.every((p) => p.isDemo)).toBe(true);
    expect(full.reviews.every((r) => r.isDemo)).toBe(true);
  });

  it('writes only through the existing sample accounts', () => {
    const accounts = new Set(full.users.map((u) => u.id));
    expect(full.users.every((u) => u.email.endsWith('@demo.livd.invalid'))).toBe(true);
    expect(full.reviews.every((r) => r.authorId !== null && accounts.has(r.authorId))).toBe(true);
    expect(accounts.size).toBe(DEMO_AUTHOR_COUNT + 1);
  });

  it('puts no generated property at a street address or a postcode', () => {
    expect(generatedProperties.every((p) => p.address.streetAddress === null)).toBe(true);
    expect(generatedProperties.every((p) => p.address.postalCode === null)).toBe(true);
    expect(generatedProperties.every((p) => p.address.buildingName && p.address.neighbourhood)).toBe(true);
  });
});

describe('geography', () => {
  it('covers only markets Livd supports', () => {
    for (const country of SEED_GEOGRAPHY) {
      expect(MARKETS[country.code], country.code).toBeDefined();
      expect(() => flavourFor(country.code)).not.toThrow();
    }
  });

  it('keeps every neighbourhood near its own city', () => {
    // A transposed latitude and longitude, or a neighbourhood filed under the
    // wrong city, lands hundreds of kilometres away. Forty-five is generous
    // for a metropolitan area and fatal for a typo.
    const problems: string[] = [];
    for (const { countryCode, city } of allCities()) {
      const [, lat0, lng0] = city.neighbourhoods[0]!;
      for (const [name, lat, lng] of city.neighbourhoods) {
        const km = Math.hypot((lat - lat0) * 111, (lng - lng0) * 111 * Math.cos((lat0 * Math.PI) / 180));
        if (km > 45) problems.push(`${countryCode}/${city.name}/${name}: ${Math.round(km)}km out`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('never names a neighbourhood twice in one city', () => {
    const problems = allCities().filter(({ city }) => {
      const names = city.neighbourhoods.map(([name]) => name.toLowerCase());
      return new Set(names).size !== names.length;
    });
    expect(problems.map(({ city }) => city.name)).toEqual([]);
  });

  it('places each property within its neighbourhood, at the precision the database stores', () => {
    const cities = new Map(allCities().map(({ countryCode, city }) => [cityKey(countryCode, city.name), city]));
    const problems: string[] = [];
    const offGrid = (value: number) => Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-6;

    for (const property of generatedProperties) {
      const city = cities.get(cityKey(property.address.countryCode, property.address.locality))!;
      const [, lat, lng] = city.neighbourhoods.find(([name]) => name === property.address.neighbourhood)!;
      const { latitude, longitude } = property.coordinates!;
      if (offGrid(latitude) || offGrid(longitude)) problems.push(`${property.id}: finer than 3dp`);
      const metres = Math.hypot(
        (latitude - lat) * 111_320,
        (longitude - lng) * 111_320 * Math.cos((lat * Math.PI) / 180),
      );
      // The spread, plus the rounding of both points.
      if (metres > (city.spreadMeters ?? 450) + 160) problems.push(`${property.id}: ${Math.round(metres)}m out`);
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it('gives each city the coverage its tier promises', () => {
    const floor = { major: 100, secondary: 45, smaller: 15 } as const;
    const counts = new Map<string, number>();
    for (const p of full.properties) {
      const key = cityKey(p.address.countryCode, p.address.locality);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const short = allCities()
      .filter(({ countryCode, city }) => (counts.get(cityKey(countryCode, city.name)) ?? 0) < floor[city.tier])
      .map(({ countryCode, city }) => cityKey(countryCode, city.name));
    expect(short).toEqual([]);
  });

  it('spreads a city across its neighbourhoods rather than piling into one', () => {
    const problems: string[] = [];
    for (const { countryCode, city } of allCities()) {
      const allocation = allocate(city);
      const name = cityKey(countryCode, city.name);
      if (allocation.reduce((a, b) => a + b, 0) !== city.properties) problems.push(`${name}: does not sum`);
      if (Math.max(...allocation) > MAX_PER_NEIGHBOURHOOD) problems.push(`${name}: over the cap`);
      // No neighbourhood holds much more than its share: under three tenths
      // of a city with many, and at most twice an even split with few.
      const ceiling = Math.max(0.3, 2 / city.neighbourhoods.length);
      if (city.properties >= 40 && Math.max(...allocation) / city.properties > ceiling) {
        problems.push(`${name}: one neighbourhood dominates`);
      }
      if (city.properties >= city.neighbourhoods.length && Math.min(...allocation) < 1) {
        problems.push(`${name}: an empty neighbourhood`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('has room in the name bank for every city, with space to grow', () => {
    const problems = SEED_GEOGRAPHY.flatMap((country) => {
      const capacity = nameSpace(flavourFor(country.code).nameStyle);
      return country.cities
        .filter((city) => slotFor(city.neighbourhoods.length - 1, MAX_PER_NEIGHBOURHOOD - 1) >= capacity)
        .map((city) => `${country.code}/${city.name}: needs more than ${capacity} names`);
    });
    expect(problems).toEqual([]);
  });
});

describe('reviews', () => {
  it('satisfy every constraint the reviews table enforces', () => {
    const problems: string[] = [];
    const tenancies = new Set<string>();
    for (const review of generatedReviews) {
      const fail = (what: string) => problems.push(`${review.id}: ${what}`);
      if (!review.movedInMonth.endsWith('-01')) fail('moved in mid-month');
      if (review.movedOutMonth && !review.movedOutMonth.endsWith('-01')) fail('moved out mid-month');
      if (review.movedOutMonth && review.movedOutMonth < review.movedInMonth) fail('left before arriving');
      if ((review.residencyStatus === 'former') !== (review.movedOutMonth !== null)) fail('residency dates');
      if (review.tenureMonths < 1) fail('tenure');
      if (review.overallRating < 1 || review.overallRating > 5) fail('overall rating');
      if ((review.rent === null) !== (review.rentPeriod === null)) fail('rent incomplete');
      if (review.body && review.body.length > 4000) fail('body too long');
      if (review.helpfulCount < 0) fail('helpful count');

      // reviews_one_per_tenancy: one per person, per property, per move-in year.
      const tenancy = `${review.propertyId}|${review.authorId}|${review.movedInMonth.slice(0, 4)}`;
      if (tenancies.has(tenancy)) fail('second review of one tenancy');
      tenancies.add(tenancy);
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it('are dated in the past, after the tenancy they describe', () => {
    const asOf = SAMPLE_AS_OF.toISOString();
    const problems: string[] = [];
    for (const review of generatedReviews) {
      if (review.createdAt > asOf) problems.push(`${review.id}: after the dataset's own date`);
      if (review.createdAt.slice(0, 10) < (review.movedOutMonth ?? review.movedInMonth)) {
        problems.push(`${review.id}: written before the tenancy it describes`);
      }
      if (propertyById.get(review.propertyId)!.createdAt > review.createdAt) {
        problems.push(`${review.id}: written before the property was listed`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it('use only categories, tags and departure reasons the product defines, where they apply', () => {
    const tags = new Set(TAG_DEFINITIONS.map((t) => t.key));
    const departures = new Set(DEPARTURE_REASONS.map((d) => d.key));
    const categories = new Set(CATEGORY_DEFINITIONS.map((c) => c.key));
    const applicableIn = new Map<string, Set<string>>();
    const problems: string[] = [];

    for (const review of generatedReviews) {
      const country = propertyById.get(review.propertyId)!.address.countryCode;
      let applicable = applicableIn.get(country);
      if (!applicable) {
        applicable = new Set([
          ...CORE_CATEGORIES.map((c) => c.key),
          ...suggestedExtendedCategories(country).map((c) => c.key),
        ]);
        applicableIn.set(country, applicable);
      }
      const fail = (what: string) => problems.push(`${review.id}: ${what}`);

      for (const rating of review.categoryRatings) {
        if (!categories.has(rating.categoryKey)) fail(`unknown category ${rating.categoryKey}`);
        if (!applicable.has(rating.categoryKey)) fail(`${rating.categoryKey} is not offered in ${country}`);
        if (rating.rating < 1 || rating.rating > 5) fail('category rating out of range');
      }
      for (const tag of [...review.positiveTags, ...review.problemTags]) {
        if (!tags.has(tag)) fail(`unknown tag ${tag}`);
      }
      if (review.residencyStatus === 'current') {
        if (review.primaryDepartureReason !== null) fail('a current resident with a reason for leaving');
        if (review.positiveTags.includes('deposit_returned')) fail('current resident, deposit returned');
        if (review.problemTags.includes('deposit_withheld')) fail('current resident, deposit withheld');
      } else if (!departures.has(review.primaryDepartureReason ?? '')) {
        fail(`unknown departure reason ${review.primaryDepartureReason}`);
      }
      for (const reason of review.secondaryDepartureReasons) {
        if (!departures.has(reason)) fail(`unknown departure reason ${reason}`);
        if (reason === review.primaryDepartureReason) fail('secondary reason repeats the primary');
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it('never claim a location verification nobody performed', () => {
    const invented = full.reviews.filter(
      (review) =>
        !['unverified', 'verified_resident'].includes(review.verificationLevel) ||
        review.verificationId !== null,
    );
    expect(invented).toHaveLength(0);
  });

  it('vary in number, so some properties are well documented and some barely', () => {
    const counts = generatedProperties.map((p) => reviewsByProperty.get(p.id)?.length ?? 0);
    const share = (test: (n: number) => boolean) => counts.filter(test).length / counts.length;

    expect(share((n) => n <= 3)).toBeGreaterThan(0.15);
    expect(share((n) => n >= 4 && n <= 7)).toBeGreaterThan(0.2);
    expect(share((n) => n >= 8 && n <= 12)).toBeGreaterThan(0.12);
    expect(share((n) => n >= 13 && n <= 20)).toBeGreaterThan(0.06);
    expect(share((n) => n > 20)).toBeGreaterThan(0.02);
    expect(share((n) => n > 20)).toBeLessThan(0.12);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
  });

  it('are neither uniformly glowing nor uniformly damning', () => {
    const share = (rating: number) =>
      generatedReviews.filter((r) => r.overallRating === rating).length / generatedReviews.length;
    for (const rating of [1, 2, 3, 4, 5]) expect(share(rating), `${rating}/5`).toBeGreaterThan(0.02);
    expect(share(3) + share(4)).toBeLessThan(0.8);
  });
});

describe('prose', () => {
  it('passes the content linter real reviews go through, without a block or a flag', () => {
    const failures: string[] = [];
    for (const review of generatedReviews) {
      if (!review.body) continue;
      const result = lintContent(review.body);
      if (!result.ok || result.flags.length > 0) failures.push(`${result.flagCodes.join(',')}: ${review.body}`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('contains no digits, so nothing can read as a unit number or a phone number', () => {
    const withDigits = generatedReviews.filter((r) => r.body && /\d/.test(r.body)).map((r) => r.body);
    expect(withDigits.slice(0, 3)).toEqual([]);
  });

  it('never shows the same body twice on one property page', () => {
    const repeated: string[] = [];
    for (const [propertyId, reviews] of reviewsByProperty) {
      if (!propertyId.startsWith('demo-prop:')) continue;
      // Compact one-line verdicts may recur; anything longer may not.
      const long = reviews
        .map((r) => r.body)
        .filter((body): body is string => body !== null && body.length > 80);
      if (new Set(long).size !== long.length) repeated.push(propertyId);
    }
    expect(repeated.slice(0, 5)).toEqual([]);
  });

  it('leaves some reviews as ratings alone, as residents do', () => {
    const withoutBody = generatedReviews.filter((r) => r.body === null).length / generatedReviews.length;
    expect(withoutBody).toBeGreaterThan(0.08);
    expect(withoutBody).toBeLessThan(0.3);
  });
});

describe('the local development store', () => {
  it('holds the original sixteen and a few properties per city', () => {
    const local = generateSeed();
    const cities = allCities().length;
    expect(hash(local.properties.slice(0, 16))).toBe(hash(generateLegacySeed().properties));
    expect(local.properties.length).toBeLessThanOrEqual(16 + cities * 3);
    expect(local.properties.length).toBeGreaterThan(16 + cities * 2);
  });
});
