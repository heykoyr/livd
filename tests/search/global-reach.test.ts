import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hasSearchIntent, parseSearchFilters } from '@/lib/validation/search';
import type { SearchFilters } from '@/types/domain';

/**
 * Search reaches the whole world, and a local default may only reorder it.
 *
 * Livd exists for people who are moving, so the case that must never break is
 * somebody in Lagos researching a flat in London. The way it breaks is not a
 * deliberate decision — it is a country arriving as a filter because a filter
 * and a preference were the same field. These tests assert the behaviour that
 * separation exists to guarantee:
 *
 *   - a preference never changes which properties come back, only their order
 *   - an exact name match outranks a property with far more reviews
 *   - the searcher's own country filter wins over any guess about them
 *   - a bare `/search` asks for nothing and so runs no query at all
 */

const original = {
  cwd: process.cwd(),
  backend: process.env.LIVD_DATA_BACKEND,
  demo: process.env.LIVD_SHOW_DEMO_DATA,
};
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-search-'));
  process.chdir(workDir);
  process.env.LIVD_DATA_BACKEND = 'local';
  process.env.LIVD_SHOW_DEMO_DATA = 'false';
});

afterAll(async () => {
  process.chdir(original.cwd);
  if (original.backend === undefined) delete process.env.LIVD_DATA_BACKEND;
  else process.env.LIVD_DATA_BACKEND = original.backend;
  if (original.demo === undefined) delete process.env.LIVD_SHOW_DEMO_DATA;
  else process.env.LIVD_SHOW_DEMO_DATA = original.demo;
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const { resetCache } = await import('@/server/data/local/store');
  resetCache();
  await rm(join(workDir, '.data'), { recursive: true, force: true });
});

/** Two buildings of the same name in different countries, plus a loud decoy. */
const SPECS = [
  {
    buildingName: 'Cardinal Court',
    locality: 'Abuja',
    countryCode: 'NG',
    reviews: 2,
  },
  {
    buildingName: 'Cardinal Court',
    locality: 'Manchester',
    countryCode: 'GB',
    reviews: 3,
  },
  {
    // The decoy: far more reviews, and only a weak textual relationship to a
    // search for "Cardinal Court".
    buildingName: 'London House',
    locality: 'London',
    countryCode: 'GB',
    reviews: 20,
  },
];

async function seeded() {
  const { LocalRepository } = await import('@/server/data/local');
  const repository = new LocalRepository();
  const author = await repository.upsertUser({ email: `w-${Date.now()}@example.test` });

  for (const spec of SPECS) {
    const property = await repository.createProperty(
      {
        buildingName: spec.buildingName,
        streetAddress: `1 ${spec.buildingName} Road`,
        neighbourhood: null,
        locality: spec.locality,
        adminArea: null,
        postalCode: null,
        countryCode: spec.countryCode,
        propertyType: 'apartment',
        coordinates: null,
      },
      author.id,
    );

    for (let index = 0; index < spec.reviews; index += 1) {
      const reviewer = await repository.upsertUser({
        email: `r-${property.id}-${index}-${Date.now()}@example.test`,
      });
      await repository.createReview(
        {
          propertyId: property.id,
          residencyStatus: 'former',
          movedInMonth: '2023-01-01',
          movedOutMonth: '2025-01-01',
          overallRating: 4,
          categoryRatings: [],
          positiveTags: [],
          problemTags: [],
          primaryDepartureReason: null,
          secondaryDepartureReasons: [],
          noticedManagementChange: null,
          body: null,
          wouldRecommend: true,
          rentAmountMinor: null,
          rentCurrency: null,
          rentPeriod: null,
          status: 'published',
          safetyFlags: [],
          verificationId: null,
        },
        reviewer.id,
      );
    }
  }

  return repository;
}

function filtersFor(query: string, overrides: Partial<SearchFilters> = {}): SearchFilters {
  return { ...parseSearchFilters({ q: query }), ...overrides };
}

const label = (item: { property: { address: { buildingName: string | null; countryCode: string } } }) =>
  `${item.property.address.buildingName} ${item.property.address.countryCode}`;

