import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { makeReview } from '../fixtures';

/**
 * Neighbourhood discovery.
 *
 * The level Livd claimed and did not have. What these tests hold is not the
 * shape of the query but the promises the discovery surface makes on top of
 * it: that a listing is bounded by what it asked for, that it is ranked by the
 * evidence behind each area rather than alphabetically, and that a scoped read
 * returns that neighbourhood's properties and nobody else's.
 *
 * They run against the local adapter, which is the code path a fresh clone
 * gets. The Supabase adapter performs the identical aggregation against the
 * same columns.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND, demo: process.env.LIVD_SHOW_DEMO_DATA };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-neighbourhoods-'));
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

interface Spec {
  building: string;
  neighbourhood: string | null;
  locality: string;
  countryCode: string;
  reviews: number;
}

/**
 * Five properties across two countries, three cities and four named areas —
 * plus one carrying no neighbourhood at all, which is the common case in
 * markets whose addresses do not use them.
 */
const SPECS: Spec[] = [
  { building: 'Admiralty Heights', neighbourhood: 'Lekki Phase 1', locality: 'Lagos', countryCode: 'NG', reviews: 5 },
  { building: 'Yaba Court', neighbourhood: 'Yaba', locality: 'Lagos', countryCode: 'NG', reviews: 2 },
  { building: 'Wuse Towers', neighbourhood: 'Wuse 2', locality: 'Abuja', countryCode: 'NG', reviews: 3 },
  { building: 'Morning Lane Flats', neighbourhood: 'Hackney', locality: 'London', countryCode: 'GB', reviews: 4 },
  { building: 'Plain Address House', neighbourhood: null, locality: 'London', countryCode: 'GB', reviews: 9 },
];

async function seeded() {
  const { LocalRepository } = await import('@/server/data/local');
  const repository = new LocalRepository();

  const author = await repository.upsertUser({ email: `writer-${Date.now()}@example.test` });

  for (const spec of SPECS) {
    const property = await repository.createProperty(
      {
        buildingName: spec.building,
        streetAddress: `1 ${spec.building} Road`,
        neighbourhood: spec.neighbourhood,
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
      const template = makeReview();
      await repository.createReview(
        {
          propertyId: property.id,
          residencyStatus: 'former',
          movedInMonth: template.movedInMonth,
          movedOutMonth: template.movedOutMonth,
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

describe('listNeighbourhoods', () => {
  it('only reports areas an address actually named', async () => {
    const repository = await seeded();
    const found = await repository.listNeighbourhoods();

    expect(found.map((entry) => entry.neighbourhood).sort()).toEqual([
      'Hackney',
      'Lekki Phase 1',
      'Wuse 2',
      'Yaba',
    ]);

    // The London property with no neighbourhood contributes to no area. Livd
    // has no gazetteer to fall back on and must not invent one.
    expect(found.some((entry) => entry.neighbourhood === 'London')).toBe(false);
  });

  it('ranks by the evidence behind each area, not alphabetically', async () => {
    const repository = await seeded();
    const found = await repository.listNeighbourhoods();

    expect(found.map((entry) => entry.neighbourhood)).toEqual([
      'Lekki Phase 1', // 5
      'Hackney', // 4
      'Wuse 2', // 3
      'Yaba', // 2
    ]);
    expect(found.map((entry) => entry.reviewCount)).toEqual([5, 4, 3, 2]);
  });

  it('scopes to a country', async () => {
    const repository = await seeded();
    const found = await repository.listNeighbourhoods({ countryCode: 'NG' });

    expect(found.every((entry) => entry.countryCode === 'NG')).toBe(true);
    expect(found.map((entry) => entry.neighbourhood)).toEqual(['Lekki Phase 1', 'Wuse 2', 'Yaba']);
  });

  it('accepts a lowercase country code, because a URL segment is lowercase', async () => {
    const repository = await seeded();
    expect(await repository.listNeighbourhoods({ countryCode: 'ng' })).toEqual(
      await repository.listNeighbourhoods({ countryCode: 'NG' }),
    );
  });

  it('scopes to a city', async () => {
    const repository = await seeded();
    const found = await repository.listNeighbourhoods({ countryCode: 'NG', locality: 'Lagos' });

    expect(found.map((entry) => entry.neighbourhood)).toEqual(['Lekki Phase 1', 'Yaba']);
    // Abuja is in the same country and must not leak into a city-scoped read.
    expect(found.some((entry) => entry.locality === 'Abuja')).toBe(false);
  });

  it('honours the limit, so a discovery section cannot walk the world', async () => {
    const repository = await seeded();
    const found = await repository.listNeighbourhoods({ limit: 2 });

    expect(found).toHaveLength(2);
    // The limit takes the strongest areas rather than the first two it saw.
    expect(found.map((entry) => entry.neighbourhood)).toEqual(['Lekki Phase 1', 'Hackney']);
  });

  it('emits a URL that resolves to the neighbourhood page', async () => {
    const repository = await seeded();
    const [top] = await repository.listNeighbourhoods({ countryCode: 'NG', limit: 1 });

    expect(top!.href).toBe('/places/ng/lagos/lekki%20phase%201');
  });
});

describe('propertiesInNeighbourhood', () => {
  it('returns that area and nothing around it', async () => {
    const repository = await seeded();
    const found = await repository.propertiesInNeighbourhood('NG', 'Lagos', 'Lekki Phase 1');

    expect(found.map((summary) => summary.property.address.buildingName)).toEqual([
      'Admiralty Heights',
    ]);
  });

  it('matches the spelling a URL carries rather than the one stored', async () => {
    const repository = await seeded();
    const found = await repository.propertiesInNeighbourhood('ng', 'lagos', 'lekki phase 1');

    expect(found).toHaveLength(1);
  });

  it('returns nothing for an area that does not exist, rather than the whole city', async () => {
    const repository = await seeded();

    // The page turns an empty list into a not-found, so a wrong URL must not
    // silently widen to the city above it.
    expect(await repository.propertiesInNeighbourhood('NG', 'Lagos', 'Nowhere')).toEqual([]);
    expect(await repository.propertiesInNeighbourhood('GB', 'London', 'Lekki Phase 1')).toEqual([]);
  });
});
