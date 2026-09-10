import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Evidence preservation.
 *
 * The audit found that "the original content is preserved" was not true.
 * `setReviewStatus` changed a status and recorded that it had, but kept no copy
 * of what the review said — and `livd_guard_review_update`, which stops an
 * author rewriting their ratings after the fact, returns `new` unconditionally
 * for a moderator. So a moderator could edit any review body and nothing
 * recorded what it had been.
 *
 * These tests pin the replacement. Against Postgres a BEFORE UPDATE trigger
 * takes the snapshot, so preservation happens whatever path changed the row and
 * cannot be skipped. The local adapter calls the same helper from the two
 * methods that change a review, which is weaker — and is exactly why the
 * guarantee that matters is the database's.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

const ORIGINAL_BODY =
  'Repairs took months and the managing agent stopped replying entirely. The boiler failed twice.';

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-evidence-'));
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

async function world(actorRole: 'moderator' | 'trust_admin' = 'moderator') {
  const { LocalRepository } = await import('@/server/data/local');
  const { mutate } = await import('@/server/data/local/store');
  const repository = new LocalRepository();

  const actor = await repository.upsertUser({ email: `${actorRole}@example.test` });
  const author = await repository.upsertUser({ email: 'author@example.test' });

  await mutate((database) => {
    const a = database.users.find((u) => u.id === actor.id);
    if (a) a.role = actorRole;
    const w = database.users.find((u) => u.id === author.id);
    if (w) w.role = 'resident';
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
    author.id,
  );

  const review = await repository.createReview(
    {
      propertyId: property.id,
      residencyStatus: 'former',
      movedInMonth: '2021-01-01',
      movedOutMonth: '2023-01-01',
      overallRating: 2,
      categoryRatings: [
        { categoryKey: 'management', rating: 2 },
        { categoryKey: 'building_maintenance', rating: 1 },
      ],
      positiveTags: [],
      problemTags: ['slow_repairs'],
      primaryDepartureReason: 'maintenance',
      secondaryDepartureReasons: [],
      noticedManagementChange: null,
      body: ORIGINAL_BODY,
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

  const current = await repository.getUserById(actor.id);
  vi.doMock('@/server/auth/guards', async () => {
    const real = await vi.importActual<typeof import('@/server/auth/guards')>(
      '@/server/auth/guards',
    );
    return { ...real, requireUser: async () => current };
  });

  const admin = await import('@/server/admin');
  return { admin, repository, actor: current!, author, property, review };
}

describe('removing a review does not destroy what it said', () => {
  it('preserves the content before the status changes', async () => {
    const { repository, actor, review } = await world();

    expect(await repository.listReviewSnapshots(review.id)).toHaveLength(0);

    await repository.setReviewStatus(review.id, 'removed', actor.id, 'Fabricated content');

    const snapshots = await repository.listReviewSnapshots(review.id);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.reason).toBe('moderation');
    // The state it was in *before* the removal — published, with its text.
    expect(snapshots[0]?.status).toBe('published');
    expect(snapshots[0]?.body).toBe(ORIGINAL_BODY);
    expect(snapshots[0]?.overallRating).toBe(2);
    expect(snapshots[0]?.categoryRatings).toHaveLength(2);
    expect(snapshots[0]?.problemTags).toContain('slow_repairs');
  });

  it('leaves the review row itself intact, only its visibility changed', async () => {
    const { repository, actor, author, review, property } = await world();

    await repository.setReviewStatus(review.id, 'removed', actor.id, 'Fabricated content');

    const after = await repository.getReviewById(review.id);

    // Removed from public view; the record is still there, still attributed,
    // still carrying its text. Nothing was deleted.
    expect(after).not.toBeNull();
    expect(after?.status).toBe('removed');
    expect(after?.body).toBe(ORIGINAL_BODY);
    expect(after?.authorId).toBe(author.id);

    const published = await repository.listPublicReviews(property.id);
    expect(published.total).toBe(0);
  });

  it('records who removed it and why, separately from the copy', async () => {
    const { repository, actor, review } = await world();

    await repository.setReviewStatus(review.id, 'removed', actor.id, 'Fabricated content');

    const trail = await repository.listModerationActions(review.id);
    const entry = trail.find((action) => action.action.includes('status'));

    expect(entry?.actorId).toBe(actor.id);
    expect(entry?.reason).toBe('Fabricated content');
    expect(entry?.previousStatus).toBe('published');
    expect(entry?.newStatus).toBe('removed');
  });

  it('keeps a copy for every change, not just the first', async () => {
    // Holding and then republishing is two decisions, and the state before each
    // is worth having — a review that was held, edited and restored should not
    // read as though it went straight from published to published.
    const { repository, actor, review } = await world();

    await repository.setReviewStatus(review.id, 'held', actor.id, 'Checking the claims');
    await repository.setReviewStatus(review.id, 'published', actor.id, 'Claims stand');

    const snapshots = await repository.listReviewSnapshots(review.id);

    expect(snapshots).toHaveLength(2);
    // Oldest first: the published original.
    const oldest = snapshots[snapshots.length - 1];
    expect(oldest?.body).toBe(ORIGINAL_BODY);
    expect(oldest?.status).toBe('published');
  });

  it('preserves the state before a verification level changes', async () => {
    const { repository, actor, review } = await world();

    await repository.setReviewVerification(review.id, 'disputed', actor.id, 'Contested tenancy.');

    const snapshots = await repository.listReviewSnapshots(review.id);
    expect(snapshots[0]?.reason).toBe('verification');
    expect(snapshots[0]?.verificationLevel).toBe('unverified');
  });

  it('does not snapshot when nothing meaningful changed', async () => {
    const { repository, actor, review } = await world();

    await repository.setReviewStatus(review.id, 'published', actor.id, 'No change');

    // A no-op is not worth a copy, and a trail full of them hides the real ones.
    expect(await repository.listReviewSnapshots(review.id)).toHaveLength(0);
  });

  it('offers no way to delete or edit a snapshot', async () => {
    // Postgres enforces this with a trigger that refuses even the table owner.
    // Here it is that the repository exposes no such operation.
    const { repository } = await world();
    expect('deleteReviewSnapshot' in repository).toBe(false);
    expect('updateReviewSnapshot' in repository).toBe(false);
  });
});

describe('case evidence', () => {
  async function withCase() {
    const w = await world();
    const opened = await w.admin.openCase({
      category: 'fake_review',
      summary: 'Possibly fabricated',
      reviewId: w.review.id,
    });
    if (!opened.ok) throw new Error('expected a case');
    return { ...w, caseId: opened.data.caseId };
  }

  it('is versioned rather than edited', async () => {
    const { admin, repository, caseId } = await withCase();

    const first = await admin.addCaseEvidence({
      caseId,
      kind: 'note',
      title: 'Screenshot from the reporter',
      description: 'As received.',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await admin.addCaseEvidence({
      caseId,
      kind: 'note',
      title: 'Screenshot, corrected crop',
      supersedes: first.data.evidenceId,
    });
    expect(second.ok).toBe(true);

    const items = await repository.listCaseEvidence(caseId);

    // Both remain. Evidence somebody can quietly improve once the outcome is
    // known is not evidence.
    expect(items).toHaveLength(2);

    const originalItem = items.find((item) => item.id === first.data.evidenceId);
    expect(originalItem?.superseded).toBe(true);
    expect(originalItem?.version).toBe(1);

    const corrected = items.find((item) => item.supersedes === first.data.evidenceId);
    expect(corrected?.version).toBe(2);
  });

  it('is withdrawn rather than deleted, with a reason', async () => {
    const { admin, repository, caseId } = await withCase();

    const added = await admin.addCaseEvidence({
      caseId,
      kind: 'note',
      title: 'Sent to us in error',
    });
    if (!added.ok) throw new Error('expected evidence');

    await admin.withdrawCaseEvidence({
      evidenceId: added.data.evidenceId,
      reason: 'Belongs to a different case',
    });

    const items = await repository.listCaseEvidence(caseId);

    expect(items).toHaveLength(1);
    expect(items[0]?.withdrawnAt).not.toBeNull();
    expect(items[0]?.withdrawnReason).toBe('Belongs to a different case');
    // The item and its title are still readable.
    expect(items[0]?.title).toBe('Sent to us in error');
  });

  it('refuses withdrawal without a reason', async () => {
    const { admin, caseId } = await withCase();

    const added = await admin.addCaseEvidence({ caseId, kind: 'note', title: 'A thing' });
    if (!added.ok) throw new Error('expected evidence');

    const result = await admin.withdrawCaseEvidence({
      evidenceId: added.data.evidenceId,
      reason: '  ',
    });

    expect(result.ok).toBe(false);
  });

  it('never returns a storage key', async () => {
    const { admin, repository, caseId } = await withCase();

    await admin.addCaseEvidence({ caseId, kind: 'file', title: 'A document' });

    const items = await repository.listCaseEvidence(caseId);
    const serialised = JSON.stringify(items);

    // A key in a payload is a key in a browser's memory, a screenshot and a
    // support ticket. The row says whether a file exists; nothing more.
    expect(serialised).not.toContain('storageRef');
    expect(serialised).not.toContain('case-evidence/');
    expect(items[0]).toHaveProperty('hasFile');
  });

  it('appears on the case timeline', async () => {
    const { admin, repository, caseId } = await withCase();

    const added = await admin.addCaseEvidence({ caseId, kind: 'note', title: 'A thing' });
    if (!added.ok) throw new Error('expected evidence');
    await admin.withdrawCaseEvidence({
      evidenceId: added.data.evidenceId,
      reason: 'Duplicated',
    });

    const events = await repository.listCaseEvents(caseId);
    const kinds = events.map((event) => event.kind);

    expect(kinds).toContain('evidence_added');
    expect(kinds).toContain('evidence_withdrawn');
  });

  it('refuses a resident', async () => {
    const { admin, repository, caseId, author } = await withCase();

    await expect(
      repository.addCaseEvidence({
        caseId,
        kind: 'note',
        title: 'Trying it on',
        description: null,
        supersedes: null,
        actorId: author.id,
      }),
    ).rejects.toThrow(/Only a moderator may add evidence/);

    void admin;
  });
});
