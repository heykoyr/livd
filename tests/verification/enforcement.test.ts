import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { VERIFICATION_LIFETIME } from '@/config/verification';

/**
 * Server-side enforcement, run against the real store.
 *
 * These are the attacks from the brief, and they are exercised rather than
 * argued about:
 *
 *   - a client asserting `verified: true`
 *   - verifying property A and submitting a review of property B
 *   - claiming somebody else's verification
 *   - a verification that expired while the review was being written
 *
 * They run against the local adapter, which is the same code path a founder
 * gets on a fresh clone. Production adds a second, independent layer for every
 * one of them — `livd_derive_review_verification` in migration 0014 — and the
 * two are deliberately not the same implementation, because a shared one would
 * fail in the same way twice.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  // The local store writes to `./.data`, so give it a directory of its own
  // rather than trampling the developer's.
  workDir = await mkdtemp(join(tmpdir(), 'livd-verification-'));
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

/** A property at a known point, and two accounts. */
async function scenario() {
  const { LocalRepository } = await import('@/server/data/local');
  const repository = new LocalRepository();

  const resident = await repository.upsertUser({ email: `resident-${Date.now()}@example.test` });
  const other = await repository.upsertUser({ email: `other-${Date.now()}@example.test` });

  const here = await repository.createProperty(
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
    resident.id,
  );

  const elsewhere = await repository.createProperty(
    {
      buildingName: 'Beeches House',
      streetAddress: '9 Other Road',
      neighbourhood: null,
      locality: 'Manchester',
      adminArea: null,
      postalCode: null,
      countryCode: 'GB',
      propertyType: 'apartment',
      coordinates: { latitude: 53.484, longitude: -2.226 },
    },
    resident.id,
  );

  return { repository, resident, other, here, elsewhere };
}

const AT_THE_PROPERTY = { latitude: 51.546, longitude: -0.052 };

function draft(propertyId: string, verificationId: string | null) {
  return {
    propertyId,
    residencyStatus: 'former' as const,
    movedInMonth: '2023-01-01',
    movedOutMonth: '2025-06-01',
    overallRating: 4,
    categoryRatings: [],
    positiveTags: [],
    problemTags: [],
    primaryDepartureReason: 'relocation',
    secondaryDepartureReasons: [],
    noticedManagementChange: null,
    body: null,
    wouldRecommend: true,
    rentAmountMinor: null,
    rentCurrency: null,
    rentPeriod: null,
    status: 'published' as const,
    safetyFlags: [],
    verificationId,
  };
}

beforeEach(async () => {
  const { resetCache } = await import('@/server/data/local/store');
  resetCache();
  await rm(join(workDir, '.data'), { recursive: true, force: true });
});

describe('the server decides the verification, not the client', () => {
  it('verifies a resident at the property', async () => {
    const { repository, resident, here } = await scenario();

    const verification = await repository.verifyPropertyLocation({
      userId: resident.id,
      propertyId: here.id,
      ...AT_THE_PROPERTY,
      accuracyMeters: 20,
      capturedAtMs: Date.now(),
    });

    expect(verification.status).toBe('verified');
    expect(verification.failureReason).toBeNull();

    const review = await repository.createReview(
      draft(here.id, verification.id),
      resident.id,
    );

    expect(review.verificationLevel).toBe('location_verified');
    expect(review.verificationId).toBe(verification.id);
  });

  it('refuses to verify somebody in another city', async () => {
    const { repository, resident, here } = await scenario();

    const verification = await repository.verifyPropertyLocation({
      userId: resident.id,
      propertyId: here.id,
      latitude: 53.484,
      longitude: -2.226,
      accuracyMeters: 20,
      capturedAtMs: Date.now(),
    });

    expect(verification.status).toBe('failed');
    expect(verification.failureReason).toBe('outside_area');
  });

  it('publishes an unverified review when no verification is offered', async () => {
    const { repository, resident, here } = await scenario();
    const review = await repository.createReview(draft(here.id, null), resident.id);

    expect(review.verificationLevel).toBe('unverified');
    expect(review.verificationId).toBeNull();
    // And it is published. Verification is never a condition of contributing.
    expect(review.status).toBe('published');
  });

  it('will not let a failed verification become a badge', async () => {
    const { repository, resident, here } = await scenario();

    const failed = await repository.verifyPropertyLocation({
      userId: resident.id,
      propertyId: here.id,
      latitude: 53.484,
      longitude: -2.226,
      accuracyMeters: 20,
      capturedAtMs: Date.now(),
    });

    await expect(
      repository.createReview(draft(here.id, failed.id), resident.id),
    ).rejects.toThrow(/does not belong to this review/i);
  });

  it('rejects a review of property B carrying a verification of property A', async () => {
    const { repository, resident, here, elsewhere } = await scenario();

    const verification = await repository.verifyPropertyLocation({
      userId: resident.id,
      propertyId: here.id,
      ...AT_THE_PROPERTY,
      accuracyMeters: 20,
      capturedAtMs: Date.now(),
    });
    expect(verification.status).toBe('verified');

    await expect(
      repository.createReview(draft(elsewhere.id, verification.id), resident.id),
    ).rejects.toThrow(/does not belong to this review/i);
  });

  it("rejects a review carrying somebody else's verification", async () => {
    const { repository, resident, other, here } = await scenario();

    const theirs = await repository.verifyPropertyLocation({
      userId: other.id,
      propertyId: here.id,
      ...AT_THE_PROPERTY,
      accuracyMeters: 20,
      capturedAtMs: Date.now(),
    });

    await expect(
      repository.createReview(draft(here.id, theirs.id), resident.id),
    ).rejects.toThrow(/does not belong to this review/i);
  });

  it('rejects an invented verification id', async () => {
    const { repository, resident, here } = await scenario();

    await expect(
      repository.createReview(draft(here.id, 'verify-not-a-real-record'), resident.id),
    ).rejects.toThrow(/does not belong to this review/i);
  });

  it('publishes without a badge when the verification expired mid-write', async () => {
    // Deliberately not an error. Somebody who verified, was interrupted and
    // came back three hours later must not lose what they wrote — they lose
    // the badge, which is a proportionate outcome, and the confirmation screen
    // tells them so.
    const { repository, resident, here } = await scenario();

    const verification = await repository.verifyPropertyLocation({
      userId: resident.id,
      propertyId: here.id,
      ...AT_THE_PROPERTY,
      accuracyMeters: 20,
      capturedAtMs: Date.now(),
    });

    const { mutate } = await import('@/server/data/local/store');
    await mutate((database) => {
      const record = database.propertyVerifications.find((v) => v.id === verification.id)!;
      record.expiresAt = new Date(
        Date.now() - VERIFICATION_LIFETIME.attachWindowMinutes * 60_000,
      ).toISOString();
    });

    const review = await repository.createReview(
      draft(here.id, verification.id),
      resident.id,
    );

    expect(review.status).toBe('published');
    expect(review.verificationLevel).toBe('unverified');
    expect(review.verificationId).toBeNull();
  });
});

