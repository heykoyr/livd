import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { makeReview } from '../fixtures';
import { removeTree } from '../temp-dir';

/**
 * City and neighbourhood pages at size.
 *
 * These pages used to load every property in a place and every review of
 * every one of them, which stopped being possible somewhere past a few hundred
 * properties. What is held here is the replacement's contract: the headline
 * figures describe the whole place, the grid is one page of it in a stable
 * order, and a place with nothing in it is a not-found rather than a page of
 * zeroes.
 *
 * Run against the local adapter; `livd_place_overview` and
 * `livd_place_property_ids` (0052) implement the same contract in Postgres.
 */

const original = {
  cwd: process.cwd(),
  backend: process.env.LIVD_DATA_BACKEND,
  demo: process.env.LIVD_SHOW_DEMO_DATA,
};
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-place-pages-'));
  process.chdir(workDir);
  process.env.LIVD_DATA_BACKEND = 'local';
});

afterAll(async () => {
  process.chdir(original.cwd);
  if (original.backend === undefined) delete process.env.LIVD_DATA_BACKEND;
  else process.env.LIVD_DATA_BACKEND = original.backend;
  if (original.demo === undefined) delete process.env.LIVD_SHOW_DEMO_DATA;
  else process.env.LIVD_SHOW_DEMO_DATA = original.demo;
  await removeTree(workDir);
});

beforeEach(async () => {
  process.env.LIVD_SHOW_DEMO_DATA = 'false';
  const { resetCache } = await import('@/server/data/local/store');
  resetCache();
  await removeTree(join(workDir, '.data'));
});

/** Fourteen properties in one city, the i-th reviewed by `i % 4` people. */
async function city() {
  const { LocalRepository } = await import('@/server/data/local');
  const repository = new LocalRepository();
  const author = await repository.upsertUser({ email: `owner-${Date.now()}@example.test` });

  for (let i = 0; i < 14; i += 1) {
    const property = await repository.createProperty(
      {
        buildingName: `Block ${String.fromCharCode(65 + i)}`,
        streetAddress: null,
        neighbourhood: i % 2 === 0 ? 'Yaba' : 'Surulere',
        locality: 'Lagos',
        adminArea: 'Lagos State',
        postalCode: null,
        countryCode: 'NG',
        propertyType: 'apartment',
        coordinates: null,
      },
      author.id,
    );

    for (let r = 0; r < i % 4; r += 1) {
      const reviewer = await repository.upsertUser({ email: `r-${i}-${r}-${Date.now()}@example.test` });
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

describe('placeOverview', () => {
  it('describes the whole city, not one page of it', async () => {
    const repository = await city();
    const overview = await repository.placeOverview({ countryCode: 'NG', locality: 'Lagos' });

    expect(overview).not.toBeNull();
    expect(overview!.propertyCount).toBe(14);
    // 0+1+2+3 repeated: three full cycles, then 0+1 for the last two.
    expect(overview!.reviewCount).toBe(3 * 6 + 1);
    expect(overview!.locality).toBe('Lagos');
    expect(overview!.demoPropertyCount).toBe(0);
  });

  it('matches the spelling a URL carries', async () => {
    const repository = await city();
    const overview = await repository.placeOverview({
      countryCode: 'ng',
      locality: 'lagos',
      neighbourhood: 'yaba',
    });
    expect(overview!.propertyCount).toBe(7);
    expect(overview!.neighbourhood).toBe('Yaba');
  });

  it('is null for a place with nothing in it, so the page can 404', async () => {
    const repository = await city();
    expect(await repository.placeOverview({ countryCode: 'NG', locality: 'Nowhere' })).toBeNull();
    expect(
      await repository.placeOverview({ countryCode: 'NG', locality: 'Lagos', neighbourhood: 'Nowhere' }),
    ).toBeNull();
    expect(await repository.placeOverview({ countryCode: 'GB', locality: 'Lagos' })).toBeNull();
  });
});

describe('propertiesInPlace', () => {
  it('pages the city, most reviewed first, without losing or repeating a property', async () => {
    const repository = await city();
    const scope = { countryCode: 'NG', locality: 'Lagos' };
    const first = await repository.propertiesInPlace(scope, { page: 1, pageSize: 10 });
    const second = await repository.propertiesInPlace(scope, { page: 2, pageSize: 10 });

    expect(first.total).toBe(14);
    expect(first.pageSize).toBe(10);
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(4);

    const all = [...first.items, ...second.items];
    expect(new Set(all.map((s) => s.property.id)).size).toBe(14);

    const counts = all.map((s) => s.intelligence.reviewCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it('returns an empty page past the end rather than wrapping round', async () => {
    const repository = await city();
    const past = await repository.propertiesInPlace({ countryCode: 'NG', locality: 'Lagos' }, { page: 9 });
    expect(past.items).toEqual([]);
    expect(past.total).toBe(14);
  });
});

describe('findDuplicateProperty', () => {
  it('never offers a sample property as the building a resident is adding', async () => {
    process.env.LIVD_SHOW_DEMO_DATA = 'true';
    const { LocalRepository } = await import('@/server/data/local');
    const repository = new LocalRepository();

    // "Admiralty Heights, 8 Admiralty Way" is one of the original sample
    // properties. A resident adding a building at that address is adding a
    // real one, and must not be sent to fabricated data instead.
    const duplicate = await repository.findDuplicateProperty({
      buildingName: 'Admiralty Heights',
      streetAddress: '8 Admiralty Way',
      neighbourhood: 'Lekki Phase 1',
      locality: 'Lagos',
      adminArea: 'Lagos State',
      postalCode: null,
      countryCode: 'NG',
      propertyType: 'apartment',
      coordinates: null,
    });
    expect(duplicate).toBeNull();
  });
});
