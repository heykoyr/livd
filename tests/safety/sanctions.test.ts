import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sanctions.
 *
 * Two things are being pinned.
 *
 * **Severity decides authorisation.** Restrict is a moderator's, suspend is
 * Trust & Safety's, ban is an administrator's — in both directions, so somebody
 * who could not apply a sanction cannot undo one either. The point at which a
 * decision becomes hard to reverse is the point at which it should need
 * somebody more senior.
 *
 * **Account standing is not review status.** Nothing here touches a review, and
 * nothing in the moderation path touches an account. All four combinations are
 * reachable and ordinary, and a system that conflates them punishes people
 * twice for one thing or not at all for another.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-sanctions-'));
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

async function world(actorRole: 'moderator' | 'trust_admin' | 'admin') {
  const { LocalRepository } = await import('@/server/data/local');
  const { mutate } = await import('@/server/data/local/store');
  const repository = new LocalRepository();

  const actor = await repository.upsertUser({ email: `${actorRole}@example.test` });
  const subject = await repository.upsertUser({ email: 'subject@example.test' });
  const otherMod = await repository.upsertUser({ email: 'other-moderator@example.test' });

  await mutate((database) => {
    const a = database.users.find((u) => u.id === actor.id);
    if (a) a.role = actorRole;
    const s = database.users.find((u) => u.id === subject.id);
    if (s) s.role = 'resident';
    const o = database.users.find((u) => u.id === otherMod.id);
    if (o) o.role = 'moderator';
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
      coordinates: null,
    },
    subject.id,
  );

  const review = await repository.createReview(
    {
      propertyId: property.id,
      residencyStatus: 'former',
      movedInMonth: '2021-01-01',
      movedOutMonth: '2023-01-01',
      overallRating: 2,
      categoryRatings: [{ categoryKey: 'management', rating: 2 }],
      positiveTags: [],
      problemTags: ['slow_repairs'],
      primaryDepartureReason: 'maintenance',
      secondaryDepartureReasons: [],
      noticedManagementChange: null,
      body: 'Repairs took months and the managing agent stopped replying.',
      wouldRecommend: false,
      rentAmountMinor: null,
      rentCurrency: null,
      rentPeriod: null,
      status: 'published',
      safetyFlags: [],
      verificationId: null,
    },
    subject.id,
  );

  const current = await repository.getUserById(actor.id);
  vi.doMock('@/server/auth/guards', async () => {
    const real = await vi.importActual<typeof import('@/server/auth/guards')>(
      '@/server/auth/guards',
    );
    return { ...real, requireUser: async () => current };
  });

  const admin = await import('@/server/admin');
  return { admin, repository, actor: current!, subject, otherMod, property, review };
}

