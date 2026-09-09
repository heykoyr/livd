import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Account deletion.
 *
 * The promise on all three legal pages is specific: the account goes, and
 * published reviews stay, permanently severed from their author. Until
 * migration 0017 the schema did the opposite — `author_id` cascaded, so
 * deleting a profile deleted the reviews, the category ratings, the departure
 * reasons and the tags with it.
 *
 * These tests assert the promise rather than the implementation: what a
 * property page still shows afterwards, and what can no longer be traced to a
 * person. They run against the local adapter, which is the same code path a
 * fresh clone gets; Postgres enforces the identical outcome through the foreign
 * keys in 0017, which `tests/account/deletion-parity.test.ts` pins to this file.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-deletion-'));
  process.chdir(workDir);
  process.env.LIVD_DATA_BACKEND = 'local';
  process.env.LIVD_SHOW_DEMO_DATA = 'false';
});

afterAll(async () => {
  process.chdir(original.cwd);
  if (original.backend === undefined) delete process.env.LIVD_DATA_BACKEND;
  else process.env.LIVD_DATA_BACKEND = original.backend;
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const { resetCache } = await import('@/server/data/local/store');
  resetCache();
  await rm(join(workDir, '.data'), { recursive: true, force: true });
});

/** A resident with a published review, a shortlist and a location check. */
async function scenario() {
  const { LocalRepository } = await import('@/server/data/local');
  const repository = new LocalRepository();

  const leaver = await repository.upsertUser({ email: `leaver-${Date.now()}@example.test` });
  const stayer = await repository.upsertUser({ email: `stayer-${Date.now()}@example.test` });

  const property = await repository.createProperty(
    {
      buildingName: 'Ashfield Court',
      streetAddress: '61 Example Street',
      neighbourhood: null,
      locality: 'London',
      adminArea: null,
      postalCode: null,
      countryCode: 'GB',
      propertyType: 'apartment',
      coordinates: { latitude: 51.546, longitude: -0.052 },
    },
    leaver.id,
  );

  const draft = (movedIn: string) => ({
    propertyId: property.id,
    residencyStatus: 'former' as const,
    movedInMonth: movedIn,
    movedOutMonth: '2025-06-01',
    overallRating: 4,
    categoryRatings: [{ categoryKey: 'noise', rating: 4 }],
    positiveTags: ['quiet'],
    problemTags: [],
    primaryDepartureReason: 'relocation',
    secondaryDepartureReasons: [],
    noticedManagementChange: null,
    body: 'The building was well kept and the neighbours were considerate throughout.',
    wouldRecommend: true,
    rentAmountMinor: null,
    rentCurrency: null,
    rentPeriod: null,
    status: 'published' as const,
    safetyFlags: [],
    verificationId: null,
  });

  const leaverReview = await repository.createReview(draft('2023-01-01'), leaver.id);
  const stayerReview = await repository.createReview(draft('2022-01-01'), stayer.id);

  await repository.saveProperty(leaver.id, property.id);
  await repository.verifyPropertyLocation({
    userId: leaver.id,
    propertyId: property.id,
    latitude: 51.546,
    longitude: -0.052,
    accuracyMeters: 20,
    capturedAtMs: Date.now(),
  });

  return { repository, leaver, stayer, property, leaverReview, stayerReview };
}

describe('what survives a deletion', () => {
  it('leaves the review on the property page', async () => {
    const { repository, leaver, property } = await scenario();

    const before = await repository.listPublicReviews(property.id);
    await repository.deleteAccount(leaver.id);
    const after = await repository.listPublicReviews(property.id);

    // The promise, stated as a test: the record the next renter relies on is
    // unchanged in size and content.
    expect(after.total).toBe(before.total);
    expect(after.items.map((r) => r.body).sort()).toEqual(before.items.map((r) => r.body).sort());
  });

  it('keeps the review counting toward the property score', async () => {
    const { repository, leaver, property } = await scenario();

    const before = await repository.getPropertyIntelligence(property.id);
    await repository.deleteAccount(leaver.id);
    const after = await repository.getPropertyIntelligence(property.id);

    expect(after.reviewCount).toBe(before.reviewCount);
    expect(after.overallScore).toBe(before.overallScore);
  });

  it('reports honestly how many reviews it left behind', async () => {
    const { repository, leaver } = await scenario();
    const summary = await repository.deleteAccount(leaver.id);

    // Reported rather than assumed, because the confirmation screen tells the
    // person this number and it must be the truth.
    expect(summary.reviewsUnlinked).toBe(1);
    expect(summary.savedPropertiesDestroyed).toBe(1);
    expect(summary.locationChecksDestroyed).toBe(1);
  });
});

describe('what no longer connects to a person', () => {
  it('severs the review from its author', async () => {
    const { repository, leaver, leaverReview } = await scenario();
    await repository.deleteAccount(leaver.id);

    const review = await repository.getReviewById(leaverReview.id);
    expect(review).not.toBeNull();
    expect(review?.authorId).toBeNull();
  });

  it('leaves nothing findable under the old account', async () => {
    const { repository, leaver } = await scenario();
    await repository.deleteAccount(leaver.id);

    expect(await repository.listReviewsByAuthor(leaver.id)).toEqual([]);
    expect(await repository.getUserById(leaver.id)).toBeNull();
  });

  it('destroys the shortlist and the location-check history', async () => {
    const { repository, leaver, property } = await scenario();
    await repository.deleteAccount(leaver.id);

    expect(await repository.isPropertySaved(leaver.id, property.id)).toBe(false);
    expect(await repository.listPropertyVerifications(leaver.id)).toEqual([]);
  });

  it('does not leave the account id anywhere in the store', async () => {
    const { repository, leaver } = await scenario();
    await repository.deleteAccount(leaver.id);

    const { getDatabase } = await import('@/server/data/local/store');
    const database = await getDatabase();

    // The blunt version of the promise: grep the whole store. If the id appears
    // anywhere, something still points at a person who asked to be gone.
    expect(JSON.stringify(database)).not.toContain(leaver.id);
  });
});

describe('it touches nobody else', () => {
  it('leaves another resident entirely alone', async () => {
    const { repository, leaver, stayer, stayerReview, property } = await scenario();
    await repository.saveProperty(stayer.id, property.id);

    await repository.deleteAccount(leaver.id);

    const review = await repository.getReviewById(stayerReview.id);
    expect(review?.authorId).toBe(stayer.id);
    expect(await repository.getUserById(stayer.id)).not.toBeNull();
    expect(await repository.isPropertySaved(stayer.id, property.id)).toBe(true);
  });
});

describe('an orphaned review cannot be claimed', () => {
  it('refuses an edit from the account that used to own it', async () => {
    const { repository, leaver, leaverReview } = await scenario();
    await repository.deleteAccount(leaver.id);

    // The id still exists in this test's memory even though the account does
    // not, which is exactly the position an attacker would be in.
    await expect(
      repository.updateReview(leaverReview.id, leaver.id, { body: 'rewritten after the fact' }),
    ).rejects.toThrow();
  });

  it('refuses an edit from anybody else', async () => {
    const { repository, leaver, stayer, leaverReview } = await scenario();
    await repository.deleteAccount(leaver.id);

    await expect(
      repository.updateReview(leaverReview.id, stayer.id, { body: 'taking this one over' }),
    ).rejects.toThrow();
  });
});
