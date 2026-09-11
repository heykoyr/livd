import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { LivdRepository } from '@/server/data/repository';
import type { Property, Review, UserProfile } from '@/types/domain';

/**
 * The right of reply, at the data layer.
 *
 * Claiming a property grants exactly two things — correcting factual details,
 * and one public reply per review — and the second of them did not work. Not
 * because the rule was wrong: because nothing in the application ever called
 * the action that applies it, and the query that reads a response back asked
 * PostgREST for a relationship that does not exist.
 *
 * These tests hold the local adapter to the rule that Postgres enforces
 * through `owner_responses_insert`. The database's own copy of the same
 * matrix is `scripts/security/owner-response-matrix.sql`, which runs against
 * the live project and rolls back — one suite cannot cover both, because the
 * local store has no privilege system and PostgREST is not reachable from a
 * unit test.
 *
 * What is asserted is the product promise, not the mechanism: who may reply,
 * how often, and what replying does *not* come with.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-owner-response-'));
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

interface Scene {
  repository: LivdRepository;
  property: Property;
  otherProperty: Property;
  review: Review;
  otherReview: Review;
  approved: UserProfile;
  pending: UserProfile;
  elsewhere: UserProfile;
  resident: UserProfile;
}

/**
 * Four people and two buildings.
 *
 * `approved` manages the first. `pending` has asked to and has not been
 * decided. `elsewhere` manages the second. `resident` wrote the review.
 */
async function scene(): Promise<Scene> {
  const { LocalRepository } = await import('@/server/data/local');
  const repository = new LocalRepository();
  const stamp = Date.now();

  const approved = await repository.upsertUser({ email: `approved-${stamp}@example.test` });
  const pending = await repository.upsertUser({ email: `pending-${stamp}@example.test` });
  const elsewhere = await repository.upsertUser({ email: `elsewhere-${stamp}@example.test` });
  const resident = await repository.upsertUser({ email: `resident-${stamp}@example.test` });
  const moderator = await repository.upsertUser({ email: `moderator-${stamp}@example.test` });

  const address = (name: string, street: string) => ({
    buildingName: name,
    streetAddress: street,
    neighbourhood: null,
    locality: 'London',
    adminArea: null,
    postalCode: 'E1 6AN',
    countryCode: 'GB',
    propertyType: 'apartment' as const,
  });

  const property = await repository.createProperty(address('Ashfield Court', '61 Example Street'), resident.id);
  const otherProperty = await repository.createProperty(
    address('Beckton Wharf', '2 Other Street'),
    resident.id,
  );

  const draft = (propertyId: string) => ({
    propertyId,
    residencyStatus: 'former' as const,
    movedInMonth: '2022-01-01',
    movedOutMonth: '2023-06-01',
    overallRating: 3,
    categoryRatings: [{ categoryKey: 'building_maintenance', rating: 3 }],
    positiveTags: [],
    problemTags: [],
    primaryDepartureReason: 'rent_increase',
    secondaryDepartureReasons: [],
    noticedManagementChange: null,
    body: 'The building was fine for the most part, with a few slow repairs along the way.',
    wouldRecommend: true,
    rentAmountMinor: null,
    rentCurrency: null,
    rentPeriod: null,
    status: 'published' as const,
    safetyFlags: [],
    verificationId: null,
  });

  const review = await repository.createReview(draft(property.id), resident.id);
  const otherReview = await repository.createReview(draft(otherProperty.id), resident.id);

  const grant = async (user: UserProfile, target: Property, decide: boolean) => {
    const claim = await repository.createClaim({
      propertyId: target.id,
      claimantId: user.id,
      roleClaimed: 'manager',
      organisation: null,
      contactEmail: `${user.id}@example.test`,
    });
    if (decide) await repository.decideClaim(claim.id, 'approved', moderator.id, 'Documents check out.');
  };

  await grant(approved, property, true);
  await grant(pending, property, false);
  await grant(elsewhere, otherProperty, true);

  return { repository, property, otherProperty, review, otherReview, approved, pending, elsewhere, resident };
}

const BODY = 'Thank you for writing this. The lift was replaced in March and the entry door rehung.';

