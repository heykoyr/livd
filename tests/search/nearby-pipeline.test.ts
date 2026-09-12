import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The proximity pipeline, from a property's coordinates to a distance.
 *
 * These assert the two facts that together produced the original defect:
 * a property with no coordinate cannot be returned by a proximity query, and
 * nothing anywhere counted how many of those there were. The first is correct
 * and must stay correct — a null position cannot be measured against anything,
 * and inventing one would be worse than omitting it. The second is what turns
 * the resulting silence into a sentence a person can act on.
 */

const original = {
  cwd: process.cwd(),
  backend: process.env.LIVD_DATA_BACKEND,
  demo: process.env.LIVD_SHOW_DEMO_DATA,
};
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-nearby-'));
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

/** Lekki Phase 1, Lagos. */
const ORIGIN = { latitude: 6.437, longitude: 3.473 };

async function seeded() {
  const { LocalRepository } = await import('@/server/data/local');
  const repository = new LocalRepository();
  const author = await repository.upsertUser({ email: `w-${Date.now()}@example.test` });

  const make = (
    buildingName: string,
    coordinates: { latitude: number; longitude: number } | null,
  ) =>
    repository.createProperty(
      {
        buildingName,
        streetAddress: `1 ${buildingName} Road`,
        neighbourhood: null,
        locality: 'Lagos',
        adminArea: 'Lagos',
        postalCode: null,
        countryCode: 'NG',
        propertyType: 'apartment',
        coordinates,
      },
      author.id,
    );

  return {
    repository,
    // Right on top of the origin.
    here: await make('Admiralty Heights', ORIGIN),
    // ~1.2 km north: outside 500 m, inside 3 km.
    nearby: await make('Cardinal Court', { latitude: 6.448, longitude: 3.473 }),
    // No coordinates at all — the shape of the two real properties in
    // production, and the whole cause of the original failure.
    unplaced: await make('Mama House', null),
    // Another country, comfortably out of range.
    far: await repository.createProperty(
      {
        buildingName: 'Morning Lane Flats',
        streetAddress: '14 Morning Lane',
        neighbourhood: 'Hackney',
        locality: 'London',
        adminArea: null,
        postalCode: null,
        countryCode: 'GB',
        propertyType: 'apartment',
        coordinates: { latitude: 51.546, longitude: -0.052 },
      },
      author.id,
    ),
  };
}

const names = (rows: Array<{ summary: { property: { address: { buildingName: string | null } } } }>) =>
  rows.map((row) => row.summary.property.address.buildingName);

describe('propertiesNear', () => {
  it('returns what is inside the radius and nothing outside it', async () => {
    const { repository } = await seeded();

    const tight = await repository.propertiesNear({ ...ORIGIN, radiusMeters: 500 });
    expect(names(tight)).toEqual(['Admiralty Heights']);

    const wide = await repository.propertiesNear({ ...ORIGIN, radiusMeters: 3000 });
    expect(names(wide)).toEqual(['Admiralty Heights', 'Cardinal Court']);
  });

  it('cannot return a property with no coordinates, at any radius', async () => {
    // This is the defect, stated as a property of the system rather than a
    // bug: it is correct, and it is why the interface has to say so. The
    // fix for the property is a coordinate, not a wider search.
    const { repository } = await seeded();

    for (const radiusMeters of [500, 1000, 3000, 20000]) {
      const found = await repository.propertiesNear({ ...ORIGIN, radiusMeters });
      expect(names(found), `radius ${radiusMeters}`).not.toContain('Mama House');
    }
  });

  it('orders by distance, nearest first', async () => {
    const { repository } = await seeded();
    const found = await repository.propertiesNear({ ...ORIGIN, radiusMeters: 3000 });

    expect(found[0]!.distanceMeters).toBeLessThan(found[1]!.distanceMeters);
  });

  it('rounds distance to ten metres, so it is not a range-finder', async () => {
    const { repository } = await seeded();
    const found = await repository.propertiesNear({ ...ORIGIN, radiusMeters: 3000 });

    for (const row of found) {
      expect(row.distanceMeters % 10).toBe(0);
    }
  });

  it('leaves another country out of a local radius', async () => {
    const { repository } = await seeded();
    const found = await repository.propertiesNear({ ...ORIGIN, radiusMeters: 20000 });

    expect(names(found)).not.toContain('Morning Lane Flats');
  });

  it('refuses an impossible origin rather than guessing', async () => {
    const { repository } = await seeded();

    expect(
      await repository.propertiesNear({ latitude: 91, longitude: 0, radiusMeters: 3000 }),
    ).toEqual([]);
    expect(
      await repository.propertiesNear({ latitude: 0, longitude: 181, radiusMeters: 3000 }),
    ).toEqual([]);
  });
});

describe('unlocatablePropertyCount', () => {
  it('counts exactly the properties a proximity query cannot see', async () => {
    const { repository } = await seeded();

    expect(await repository.unlocatablePropertyCount()).toBe(1);
  });

  it('scopes to a country', async () => {
    const { repository } = await seeded();

    expect(await repository.unlocatablePropertyCount('NG')).toBe(1);
    expect(await repository.unlocatablePropertyCount('GB')).toBe(0);
  });

  it('accepts a lowercase code, because a header carries one', async () => {
    const { repository } = await seeded();
    expect(await repository.unlocatablePropertyCount('ng')).toBe(1);
  });

  it('is zero once every property has a position', async () => {
    const { LocalRepository } = await import('@/server/data/local');
    const repository = new LocalRepository();
    const author = await repository.upsertUser({ email: `w2-${Date.now()}@example.test` });

    await repository.createProperty(
      {
        buildingName: 'Placed',
        streetAddress: '1 Placed Road',
        neighbourhood: null,
        locality: 'Lagos',
        adminArea: null,
        postalCode: null,
        countryCode: 'NG',
        propertyType: 'apartment',
        coordinates: ORIGIN,
      },
      author.id,
    );

    expect(await repository.unlocatablePropertyCount()).toBe(0);
  });
});