describe('a preference reorders and never narrows', () => {
  it('returns the same set with and without a preference', async () => {
    const repository = await seeded();
    const filters = filtersFor('Cardinal Court');

    const neutral = await repository.searchProperties(filters);
    const nigerian = await repository.searchProperties(filters, { preferCountryCode: 'NG' });
    const british = await repository.searchProperties(filters, { preferCountryCode: 'GB' });

    expect(nigerian.total).toBe(neutral.total);
    expect(british.total).toBe(neutral.total);

    const set = (r: typeof neutral) => r.items.map(label).sort();
    expect(set(nigerian)).toEqual(set(neutral));
    expect(set(british)).toEqual(set(neutral));
  });

  it('leads with the searcher’s own country among equal matches', async () => {
    const repository = await seeded();
    const filters = filtersFor('Cardinal Court');

    const nigerian = await repository.searchProperties(filters, { preferCountryCode: 'NG' });
    const british = await repository.searchProperties(filters, { preferCountryCode: 'GB' });

    expect(label(nigerian.items[0]!)).toBe('Cardinal Court NG');
    expect(label(british.items[0]!)).toBe('Cardinal Court GB');
  });

  it('still shows the other country’s match, further down', async () => {
    // The whole point. A person in Lagos researching Manchester must be able
    // to see the Manchester one.
    const repository = await seeded();
    const nigerian = await repository.searchProperties(filtersFor('Cardinal Court'), {
      preferCountryCode: 'NG',
    });

    expect(nigerian.items.map(label)).toContain('Cardinal Court GB');
  });

  it('reaches another country entirely when that is what was typed', async () => {
    const repository = await seeded();
    const found = await repository.searchProperties(filtersFor('Manchester'), {
      preferCountryCode: 'NG',
    });

    expect(found.items.map(label)).toContain('Cardinal Court GB');
  });
});

describe('relevance is not a popularity chart', () => {
  it('ranks an exact name match above a property with ten times the reviews', async () => {
    const repository = await seeded();
    const found = await repository.searchProperties(filtersFor('Cardinal Court'));

    // "London House" has 20 reviews to Cardinal Court's 2 and 3. Relevance
    // decides the order; review count only breaks ties.
    expect(label(found.items[0]!)).toMatch(/^Cardinal Court/);
    expect(found.items.findIndex((item) => label(item) === 'London House GB')).not.toBe(0);
  });

  it('orders by review count only when relevance is equal', async () => {
    const repository = await seeded();
    const found = await repository.searchProperties(filtersFor('Cardinal Court'));
    const names = found.items.map(label);

    // Both Cardinal Courts match identically, so the better-evidenced one
    // leads when no country is preferred — GB has three reviews to NG's two.
    expect(names.indexOf('Cardinal Court GB')).toBeLessThan(names.indexOf('Cardinal Court NG'));
  });
});

describe('an explicit country filter beats any guess', () => {
  it('narrows to the country the searcher named', async () => {
    const repository = await seeded();
    const filters = filtersFor('Cardinal Court', { countryCode: 'GB' });

    const found = await repository.searchProperties(filters, { preferCountryCode: 'NG' });

    expect(found.items.map(label)).toEqual(['Cardinal Court GB']);
  });
});

describe('a bare search asks for nothing', () => {
  it('has no intent, so the page runs no query', () => {
    expect(hasSearchIntent(parseSearchFilters({}))).toBe(false);
    expect(hasSearchIntent(parseSearchFilters({ q: '   ' }))).toBe(false);
    expect(hasSearchIntent(parseSearchFilters({ page: '3' }))).toBe(false);
  });

  it('treats a query as intent', () => {
    expect(hasSearchIntent(parseSearchFilters({ q: 'lekki' }))).toBe(true);
  });

  it('treats a filter as intent, so a city link still browses', () => {
    // Explore links to `/search?country=NG&locality=Lagos`. That is a
    // deliberate request to browse a place and must keep working.
    expect(hasSearchIntent(parseSearchFilters({ country: 'NG' }))).toBe(true);
    expect(hasSearchIntent(parseSearchFilters({ locality: 'Lagos' }))).toBe(true);
    expect(hasSearchIntent(parseSearchFilters({ verified: '1' }))).toBe(true);
    expect(hasSearchIntent(parseSearchFilters({ minReviews: '5' }))).toBe(true);
  });
});