describe('who may reply', () => {
  it('lets the approved claimant reply to a review of their property', async () => {
    const s = await scene();

    await expect(
      s.repository.createOwnerResponse({
        reviewId: s.review.id,
        responderId: s.approved.id,
        body: BODY,
        isResolutionNotice: false,
      }),
    ).resolves.toBeUndefined();

    const page = await s.repository.listPublicReviews(s.property.id);
    expect(page.items[0]?.ownerResponse?.body).toBe(BODY);
  });

  it('refuses a claimant whose claim has not been decided', async () => {
    const s = await scene();

    await expect(
      s.repository.createOwnerResponse({
        reviewId: s.review.id,
        responderId: s.pending.id,
        body: BODY,
        isResolutionNotice: false,
      }),
    ).rejects.toThrow(/approved claimant/i);
  });

  it('refuses the approved claimant of a different property', async () => {
    const s = await scene();

    await expect(
      s.repository.createOwnerResponse({
        reviewId: s.review.id,
        responderId: s.elsewhere.id,
        body: BODY,
        isResolutionNotice: false,
      }),
    ).rejects.toThrow(/approved claimant/i);
  });

  it('refuses an ordinary resident', async () => {
    const s = await scene();

    await expect(
      s.repository.createOwnerResponse({
        reviewId: s.review.id,
        responderId: s.resident.id,
        body: BODY,
        isResolutionNotice: false,
      }),
    ).rejects.toThrow(/approved claimant/i);
  });

  it('refuses an account that does not exist', async () => {
    const s = await scene();

    await expect(
      s.repository.createOwnerResponse({
        reviewId: s.review.id,
        responderId: 'nobody-at-all',
        body: BODY,
        isResolutionNotice: false,
      }),
    ).rejects.toThrow(/approved claimant/i);
  });
});

describe('how often', () => {
  it('is a right of reply, not a comment thread', async () => {
    const s = await scene();

    await s.repository.createOwnerResponse({
      reviewId: s.review.id,
      responderId: s.approved.id,
      body: BODY,
      isResolutionNotice: false,
    });

    await expect(
      s.repository.createOwnerResponse({
        reviewId: s.review.id,
        responderId: s.approved.id,
        body: 'Actually, on reflection, something rather different from the first reply.',
        isResolutionNotice: false,
      }),
    ).rejects.toThrow(/already has a response/i);
  });

  it('does not spill onto another property', async () => {
    const s = await scene();

    await s.repository.createOwnerResponse({
      reviewId: s.review.id,
      responderId: s.approved.id,
      body: BODY,
      isResolutionNotice: false,
    });

    const elsewhere = await s.repository.listPublicReviews(s.otherProperty.id);
    expect(elsewhere.items[0]?.ownerResponse).toBeNull();
  });
});

describe('what replying does not come with', () => {
  it('leaves the review exactly as it was', async () => {
    const s = await scene();

    await s.repository.createOwnerResponse({
      reviewId: s.review.id,
      responderId: s.approved.id,
      body: BODY,
      isResolutionNotice: true,
    });

    const after = await s.repository.getReviewById(s.review.id);
    expect(after?.body).toBe(s.review.body);
    expect(after?.overallRating).toBe(s.review.overallRating);
    expect(after?.status).toBe('published');
    expect(after?.verificationLevel).toBe(s.review.verificationLevel);
  });

  it('does not put the reviewer anywhere a reader can reach', async () => {
    const s = await scene();

    await s.repository.createOwnerResponse({
      reviewId: s.review.id,
      responderId: s.approved.id,
      body: BODY,
      isResolutionNotice: false,
    });

    const page = await s.repository.listPublicReviews(s.property.id);
    const serialised = JSON.stringify(page.items);

    expect(serialised).not.toContain(s.resident.id);
    expect(serialised).not.toContain(s.resident.email);
    expect(page.items[0]).not.toHaveProperty('authorId');
  });

  it('does not make the claimant able to review the property they claimed', async () => {
    // The mirror of the same rule. Checked in the submit action and by the
    // policy; asserted here so the pair cannot drift apart.
    const s = await scene();
    const claimed = await s.repository.listClaimedPropertyIds(s.approved.id);

    expect(claimed).toContain(s.property.id);
    expect(claimed).not.toContain(s.otherProperty.id);
  });

  it('tells a resolution notice apart from an ordinary reply', async () => {
    const s = await scene();

    await s.repository.createOwnerResponse({
      reviewId: s.review.id,
      responderId: s.approved.id,
      body: BODY,
      isResolutionNotice: true,
    });

    const page = await s.repository.listPublicReviews(s.property.id);
    expect(page.items[0]?.ownerResponse?.isResolutionNotice).toBe(true);
    // Derived from the claim, never from the client. Migration 0045 does the
    // same thing in Postgres with a BEFORE INSERT trigger.
    expect(page.items[0]?.ownerResponse?.respondentRole).toBe('manager');
  });
});
