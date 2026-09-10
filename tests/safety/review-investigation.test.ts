import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The review investigation view.
 *
 * What is being pinned is the privacy shape, not the layout. Every field this
 * surface returns is INTERNAL — an account id, counts, statuses, decisions —
 * and the two RESTRICTED things are absent by construction rather than by a
 * component choosing not to render them:
 *
 *   the author's email address, which no query here selects
 *   the residency document, which is reached elsewhere and audited
 *
 * And the one thing that has never existed anywhere in Livd: a position. No
 * coordinate, no accuracy, no distance. A location check yields a verdict, a
 * method and a time, which answers "did somebody stand at this building"
 * without answering "where was this person".
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

const AUTHOR_EMAIL = 'the.author@example.test';
const REPORTER_EMAIL = 'the.reporter@example.test';

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-investigation-'));
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
  vi.resetModules();
  const { resetCache } = await import('@/server/data/local/store');
  resetCache();
  await rm(join(workDir, '.data'), { recursive: true, force: true });
});

async function world() {
  const { LocalRepository } = await import('@/server/data/local');
  const { mutate } = await import('@/server/data/local/store');
  const repository = new LocalRepository();

  const moderator = await repository.upsertUser({ email: 'moderator@example.test' });
  const author = await repository.upsertUser({ email: AUTHOR_EMAIL });
  const reporter = await repository.upsertUser({ email: REPORTER_EMAIL });

  await mutate((database) => {
    const m = database.users.find((u) => u.id === moderator.id);
    if (m) m.role = 'moderator';
    for (const id of [author.id, reporter.id]) {
      const plain = database.users.find((u) => u.id === id);
      if (plain) plain.role = 'resident';
    }
  });

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
    author.id,
  );

  const draft = (movedIn: string, movedOut: string) => ({
    propertyId: property.id,
    residencyStatus: 'former' as const,
    movedInMonth: movedIn,
    movedOutMonth: movedOut,
    overallRating: 2,
    categoryRatings: [{ categoryKey: 'management', rating: 2 }],
    positiveTags: [],
    problemTags: ['slow_repairs'],
    primaryDepartureReason: 'maintenance',
    secondaryDepartureReasons: [],
    noticedManagementChange: null,
    body: 'Repairs took months and the managing agent stopped replying entirely.',
    wouldRecommend: false,
    rentAmountMinor: null,
    rentCurrency: null,
    rentPeriod: null,
    status: 'published' as const,
    safetyFlags: [],
    verificationId: null,
  });

  const review = await repository.createReview(draft('2021-01-01', '2023-01-01'), author.id);

  const report = await repository.createReport({
    reviewId: review.id,
    reporterId: reporter.id,
    reason: 'false_information',
    detail: 'This is not accurate.',
  });

  const current = await repository.getUserById(moderator.id);
  vi.doMock('@/server/auth/guards', async () => {
    const real = await vi.importActual<typeof import('@/server/auth/guards')>(
      '@/server/auth/guards',
    );
    return { ...real, requireUser: async () => current };
  });

  const admin = await import('@/server/admin');
  return { admin, repository, moderator: current!, author, reporter, property, review, report };
}

