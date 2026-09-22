import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { removeTree } from '../temp-dir';

/**
 * The sitemap, with sample data switched on.
 *
 * Sample property pages have always been `noindex` and left out of the
 * sitemap. At sixteen properties that was the whole story; at several
 * thousand, the cities and neighbourhoods they sit in are pages too, and a
 * place made only of invented properties is just as fabricated as the
 * properties themselves. So a place reaches the sitemap when a real property
 * is in it, and not before.
 */

const original = {
  cwd: process.cwd(),
  backend: process.env.LIVD_DATA_BACKEND,
  demo: process.env.LIVD_SHOW_DEMO_DATA,
};
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-sitemap-'));
  process.chdir(workDir);
  process.env.LIVD_DATA_BACKEND = 'local';
  // The sample dataset is loaded, as it is in production.
  process.env.LIVD_SHOW_DEMO_DATA = 'true';
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
  const { resetCache } = await import('@/server/data/local/store');
  resetCache();
  await removeTree(join(workDir, '.data'));
});

async function urls() {
  const { default: sitemap } = await import('@/app/sitemap');
  const { SITE } = await import('@/config/site');
  return { site: SITE.url, found: (await sitemap()).map((entry) => entry.url) };
}

describe('sitemap', () => {
  it('advertises no place that exists only as sample data', async () => {
    const { found } = await urls();

    // The seeded dataset covers Lagos, London and many more, and every one of
    // those properties is sample data.
    expect(found.some((url) => url.includes('/places/ng'))).toBe(false);
    expect(found.some((url) => url.includes('/places/gb/london'))).toBe(false);
    expect(found.some((url) => url.includes('/property/'))).toBe(false);

    // The marketing surface is still there.
    expect(found.some((url) => url.endsWith('/places'))).toBe(true);
    expect(found.some((url) => url.endsWith('/why-livd'))).toBe(true);
  });

  it('advertises a place as soon as a real property is in it', async () => {
    const { LocalRepository } = await import('@/server/data/local');
    const repository = new LocalRepository();
    const author = await repository.upsertUser({ email: `owner-${Date.now()}@example.test` });

    await repository.createProperty(
      {
        buildingName: 'A Real Building',
        streetAddress: '1 Real Street',
        neighbourhood: 'Yaba',
        locality: 'Lagos',
        adminArea: 'Lagos State',
        postalCode: null,
        countryCode: 'NG',
        propertyType: 'apartment',
        coordinates: null,
      },
      author.id,
    );

    const { site, found } = await urls();
    expect(found).toContain(`${site}/places/ng`);
    expect(found).toContain(`${site}/places/ng/lagos`);
    expect(found).toContain(`${site}/places/ng/lagos/yaba`);
    // Still no sample property, and still no city that holds only sample ones.
    expect(found.some((url) => url.includes('/places/gb/london'))).toBe(false);
  });
});
