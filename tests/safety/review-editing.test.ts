import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LIMITS } from '@/config/site';
import { describeRemaining, editWindowFor } from '@/lib/reviews/edit-window';
import type { LivdRepository } from '@/server/data/repository';
import type { Property, Review, UserProfile } from '@/types/domain';

/**
 * Correcting a review, at the data layer.
 *
 * Livd tells a reviewer they may correct what they wrote for twenty-four hours.
 * Until this was built the product said so and offered nowhere to do it, so
 * these are the rules that promise now runs on, asserted as rules rather than
 * as an implementation: who may correct a review, for how long, what a
 * correction may touch, and what it does to the moderation pipeline.
 *
 * The seven cases at the bottom are the authorisation matrix. The same seven
 * run against the live database as `authenticated` and as `anon` in
 * `scripts/security/review-edit-matrix.sql`, because one suite cannot cover
 * both: this store has no privilege system, and PostgREST is not reachable from
 * a unit test. A rule that holds here and not there is the failure this pair
 * exists to catch.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-review-edit-'));
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
  review: Review;
  author: UserProfile;
  stranger: UserProfile;
  moderator: UserProfile;
}

const ORIGINAL_BODY =
  'The flat itself was fine. Repairs took a long time and the entry door was broken for most of a winter.';
const CORRECTED_BODY =
  'The flat itself was fine. Repairs took a long time, and the entry door was broken for most of one winter.';

async function scene(): Promise<Scene> {
  const { LocalRepository } = await import('@/server/data/local');
  const repository = new LocalRepository();
  const stamp = Date.now();

  const author = await repository.upsertUser({ email: `author-${stamp}@example.test` });
  const stranger = await repository.upsertUser({ email: `stranger-${stamp}@example.test` });
  const moderator = await repository.upsertUser({ email: `moderator-${stamp}@example.test` });

  const property = await repository.createProperty(
    {
      buildingName: 'Ashfield Court',
      streetAddress: '61 Example Street',
      neighbourhood: null,
      locality: 'London',
      adminArea: null,
      postalCode: 'E1 6AN',
      countryCode: 'GB',
      propertyType: 'apartment',
    },
    author.id,
  );

  const review = await repository.createReview(
    {
      propertyId: property.id,
      residencyStatus: 'former',
      movedInMonth: '2022-01-01',
      movedOutMonth: '2023-06-01',
      overallRating: 2,
      categoryRatings: [{ categoryKey: 'building_maintenance', rating: 2 }],
      positiveTags: [],
      problemTags: [],
      primaryDepartureReason: 'rent_increase',
      secondaryDepartureReasons: [],
      noticedManagementChange: null,
      body: ORIGINAL_BODY,
      wouldRecommend: false,
      rentAmountMinor: 145_000,
      rentCurrency: 'GBP',
      rentPeriod: 'month',
      status: 'published',
      safetyFlags: [],
      verificationId: null,
    },
    author.id,
  );

  return { repository, property, review, author, stranger, moderator };
}

/** Moves a review's creation time backwards, which is the only way to age one. */
async function ageReview(reviewId: string, hours: number): Promise<void> {
  const { mutate } = await import('@/server/data/local/store');
  await mutate((database) => {
    const review = database.reviews.find((r) => r.id === reviewId);
    if (!review) throw new Error('test setup: review missing');
    review.createdAt = new Date(Date.now() - hours * 3_600_000).toISOString();
  });
}

async function reload(repository: LivdRepository, id: string): Promise<Review> {
  const review = await repository.getReviewById(id);
  if (!review) throw new Error('test setup: review vanished');
  return review;
}

/* -------------------------------------------------------------------------
 * The window itself
 * ---------------------------------------------------------------------- */

describe('the correction window is one rule', () => {
  it('is the twenty-four hours the product promises', () => {
    expect(LIMITS.reviewEditWindowHours).toBe(24);
  });

  it('opens on a published review and counts from when it was written', () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);
    const window = editWindowFor(
      { status: 'published', createdAt: new Date(Date.UTC(2026, 0, 2, 9, 0, 0)).toISOString() },
      now,
    );

    expect(window.editable).toBe(true);
    // Three hours in, twenty-one left — which is the sentence the screenshot
    // showed, and it was never a second duration.
    if (window.editable) expect(describeRemaining(window.msRemaining)).toBe('21 hours');
  });

  it('closes exactly at the deadline, not a moment after', () => {
    const createdAt = new Date(Date.UTC(2026, 0, 2, 9, 0, 0)).toISOString();
    const deadline = Date.UTC(2026, 0, 3, 9, 0, 0);

    expect(editWindowFor({ status: 'published', createdAt }, deadline - 1).editable).toBe(true);
    expect(editWindowFor({ status: 'published', createdAt }, deadline).editable).toBe(false);
  });

  it('is closed for every status that is not published', () => {
    const createdAt = new Date().toISOString();

    for (const status of ['pending_moderation', 'held', 'removed'] as const) {
      const window = editWindowFor({ status, createdAt });
      expect(window.editable).toBe(false);
      if (!window.editable) expect(window.reason).toBe('not_published');
    }
  });
});