describe('severity decides authorisation', () => {
  it('lets a moderator restrict', async () => {
    const { admin, repository, subject } = await world('moderator');

    const result = await admin.applySanction({
      userId: subject.id,
      action: 'restricted',
      reasonKey: 'spam',
      reason: 'Repeated promotional reviews',
      durationDays: 7,
    });

    expect(result.ok).toBe(true);
    expect((await repository.getUserById(subject.id))?.status).toBe('restricted');
  });

  it('refuses a moderator suspending', async () => {
    const { admin, repository, subject } = await world('moderator');

    const result = await admin.applySanction({
      userId: subject.id,
      action: 'suspended',
      reasonKey: 'harassment',
      reason: 'Escalating past my authority',
      durationDays: 7,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Trust and Safety authorisation/i);
    expect((await repository.getUserById(subject.id))?.status).toBe('active');
  });

  it('refuses a Trust & Safety admin banning', async () => {
    const { admin, subject } = await world('trust_admin');

    const result = await admin.applySanction({
      userId: subject.id,
      action: 'banned',
      reasonKey: 'threats',
      reason: 'Going straight to a ban',
      durationDays: null,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/administrator/i);
  });

  it('lets an administrator ban', async () => {
    const { admin, repository, subject } = await world('admin');

    const result = await admin.applySanction({
      userId: subject.id,
      action: 'banned',
      reasonKey: 'threats',
      reason: 'Credible threat against a named person',
      durationDays: null,
    });

    expect(result.ok).toBe(true);
    expect((await repository.getUserById(subject.id))?.status).toBe('banned');
  });

  it('refuses a ban with an end date', async () => {
    // A ban has no end date. Accepting one would imply it lifts by itself.
    const { admin } = await world('admin');
    const { subject } = await world('admin');

    const result = await admin.applySanction({
      userId: subject.id,
      action: 'banned',
      reasonKey: 'ban_evasion',
      reason: 'Returned under a second account',
      durationDays: 30,
    });

    expect(result.ok).toBe(false);
  });

  it('refuses anybody sanctioning themselves', async () => {
    const { admin, actor } = await world('admin');

    const result = await admin.applySanction({
      userId: actor.id,
      action: 'restricted',
      reasonKey: 'spam',
      reason: 'Restricting myself',
      durationDays: 1,
    });

    expect(result.ok).toBe(false);
  });

  it('refuses a moderator acting on another privileged account', async () => {
    const { admin, otherMod } = await world('moderator');

    const result = await admin.applySanction({
      userId: otherMod.id,
      action: 'restricted',
      reasonKey: 'platform_abuse',
      reason: 'A disagreement between moderators',
      durationDays: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/administrator/i);
  });

  it('refuses a moderator lifting a suspension', async () => {
    // Both directions. Somebody who could not apply it cannot undo it.
    const { admin: tsAdmin, subject } = await world('trust_admin');
    const applied = await tsAdmin.applySanction({
      userId: subject.id,
      action: 'suspended',
      reasonKey: 'review_manipulation',
      reason: 'Coordinated reviewing across four properties',
      durationDays: 30,
    });
    if (!applied.ok) throw new Error('expected a sanction');

    vi.resetModules();
    const { admin: mod } = await world('moderator');

    const result = await mod.liftSanction({
      sanctionId: applied.data.sanctionId,
      reason: 'Lifting something I could not apply',
    });

    expect(result.ok).toBe(false);
  });
});

describe('a sanction is a record, not just a state', () => {
  it('carries a category, a reason, an actor and a duration', async () => {
    const { admin, repository, actor, subject } = await world('trust_admin');

    await admin.applySanction({
      userId: subject.id,
      action: 'suspended',
      reasonKey: 'review_manipulation',
      reason: 'Four reviews of unrelated properties in two days, near-identical wording',
      durationDays: 30,
    });

    const [sanction] = await repository.listSanctions({ userId: subject.id });

    expect(sanction?.action).toBe('suspended');
    expect(sanction?.reasonKey).toBe('review_manipulation');
    expect(sanction?.reason).toContain('near-identical wording');
    expect(sanction?.appliedBy).toBe(actor.id);
    expect(sanction?.endsAt).not.toBeNull();
    expect(sanction?.isActive).toBe(true);
  });

  it('is audited', async () => {
    const { admin, repository, actor, subject } = await world('trust_admin');

    await admin.applySanction({
      userId: subject.id,
      action: 'suspended',
      reasonKey: 'harassment',
      reason: 'Sustained targeting of another resident',
      durationDays: 14,
    });

    const log = await repository.listAdminAudit();
    const entry = log.items.find((row) => row.action === 'user_sanctioned');

    expect(entry?.actorId).toBe(actor.id);
    expect(entry?.subjectId).toBe(subject.id);
    expect(entry?.detail.action).toBe('suspended');
  });

  it('refuses a category with no words behind it', async () => {
    const { admin, subject } = await world('trust_admin');

    const result = await admin.applySanction({
      userId: subject.id,
      action: 'restricted',
      reasonKey: 'spam',
      reason: '  ',
      durationDays: 7,
    });

    expect(result.ok).toBe(false);
  });

  it('is lifted rather than deleted, and the record stays', async () => {
    const { admin, repository, subject } = await world('trust_admin');

    const applied = await admin.applySanction({
      userId: subject.id,
      action: 'suspended',
      reasonKey: 'review_manipulation',
      reason: 'Suspected coordination',
      durationDays: 30,
    });
    if (!applied.ok) throw new Error('expected a sanction');

    await admin.liftSanction({
      sanctionId: applied.data.sanctionId,
      reason: 'No evidence of coordination after review',
    });

    const sanctions = await repository.listSanctions({ userId: subject.id });

    expect(sanctions).toHaveLength(1);
    expect(sanctions[0]?.liftedAt).not.toBeNull();
    expect(sanctions[0]?.liftedReason).toContain('No evidence');
    expect(sanctions[0]?.isActive).toBe(false);
    expect((await repository.getUserById(subject.id))?.status).toBe('active');
  });

  it('falls back to the strongest sanction still standing', async () => {
    const { admin, repository, subject } = await world('trust_admin');

    await admin.applySanction({
      userId: subject.id,
      action: 'restricted',
      reasonKey: 'spam',
      reason: 'Promotional posting',
      durationDays: 90,
    });

    const suspension = await admin.applySanction({
      userId: subject.id,
      action: 'suspended',
      reasonKey: 'review_manipulation',
      reason: 'Suspected coordination',
      durationDays: 30,
    });
    if (!suspension.ok) throw new Error('expected a sanction');

    expect((await repository.getUserById(subject.id))?.status).toBe('suspended');

    await admin.liftSanction({
      sanctionId: suspension.data.sanctionId,
      reason: 'Coordination not established',
    });

    // The restriction is still running, so the account returns to that rather
    // than to active.
    expect((await repository.getUserById(subject.id))?.status).toBe('restricted');
  });

  it('offers no way to delete one', async () => {
    const { repository } = await world('admin');
    expect('deleteSanction' in repository).toBe(false);
  });
});

describe('account standing is not review status', () => {
  it('leaves published reviews exactly where they are', async () => {
    const { admin, repository, subject, property, review } = await world('admin');

    await admin.applySanction({
      userId: subject.id,
      action: 'banned',
      reasonKey: 'threats',
      reason: 'Credible threat against a named person',
      durationDays: null,
    });

    const after = await repository.getReviewById(review.id);
    expect(after?.status).toBe('published');
    expect(after?.body).toContain('Repairs took months');

    // Still on the property page. A banned account keeps its published reviews,
    // which is what the legal pages promise.
    const published = await repository.listPublicReviews(property.id);
    expect(published.total).toBe(1);
  });

  it('leaves an account active when only its review was removed', async () => {
    const { repository, actor, subject, review } = await world('admin');

    await repository.setReviewStatus(review.id, 'removed', actor.id, 'Fabricated content');

    // The other direction: removing a review says nothing about its author's
    // standing, and nothing about it was changed.
    expect((await repository.getUserById(subject.id))?.status).toBe('active');
    expect(await repository.listSanctions({ userId: subject.id })).toHaveLength(0);
  });
});