describe('verification standing', () => {
  it('does not offer the step for a property with no coordinates', async () => {
    const { repository, resident } = await scenario();

    const unlocated = await repository.createProperty(
      {
        buildingName: 'Nowhere Mansions',
        streetAddress: '1 Unknown Way',
        neighbourhood: null,
        locality: 'Lagos',
        adminArea: null,
        postalCode: null,
        countryCode: 'NG',
        propertyType: 'apartment',
      },
      resident.id,
    );

    const standing = await repository.getVerificationStanding(resident.id, unlocated.id);
    expect(standing.canVerifyLocation).toBe(false);
    expect(standing.activeVerification).toBeNull();
  });

  it('reuses a live verification rather than asking twice', async () => {
    const { repository, resident, here } = await scenario();

    await repository.verifyPropertyLocation({
      userId: resident.id,
      propertyId: here.id,
      ...AT_THE_PROPERTY,
      accuracyMeters: 20,
      capturedAtMs: Date.now(),
    });

    const standing = await repository.getVerificationStanding(resident.id, here.id);
    expect(standing.canVerifyLocation).toBe(true);
    expect(standing.activeVerification?.status).toBe('verified');
  });

  it("never offers one person another person's verification", async () => {
    const { repository, resident, other, here } = await scenario();

    await repository.verifyPropertyLocation({
      userId: other.id,
      propertyId: here.id,
      ...AT_THE_PROPERTY,
      accuracyMeters: 20,
      capturedAtMs: Date.now(),
    });

    const standing = await repository.getVerificationStanding(resident.id, here.id);
    expect(standing.activeVerification).toBeNull();
  });
});

describe('the audit trail records the decision, never the position', () => {
  it('stores no coordinate, accuracy or distance', async () => {
    const { repository, resident, here } = await scenario();

    await repository.verifyPropertyLocation({
      userId: resident.id,
      propertyId: here.id,
      ...AT_THE_PROPERTY,
      accuracyMeters: 23.4,
      capturedAtMs: Date.now(),
    });

    const { getDatabase } = await import('@/server/data/local/store');
    const database = await getDatabase();
    const stored = JSON.stringify(database.propertyVerifications);

    expect(database.propertyVerifications).toHaveLength(1);
    expect(stored).not.toContain('51.546');
    expect(stored).not.toContain('-0.052');
    expect(stored).not.toContain('23.4');
    expect(stored.toLowerCase()).not.toContain('latitude');
    expect(stored.toLowerCase()).not.toContain('accuracy');
    expect(stored.toLowerCase()).not.toContain('distance');

    expect(Object.keys(database.propertyVerifications[0]!).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'failureReason',
      'id',
      'method',
      'propertyId',
      'status',
      'userId',
    ]);
  });

  it('records failures too, because a run of them is the shape of abuse', async () => {
    const { repository, resident, here } = await scenario();

    for (let i = 0; i < 3; i += 1) {
      await repository.verifyPropertyLocation({
        userId: resident.id,
        propertyId: here.id,
        latitude: 53.484,
        longitude: -2.226,
        accuracyMeters: 20,
        capturedAtMs: Date.now(),
      });
    }

    const history = await repository.listPropertyVerifications(resident.id);
    expect(history).toHaveLength(3);
    expect(history.every((entry) => entry.status === 'failed')).toBe(true);
  });
});