/* -------------------------------------------------------------------------
 * The authorisation matrix
 * ---------------------------------------------------------------------- */

describe('who may correct a review, and when', () => {
  it('case 1 — the author, inside the window, succeeds', async () => {
    const s = await scene();

    const { review, closesAt } = await s.repository.updateReview(s.review.id, s.author.id, {
      body: CORRECTED_BODY,
      wouldRecommend: true,
    });

    expect(review.body).toBe(CORRECTED_BODY);
    expect(review.wouldRecommend).toBe(true);
    expect(review.status).toBe('published');

    // The deadline comes back from the write, and is the creation time plus the
    // window rather than the save time plus the window.
    expect(new Date(closesAt).getTime()).toBe(
      new Date(s.review.createdAt).getTime() + LIMITS.reviewEditWindowHours * 3_600_000,
    );
  });

  it('case 2 — the author, after the window has closed, is refused', async () => {
    const s = await scene();
    await ageReview(s.review.id, LIMITS.reviewEditWindowHours + 1);

    await expect(
      s.repository.updateReview(s.review.id, s.author.id, { body: CORRECTED_BODY }),
    ).rejects.toThrow(/edit window/i);

    expect((await reload(s.repository, s.review.id)).body).toBe(ORIGINAL_BODY);
  });

  it('case 3 — somebody else, inside the window, is refused', async () => {
    const s = await scene();

    await expect(
      s.repository.updateReview(s.review.id, s.stranger.id, { body: CORRECTED_BODY }),
    ).rejects.toThrow(/permission/i);

    expect((await reload(s.repository, s.review.id)).body).toBe(ORIGINAL_BODY);
  });

  it('case 4 — nobody at all is refused', async () => {
    const s = await scene();

    for (const caller of ['', 'null', 'undefined', '00000000-0000-0000-0000-000000000000']) {
      await expect(
        s.repository.updateReview(s.review.id, caller, { body: CORRECTED_BODY }),
      ).rejects.toThrow(/permission/i);
    }

    expect((await reload(s.repository, s.review.id)).body).toBe(ORIGINAL_BODY);
  });

  it('case 5 — naming a review that is not theirs is refused the same way', async () => {
    const s = await scene();
    const theirs = await s.repository.createReview(
      {
        propertyId: s.property.id,
        residencyStatus: 'current',
        movedInMonth: '2024-01-01',
        movedOutMonth: null,
        overallRating: 5,
        categoryRatings: [{ categoryKey: 'building_maintenance', rating: 5 }],
        positiveTags: [],
        problemTags: [],
        primaryDepartureReason: null,
        secondaryDepartureReasons: [],
        noticedManagementChange: null,
        body: 'A good building to live in, and the managing agent answers the phone.',
        wouldRecommend: true,
        rentAmountMinor: null,
        rentCurrency: null,
        rentPeriod: null,
        status: 'published',
        safetyFlags: [],
        verificationId: null,
      },
      s.stranger.id,
    );

    // Holding their own review does not let them pass somebody else's id.
    await expect(
      s.repository.updateReview(s.review.id, s.stranger.id, { body: CORRECTED_BODY }),
    ).rejects.toThrow(/permission/i);

    // And the refusal is worded identically to "no such review", so this is not
    // a way to find out which ids are real.
    await expect(
      s.repository.updateReview('review-does-not-exist', s.stranger.id, { body: CORRECTED_BODY }),
    ).rejects.toThrow(/permission/i);

    expect((await reload(s.repository, theirs.id)).body).toContain('A good building');
  });

  it('case 6 — the clock the caller sends is not consulted', async () => {
    const s = await scene();
    await ageReview(s.review.id, LIMITS.reviewEditWindowHours + 6);

    // There is no parameter for it, which is the strongest form of this test:
    // a caller cannot pass a timestamp because the signature has nowhere to put
    // one. Everything it does send is refused against the stored row.
    await expect(
      s.repository.updateReview(s.review.id, s.author.id, {
        body: CORRECTED_BODY,
        wouldRecommend: true,
      }),
    ).rejects.toThrow(/edit window/i);
  });

  it('case 7 — a correction cannot extend its own window', async () => {
    const s = await scene();
    const before = (await reload(s.repository, s.review.id)).createdAt;

    await s.repository.updateReview(s.review.id, s.author.id, {
      body: CORRECTED_BODY,
      wouldRecommend: false,
    });

    const after = await reload(s.repository, s.review.id);
    expect(after.createdAt).toBe(before);

    // Saving twelve hours in leaves twelve hours, not twenty-four.
    await ageReview(s.review.id, 12);
    const { closesAt } = await s.repository.updateReview(s.review.id, s.author.id, {
      body: ORIGINAL_BODY,
    });

    const remaining = new Date(closesAt).getTime() - Date.now();
    expect(remaining).toBeLessThan(13 * 3_600_000);
    expect(remaining).toBeGreaterThan(11 * 3_600_000);
  });
});