describe('what the investigation returns', () => {
  it('gathers the review, its author and its property in one read', async () => {
    const { admin, review, author, property } = await world();

    const result = await admin.readReviewInvestigation(review.id);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.review.reviewId).toBe(review.id);
    expect(result.review.author?.id).toBe(author.id);
    expect(result.review.property.id).toBe(property.id);
    expect(result.review.property.reviewCount).toBe(1);
    expect(result.review.reportCount).toBe(1);
    expect(result.review.openReportCount).toBe(1);
  });

  it('carries no email address anywhere in the payload', async () => {
    const { admin, review } = await world();

    const result = await admin.readReviewInvestigation(review.id);
    const serialised = JSON.stringify(result);

    expect(serialised).not.toContain(AUTHOR_EMAIL);
    expect(serialised).not.toContain('the.author');
    expect(serialised).not.toContain(REPORTER_EMAIL);
    expect(serialised).not.toContain('the.reporter');
  });

  it('carries no position, because Livd has never stored one', async () => {
    const { admin, repository, review, author, property } = await world();

    // A real location check, made from a real position — which the verification
    // pipeline uses to decide and then discards.
    await repository.verifyPropertyLocation({
      userId: author.id,
      propertyId: property.id,
      latitude: 51.5461,
      longitude: -0.0521,
      accuracyMeters: 20,
      capturedAtMs: Date.now(),
    });

    const result = await admin.readReviewInvestigation(review.id);
    const serialised = JSON.stringify(result);

    for (const forbidden of ['latitude', 'longitude', 'accuracy', 'distance', '51.546', '-0.052']) {
      expect(serialised, `investigation payload contains ${forbidden}`).not.toContain(forbidden);
    }

    // The check itself is visible — a verdict, a method and a time.
    expect(result?.verification).toHaveLength(1);
    expect(result?.verification[0]?.kind).toBe('location');
    expect(result?.verification[0]?.atThisProperty).toBe(true);
  });

  it('shows the author has written elsewhere, which changes the decision', async () => {
    const { admin, repository, review, author } = await world();

    const second = await repository.createProperty(
      {
        buildingName: 'Second Building',
        streetAddress: '9 Other Street',
        neighbourhood: null,
        locality: 'London',
        adminArea: null,
        postalCode: null,
        countryCode: 'GB',
        propertyType: 'apartment',
        coordinates: null,
      },
      author.id,
    );

    await repository.createReview(
      {
        propertyId: second.id,
        residencyStatus: 'former',
        movedInMonth: '2019-01-01',
        movedOutMonth: '2020-01-01',
        overallRating: 1,
        categoryRatings: [{ categoryKey: 'management', rating: 1 }],
        positiveTags: [],
        problemTags: [],
        primaryDepartureReason: 'management',
        secondaryDepartureReasons: [],
        noticedManagementChange: null,
        body: 'A different building, also difficult.',
        wouldRecommend: false,
        rentAmountMinor: null,
        rentCurrency: null,
        rentPeriod: null,
        status: 'published',
        safetyFlags: [],
        verificationId: null,
      },
      author.id,
    );

    const result = await admin.readReviewInvestigation(review.id);

    // Four reviews in a week and four across three years look identical without
    // this number.
    expect(result?.review.author?.reviewCount).toBe(2);
  });

  it('names the reporter by id and nothing else', async () => {
    const { admin, review, reporter } = await world();

    const result = await admin.readReviewInvestigation(review.id);

    expect(result?.reports[0]?.reporterId).toBe(reporter.id);
    expect(JSON.stringify(result?.reports)).not.toContain(REPORTER_EMAIL);
  });

  it('still works when the author has deleted their account', async () => {
    const { admin, repository, review, author } = await world();

    await repository.deleteAccount(author.id);

    const result = await admin.readReviewInvestigation(review.id);

    // The review stays on the property record, permanently unattributable —
    // which every legal page promises, and which this page has to survive.
    expect(result).not.toBeNull();
    expect(result?.review.author).toBeNull();
    expect(result?.verification).toEqual([]);
  });

  it('returns nothing for a review that does not exist', async () => {
    const { admin } = await world();
    expect(await admin.readReviewInvestigation('review-does-not-exist')).toBeNull();
  });
});

describe('the property context', () => {
  it('counts the property activity around the review', async () => {
    const { admin, review } = await world();

    const result = await admin.readReviewInvestigation(review.id);

    expect(result?.review.property.reviewCount).toBe(1);
    expect(result?.review.property.reportedReviewCount).toBe(1);
    expect(result?.review.property.isClaimed).toBe(false);
  });

  it('notes a claimed property without changing anything about the review', async () => {
    const { admin, repository, review, property, reporter, moderator } = await world();

    const claim = await repository.createClaim({
      propertyId: property.id,
      claimantId: reporter.id,
      roleClaimed: 'manager',
      organisation: 'Example Lettings',
      contactEmail: 'lettings@example.test',
    });
    await repository.decideClaim(claim.id, 'approved', moderator.id);

    const result = await admin.readReviewInvestigation(review.id);

    expect(result?.review.property.isClaimed).toBe(true);

    // A claim changes what an owner may do. It changes nothing about how the
    // review is judged, and nothing about what is knowable about its author.
    expect(result?.review.status).toBe('published');
    expect(JSON.stringify(result)).not.toContain(AUTHOR_EMAIL);
  });
});
