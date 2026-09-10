import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The audit trail.
 *
 * Two records read as one: what was decided about content and accounts, and
 * who touched a person's information. The properties pinned here are the ones
 * that make it a record rather than a log:
 *
 *   a decision and the entry explaining it are one act, not two
 *   reading the trail is itself recorded
 *   a refused attempt is recorded as well as a completed one
 *   an entry carries the name of what was touched, never the value
 *   nothing can edit or delete either trail
 *
 * Note the fixtures set every role explicitly, `resident` included. The local
 * store makes the first account in a fresh database an administrator as a
 * development convenience, and a security test that leans on a default is
 * testing the default rather than the control.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-trail-'));
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

async function world(readerRole: 'moderator' | 'trust_admin' | 'admin' = 'trust_admin') {
  const { LocalRepository } = await import('@/server/data/local');
  const { mutate } = await import('@/server/data/local/store');
  const repository = new LocalRepository();

  const reader = await repository.upsertUser({ email: 'the.reader@example.test' });
  const moderator = await repository.upsertUser({ email: 'the.moderator@example.test' });
  const author = await repository.upsertUser({ email: 'the.author@example.test' });

  await mutate((database) => {
    const roles: Array<[string, 'moderator' | 'trust_admin' | 'admin' | 'resident']> = [
      [reader.id, readerRole],
      [moderator.id, 'moderator'],
      [author.id, 'resident'],
    ];

    for (const [id, role] of roles) {
      const user = database.users.find((u) => u.id === id);
      if (user) user.role = role;
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
      body: 'Repairs took months and the managing agent stopped replying entirely.',
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

  const current = await repository.getUserById(reader.id);
  vi.doMock('@/server/auth/guards', async () => {
    const real = await vi.importActual<typeof import('@/server/auth/guards')>(
      '@/server/auth/guards',
    );
    return { ...real, requireUser: async () => current };
  });

  const admin = await import('@/server/admin');
  return { admin, repository, reader: current!, moderator, author, property, review };
}

describe('a decision and its record are one act', () => {
  it('writes the entry with the change, carrying the reason', async () => {
    const { repository, moderator, review } = await world();

    await repository.setReviewStatus(review.id, 'held', moderator.id, 'Under investigation.');

    const trail = await repository.listAuditFeed({});
    const entry = trail.items.find((row) => row.action === 'review_status_changed');

    expect(entry).toBeDefined();
    expect(entry?.reason).toBe('Under investigation.');
    expect(entry?.rawAction).toBe('set_status:held');
    expect(entry?.detail.previousStatus).toBe('published');
    expect(entry?.detail.newStatus).toBe('held');
    expect(entry?.actorRole).toBe('moderator');
  });

  it('refuses a verification override with no reason', async () => {
    // `verified_resident` multiplies a review's weight in the property score.
    // Setting it by hand with nothing written down leaves the question "why is
    // this verified when no document was approved" with no answer anywhere.
    const { repository, moderator, review } = await world();

    await expect(
      repository.setReviewVerification(review.id, 'verified_resident', moderator.id, ''),
    ).rejects.toThrow(/reason is required/i);

    const trail = await repository.listAuditFeed({});
    expect(trail.items.some((row) => row.action === 'review_verification_changed')).toBe(false);
  });

  it('refuses a claim decision with no reason', async () => {
    const { repository, moderator, author, property } = await world();

    const claim = await repository.createClaim({
      propertyId: property.id,
      claimantId: author.id,
      roleClaimed: 'manager',
      organisation: 'Example Lettings',
      contactEmail: 'lettings@example.test',
    });

    await expect(repository.decideClaim(claim.id, 'approved', moderator.id, '')).rejects.toThrow(
      /reason is required/i,
    );
  });

  it('refuses to decide a claim twice', async () => {
    const { repository, moderator, author, property } = await world();

    const claim = await repository.createClaim({
      propertyId: property.id,
      claimantId: author.id,
      roleClaimed: 'manager',
      organisation: 'Example Lettings',
      contactEmail: 'lettings@example.test',
    });

    await repository.decideClaim(claim.id, 'approved', moderator.id, 'Companies House matched.');

    await expect(
      repository.decideClaim(claim.id, 'rejected', moderator.id, 'Changed my mind.'),
    ).rejects.toThrow(/already been decided/i);
  });

  it('refuses to approve a second claim while one is held', async () => {
    // This used to revoke the other claim silently, inside somebody else's
    // approval. Taking a commercial party's public voice on a property page
    // away is a decision with consequences and needs its own act.
    const { repository, moderator, author, property } = await world();

    const first = await repository.createClaim({
      propertyId: property.id,
      claimantId: author.id,
      roleClaimed: 'manager',
      organisation: 'Example Lettings',
      contactEmail: 'lettings@example.test',
    });
    const second = await repository.createClaim({
      propertyId: property.id,
      claimantId: moderator.id,
      roleClaimed: 'owner',
      organisation: 'Someone Else Ltd',
      contactEmail: 'someone@example.test',
    });

    await repository.decideClaim(first.id, 'approved', moderator.id, 'Companies House matched.');

    await expect(
      repository.decideClaim(second.id, 'approved', moderator.id, 'Also looks plausible.'),
    ).rejects.toThrow(/already approved/i);
  });
});

describe('reading the trail is recorded', () => {
  it('writes exactly one entry per read', async () => {
    const { admin, repository } = await world();

    const before = await repository.listAdminAudit();
    expect(before.items.filter((row) => row.action === 'audit_log_read')).toHaveLength(0);

    await admin.readAuditTrail({});

    const after = await repository.listAdminAudit();
    expect(after.items.filter((row) => row.action === 'audit_log_read')).toHaveLength(1);
  });

  it('does not show a read inside its own results', async () => {
    const { admin } = await world();

    const page = await admin.readAuditTrail({ includeReads: true });

    expect(page.items.some((row) => row.action === 'audit_log_read')).toBe(false);
  });

  it('hides read entries by default and shows them when asked', async () => {
    const { admin } = await world();

    await admin.readAuditTrail({});
    await admin.readAuditTrail({});

    const hidden = await admin.readAuditTrail({});
    expect(hidden.items.some((row) => row.action === 'audit_log_read')).toBe(false);

    const shown = await admin.readAuditTrail({ includeReads: true });
    expect(shown.items.filter((row) => row.action === 'audit_log_read').length).toBeGreaterThan(0);
  });

  it('records what was looked at, never what was found', async () => {
    const { admin, repository, review } = await world();

    await admin.readAuditTrail({ action: 'review_status_changed', subjectId: review.id });

    const log = await repository.listAdminAudit({ action: 'audit_log_read' });
    const entry = log.items[0];

    expect(entry?.detail.action).toBe('review_status_changed');
    // The number of rows returned is deliberately absent. An entry that
    // summarised the log would be a second copy of the log.
    expect(entry?.detail).not.toHaveProperty('returned');
    expect(entry?.detail).not.toHaveProperty('matched');
  });

  it('does not record a read for the summaries', async () => {
    // They run on the same page load as the feed, which does. Three entries
    // for one visit would say something false about how often it was opened.
    const { admin, repository } = await world();

    await admin.readAuditSummary();
    await admin.readAuditActors();

    const log = await repository.listAdminAudit();
    expect(log.items.filter((row) => row.action === 'audit_log_read')).toHaveLength(0);
  });
});

describe('who may read it', () => {
  it('gives a moderator nothing', async () => {
    const { admin } = await world('moderator');

    expect((await admin.readAuditTrail({})).items).toEqual([]);
    expect(await admin.readAuditSummary()).toEqual([]);
    expect(await admin.readAuditActors()).toEqual([]);
  });

  it('records no read for somebody who was refused', async () => {
    // Nothing happened, so nothing is recorded here. The refusal that matters
    // is the one the database makes, and a moderator never reaches it.
    const { admin, repository } = await world('moderator');

    await admin.readAuditTrail({});

    const log = await repository.listAdminAudit();
    expect(log.items.filter((row) => row.action === 'audit_log_read')).toHaveLength(0);
  });

  it('lets Trust & Safety read both trails at once', async () => {
    const { admin, repository, moderator, review } = await world('trust_admin');

    await repository.setReviewStatus(review.id, 'held', moderator.id, 'Under investigation.');
    await repository.recordAdminAudit({
      actorId: moderator.id,
      action: 'user_detail_viewed',
      subjectType: 'user',
      subjectId: moderator.id,
      outcome: 'succeeded',
      reason: null,
      detail: {},
      actorIpHash: null,
    });

    const page = await admin.readAuditTrail({});

    expect(page.items.some((row) => row.source === 'moderation')).toBe(true);
    expect(page.items.some((row) => row.source === 'audit')).toBe(true);
  });
});

describe('what an entry carries', () => {
  it('identifies the actor by a mask, never an address', async () => {
    const { admin, repository, moderator, review } = await world();

    await repository.setReviewStatus(review.id, 'held', moderator.id, 'Under investigation.');

    const page = await admin.readAuditTrail({});
    const entry = page.items.find((row) => row.source === 'moderation');

    expect(entry?.actorEmailMasked).toBeTruthy();
    // The mask keeps the domain on purpose; what must never appear is the
    // local part that identifies the person.
    expect(JSON.stringify(page)).not.toContain('the.moderator');
  });

  it('holds no reviewer address anywhere in a page of it', async () => {
    const { admin, repository, moderator, review } = await world();

    await repository.setReviewStatus(review.id, 'removed', moderator.id, 'Off-topic.');

    const page = await admin.readAuditTrail({});
    expect(JSON.stringify(page)).not.toContain('the.author@example.test');
  });

  it('records a refused attempt as well as a completed one', async () => {
    // A system that logs only successes cannot tell you somebody has been
    // trying. The layer writes the denial before it returns one.
    const { admin, repository, moderator } = await world('moderator');

    const refused = await admin.revealIdentity({
      userId: moderator.id,
      reasonKey: 'law_enforcement',
      reasonDetail: 'Trying it on.',
      caseReference: null,
    });
    expect(refused.ok).toBe(false);

    const log = await repository.listAdminAudit();
    const denial = log.items.find((row) => row.outcome === 'denied');

    expect(denial?.action).toBe('identity_revealed');
  });

  it('keeps the role the actor had, not the one they have now', async () => {
    const { repository, moderator, review } = await world();
    const { mutate } = await import('@/server/data/local/store');

    await repository.setReviewStatus(review.id, 'held', moderator.id, 'Under investigation.');

    // They leave the team afterwards. The decision was still a moderator's.
    await mutate((database) => {
      const user = database.users.find((u) => u.id === moderator.id);
      if (user) user.role = 'resident';
    });

    const page = await repository.listAuditFeed({});
    const entry = page.items.find((row) => row.source === 'moderation');

    expect(entry?.actorRole).toBe('moderator');
  });
});

describe('filtering and order', () => {
  it('reads in the order things happened, not the order they were written', async () => {
    // Entries written inside one operation share a millisecond. A random id
    // would then decide the order of the record, which is the one thing a
    // record must not leave to chance.
    const { repository, moderator, review } = await world();

    await repository.setReviewStatus(review.id, 'held', moderator.id, 'First.');
    await repository.setReviewStatus(review.id, 'removed', moderator.id, 'Second.');
    await repository.setReviewStatus(review.id, 'published', moderator.id, 'Third.');

    const page = await repository.listAuditFeed({});
    const reasons = page.items
      .filter((row) => row.source === 'moderation')
      .map((row) => row.reason);

    expect(reasons).toEqual(['Third.', 'Second.', 'First.']);
  });

  it('filters by actor, action and subject', async () => {
    const { repository, moderator, reader, review } = await world();

    await repository.setReviewStatus(review.id, 'held', moderator.id, 'Under investigation.');
    await repository.recordAdminAudit({
      actorId: reader.id,
      action: 'user_detail_viewed',
      subjectType: 'user',
      subjectId: moderator.id,
      outcome: 'succeeded',
      reason: null,
      detail: {},
      actorIpHash: null,
    });

    expect((await repository.listAuditFeed({ actorId: moderator.id })).items).toHaveLength(1);
    expect(
      (await repository.listAuditFeed({ action: 'review_status_changed' })).items,
    ).toHaveLength(1);
    expect((await repository.listAuditFeed({ subjectId: review.id })).items).toHaveLength(1);
    expect((await repository.listAuditFeed({ source: 'audit' })).items).toHaveLength(1);
  });

  it('counts what happened without naming anybody', async () => {
    const { admin, repository, moderator, review } = await world();

    await repository.setReviewStatus(review.id, 'held', moderator.id, 'Under investigation.');

    const summary = await admin.readAuditSummary();
    const row = summary.find((entry) => entry.action === 'review_status_changed');

    expect(row?.entries).toBe(1);
    expect(row?.actors).toBe(1);
    expect(JSON.stringify(summary)).not.toContain('@');
  });

  it('lists the people in the trail by mask and role', async () => {
    const { admin, repository, moderator, review } = await world();

    await repository.setReviewStatus(review.id, 'held', moderator.id, 'Under investigation.');

    const actors = await admin.readAuditActors();
    const entry = actors.find((row) => row.actorId === moderator.id);

    expect(entry?.actorRole).toBe('moderator');
    expect(entry?.actorEmailMasked).toBeTruthy();
    expect(entry?.actorEmailMasked).not.toContain('the.moderator');
  });
});

describe('nothing can rewrite it', () => {
  it('offers no way to edit or delete an entry', async () => {
    const { repository } = await world();

    for (const forbidden of [
      'deleteAuditEntry',
      'updateAuditEntry',
      'clearAuditLog',
      'purgeAuditLog',
      'deleteModerationAction',
      'updateModerationAction',
    ]) {
      expect(forbidden in repository, `${forbidden} exists on the repository`).toBe(false);
    }
  });

  it('exposes no administrative operation that rewrites either trail', async () => {
    const { admin } = await world();

    for (const name of Object.keys(admin)) {
      expect(name).not.toMatch(/delete.*audit|purge|clear.*log|rewrite/i);
    }
  });
});