/* -------------------------------------------------------------------------
 * What a correction may touch
 * ---------------------------------------------------------------------- */

describe('a correction is what the person said, not what they claimed', () => {
  it('changes the ratings when asked to', async () => {
    const s = await scene();

    const { review } = await s.repository.updateReview(s.review.id, s.author.id, {
      body: CORRECTED_BODY,
      wouldRecommend: true,
      overallRating: 4,
      categoryRatings: [
        { categoryKey: 'building_maintenance', rating: 4 },
        { categoryKey: 'noise', rating: 3 },
      ],
    });

    expect(review.overallRating).toBe(4);
    expect(review.categoryRatings).toEqual([
      { categoryKey: 'building_maintenance', rating: 4 },
      { categoryKey: 'noise', rating: 3 },
    ]);
  });

  it('leaves the tenancy, the rent and the verification alone', async () => {
    const s = await scene();

    const { review } = await s.repository.updateReview(s.review.id, s.author.id, {
      body: CORRECTED_BODY,
      wouldRecommend: true,
      overallRating: 5,
    });

    // The line between the two halves of a review: what somebody thought of a
    // place is theirs to revise, and what happened is not.
    expect(review.residencyStatus).toBe(s.review.residencyStatus);
    expect(review.movedInMonth).toBe(s.review.movedInMonth);
    expect(review.movedOutMonth).toBe(s.review.movedOutMonth);
    expect(review.tenureMonths).toBe(s.review.tenureMonths);
    expect(review.rent).toEqual(s.review.rent);
    expect(review.verificationLevel).toBe(s.review.verificationLevel);
    expect(review.propertyId).toBe(s.review.propertyId);
    expect(review.authorId).toBe(s.author.id);
  });

  it('replaces the category set rather than merging into it', async () => {
    const s = await scene();

    // The review was created rating `building_maintenance` only. Sending a set
    // that does not contain it means the reviewer cleared it, and a merge would
    // have no way to say so.
    const { review } = await s.repository.updateReview(s.review.id, s.author.id, {
      categoryRatings: [{ categoryKey: 'noise', rating: 5 }],
    });

    expect(review.categoryRatings).toEqual([{ categoryKey: 'noise', rating: 5 }]);
  });

  it('leaves the ratings alone when the correction does not mention them', async () => {
    const s = await scene();

    const { review } = await s.repository.updateReview(s.review.id, s.author.id, {
      body: CORRECTED_BODY,
    });

    expect(review.overallRating).toBe(s.review.overallRating);
    expect(review.categoryRatings).toEqual(s.review.categoryRatings);
  });

  it('moves the property score with the rating', async () => {
    const s = await scene();

    // A property needs enough weight behind it to carry a score at all — below
    // that the rollup reports `insufficient` and no number, which is the right
    // answer and a useless thing to assert against. Three more residents put it
    // over the line.
    for (let i = 0; i < 3; i += 1) {
      const other = await s.repository.upsertUser({ email: `other-${i}-${Date.now()}@example.test` });
      await s.repository.createReview(
        {
          propertyId: s.property.id,
          residencyStatus: 'current',
          movedInMonth: '2023-01-01',
          movedOutMonth: null,
          overallRating: 3,
          categoryRatings: [{ categoryKey: 'noise', rating: 3 }],
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
        other.id,
      );
    }

    const before = await s.repository.getPropertyIntelligence(s.property.id);
    expect(before.overallScore).not.toBeNull();

    await s.repository.updateReview(s.review.id, s.author.id, {
      overallRating: 5,
      categoryRatings: [
        { categoryKey: 'building_maintenance', rating: 5 },
        { categoryKey: 'noise', rating: 5 },
      ],
    });

    const after = await s.repository.getPropertyIntelligence(s.property.id);

    // A corrected rating that left the property's score behind would be the
    // actual laundering risk: a page showing 2/5 under a review that now says
    // 5/5. Postgres recomputes through `reviews_refresh_stats`; the local
    // adapter derives on read. Either way the number has to move.
    expect(after.overallScore).not.toBe(before.overallScore);
    expect(after.overallScore ?? 0).toBeGreaterThan(before.overallScore ?? 0);
  });

  it('refuses a rating outside 1 to 5', async () => {
    const s = await scene();

    for (const rating of [0, 6, -1, 3.5]) {
      await expect(
        s.repository.updateReview(s.review.id, s.author.id, { overallRating: rating }),
      ).rejects.toThrow(/whole number from 1 to 5/i);
    }
  });

  it('refuses a category that does not exist', async () => {
    const s = await scene();

    await expect(
      s.repository.updateReview(s.review.id, s.author.id, {
        categoryRatings: [{ categoryKey: 'rent_is_cheap_actually', rating: 5 }],
      }),
    ).rejects.toThrow(/unknown category/i);
  });

  it('refuses the same category twice, which would count twice in the rollup', async () => {
    const s = await scene();

    await expect(
      s.repository.updateReview(s.review.id, s.author.id, {
        categoryRatings: [
          { categoryKey: 'noise', rating: 1 },
          { categoryKey: 'noise', rating: 5 },
        ],
      }),
    ).rejects.toThrow(/only be rated once/i);
  });

  it('refuses clearing every category, which would leave no comparable signal', async () => {
    const s = await scene();

    await expect(
      s.repository.updateReview(s.review.id, s.author.id, { categoryRatings: [] }),
    ).rejects.toThrow(/at least one category/i);
  });

  it('refuses a body too short to tell anybody anything', async () => {
    const s = await scene();

    await expect(
      s.repository.updateReview(s.review.id, s.author.id, { body: 'Fine.' }),
    ).rejects.toThrow(/between/i);
  });

  it('accepts a review being emptied back to no words at all', async () => {
    const s = await scene();

    const { review } = await s.repository.updateReview(s.review.id, s.author.id, { body: null });
    expect(review.body).toBeNull();
  });

  it('writes nothing at all when a rating is refused', async () => {
    const s = await scene();

    await expect(
      s.repository.updateReview(s.review.id, s.author.id, {
        body: CORRECTED_BODY,
        overallRating: 9,
      }),
    ).rejects.toThrow();

    // The body travelled with the bad rating and must not have landed on its
    // own — a half-applied correction is the one outcome nobody could explain.
    const after = await reload(s.repository, s.review.id);
    expect(after.body).toBe(ORIGINAL_BODY);
    expect(after.overallRating).toBe(s.review.overallRating);
  });
});

/* -------------------------------------------------------------------------
 * Moderation and history
 * ---------------------------------------------------------------------- */

describe('a correction cannot get past the safety pipeline', () => {
  it('adds flags and never clears one', async () => {
    const s = await scene();

    await s.repository.updateReview(
      s.review.id,
      s.author.id,
      { body: CORRECTED_BODY },
      { addFlags: ['aggressive_tone'] },
    );

    // A second correction that raises nothing must not wash the first one off.
    const { review } = await s.repository.updateReview(
      s.review.id,
      s.author.id,
      { body: ORIGINAL_BODY },
      { addFlags: [] },
    );

    expect(review.safetyFlags).toContain('aggressive_tone');
  });

  it('takes a review off the property page when a correction alleges something serious', async () => {
    const s = await scene();

    const { review } = await s.repository.updateReview(
      s.review.id,
      s.author.id,
      { body: CORRECTED_BODY },
      { addFlags: ['unverified_allegation'], hold: true },
    );

    expect(review.status).toBe('pending_moderation');

    // And it is in front of a moderator rather than merely hidden.
    const queue = await s.repository.listReviewsByStatus('pending_moderation', 50);
    expect(queue.map((entry) => entry.review.id)).toContain(s.review.id);
  });

  it('records why it left, in the moderation trail', async () => {
    const s = await scene();

    await s.repository.updateReview(
      s.review.id,
      s.author.id,
      { body: CORRECTED_BODY },
      { addFlags: ['unverified_allegation'], hold: true },
    );

    const trail = await s.repository.listModerationActions(s.review.id);
    const entry = trail.find((row) => row.action === 'set_status:pending_moderation');

    expect(entry).toBeDefined();
    expect(entry?.subjectType).toBe('review');
    expect(entry?.previousStatus).toBe('published');
    expect(entry?.newStatus).toBe('pending_moderation');
    // The author caused it, so the author is who it names. Attributing a
    // correction to a moderator who was not there would be worse than no row.
    expect(entry?.actorId).toBe(s.author.id);
    expect(entry?.reason).toMatch(/read by a person/i);
  });

  it('cannot put a held review back on the page by correcting it again', async () => {
    const s = await scene();

    await s.repository.updateReview(
      s.review.id,
      s.author.id,
      { body: CORRECTED_BODY },
      { addFlags: ['unverified_allegation'], hold: true },
    );

    await expect(
      s.repository.updateReview(s.review.id, s.author.id, { body: ORIGINAL_BODY }),
    ).rejects.toThrow(/published/i);
  });
});

describe('what a correction preserves', () => {
  it('keeps the review as it was published, before changing it', async () => {
    const s = await scene();

    await s.repository.updateReview(s.review.id, s.author.id, {
      body: CORRECTED_BODY,
      wouldRecommend: true,
    });

    const snapshots = await s.repository.listReviewSnapshots(s.review.id);
    expect(snapshots.length).toBeGreaterThan(0);

    const first = snapshots.at(-1) ?? snapshots[0];
    expect(first?.body).toBe(ORIGINAL_BODY);
    expect(first?.wouldRecommend).toBe(false);
    expect(first?.reason).toBe('correction');
  });

  it('keeps the score a review was published with, now that a score can change', async () => {
    const s = await scene();

    await s.repository.updateReview(s.review.id, s.author.id, {
      overallRating: 5,
      categoryRatings: [{ categoryKey: 'noise', rating: 5 }],
    });

    const snapshots = await s.repository.listReviewSnapshots(s.review.id);
    const first = snapshots.at(-1) ?? snapshots[0];

    // This is what makes an editable rating safe rather than a way to launder a
    // review: the 2/5 it went up with is still on the record, with the author's
    // id against the change.
    expect(first?.overallRating).toBe(s.review.overallRating);
    expect(first?.categoryRatings).toEqual(s.review.categoryRatings);
    expect(first?.changedBy).toBe(s.author.id);
  });

  it('keeps a chain rather than only the most recent state', async () => {
    const s = await scene();

    await s.repository.updateReview(s.review.id, s.author.id, { body: CORRECTED_BODY });
    await s.repository.updateReview(s.review.id, s.author.id, {
      body: `${CORRECTED_BODY} The lift also broke twice.`,
    });

    const snapshots = await s.repository.listReviewSnapshots(s.review.id);
    const bodies = snapshots.map((snapshot) => snapshot.body);

    expect(bodies).toContain(ORIGINAL_BODY);
    expect(bodies).toContain(CORRECTED_BODY);
  });

  it('names the author as the person who changed it', async () => {
    const s = await scene();

    await s.repository.updateReview(s.review.id, s.author.id, { body: CORRECTED_BODY });

    const snapshots = await s.repository.listReviewSnapshots(s.review.id);
    expect(snapshots.some((snapshot) => snapshot.changedBy === s.author.id)).toBe(true);
  });

  it('leaves an existing owner response attached to the review', async () => {
    const s = await scene();

    const claim = await s.repository.createClaim({
      propertyId: s.property.id,
      claimantId: s.stranger.id,
      roleClaimed: 'manager',
      organisation: null,
      contactEmail: 'agent@example.test',
    });
    await s.repository.decideClaim(claim.id, 'approved', s.moderator.id, 'Documents check out.');

    await s.repository.createOwnerResponse({
      reviewId: s.review.id,
      responderId: s.stranger.id,
      body: 'The entry door was rehung in March and the repair backlog has been cleared since.',
      isResolutionNotice: false,
    });

    await s.repository.updateReview(s.review.id, s.author.id, {
      body: CORRECTED_BODY,
      wouldRecommend: true,
    });

    const page = await s.repository.listPublicReviews(s.property.id);
    const entry = page.items.find((item) => item.id === s.review.id);

    expect(entry?.body).toBe(CORRECTED_BODY);
    expect(entry?.ownerResponse?.body).toContain('rehung in March');
  });
});
