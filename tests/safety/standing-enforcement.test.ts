import { createHmac } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { removeTree } from '../temp-dir';

/**
 * Account standing, as it is actually enforced.
 *
 * Written after the Trust & Safety audit of 17 September 2026, which found the
 * sanction system recording decisions that the rest of the product did not
 * honour. Each block below is one of those findings, pinned against the local
 * adapter; `scripts/security/sanctions-matrix.sql` is the same set against the
 * real database, where the grants and triggers apply. Migration 0050 is the
 * fix, and its header is the write-up.
 *
 *   the ladder     a lighter sanction must not replace a heavier one, and the
 *                  bare status path must not let a moderator ban or un-ban
 *   the session    a banned account is signed out, as a suspended one is
 *   corrections    an author who is not in good standing cannot rewrite
 *   deletion       an account the record refers to can still be deleted, and
 *                  the record survives it, unattributed
 *   the audit log  nobody records the success of something that did not happen
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-standing-'));
  process.chdir(workDir);
  process.env.LIVD_DATA_BACKEND = 'local';
  process.env.LIVD_SHOW_DEMO_DATA = 'false';
});

afterAll(async () => {
  process.chdir(original.cwd);
  if (original.backend === undefined) delete process.env.LIVD_DATA_BACKEND;
  else process.env.LIVD_DATA_BACKEND = original.backend;
  await removeTree(workDir);
});

beforeEach(async () => {
  vi.resetModules();
  const { resetCache } = await import('@/server/data/local/store');
  resetCache();
  await removeTree(join(workDir, '.data'));
});

afterEach(() => {
  vi.doUnmock('next/headers');
});

async function world() {
  const { LocalRepository } = await import('@/server/data/local');
  const { mutate } = await import('@/server/data/local/store');
  const repository = new LocalRepository();

  const moderator = await repository.upsertUser({ email: 'moderator@example.test' });
  const trustAdmin = await repository.upsertUser({ email: 'trust@example.test' });
  const administrator = await repository.upsertUser({ email: 'admin@example.test' });
  const author = await repository.upsertUser({ email: 'author@example.test' });

  await mutate((database) => {
    for (const [id, role] of [
      [moderator.id, 'moderator'],
      [trustAdmin.id, 'trust_admin'],
      [administrator.id, 'admin'],
      [author.id, 'resident'],
    ] as const) {
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
      coordinates: null,
    },
    author.id,
  );

  const review = await repository.createReview(
    {
      propertyId: property.id,
      residencyStatus: 'current',
      movedInMonth: '2024-01-01',
      movedOutMonth: null,
      overallRating: 2,
      categoryRatings: [{ categoryKey: 'management', rating: 2 }],
      positiveTags: [],
      problemTags: [],
      primaryDepartureReason: null,
      secondaryDepartureReasons: [],
      noticedManagementChange: null,
      body: 'Repairs took months and the managing agent stopped replying to anybody.',
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

  return { repository, moderator, trustAdmin, administrator, author, review };
}

const status = async (
  repository: Awaited<ReturnType<typeof world>>['repository'],
  id: string,
) => (await repository.getUserById(id))?.status;

describe('the ladder', () => {
  it('keeps a banned account banned when a lighter sanction is applied on top', async () => {
    const { repository, moderator, administrator, author } = await world();

    await repository.applySanction({
      userId: author.id,
      action: 'banned',
      reasonKey: 'threats',
      reason: 'Threatened a neighbour by name',
      durationDays: null,
      caseId: null,
      actorId: administrator.id,
    });

    // Recorded — it may outlast the ban if the ban is lifted — but it does not
    // replace it. Before 0050 this un-banned the account.
    await repository.applySanction({
      userId: author.id,
      action: 'restricted',
      reasonKey: 'spam',
      reason: 'Promotional posting',
      durationDays: 7,
      caseId: null,
      actorId: moderator.id,
    });

    expect(await status(repository, author.id)).toBe('banned');
    expect(await repository.listSanctions({ userId: author.id })).toHaveLength(2);
  });

  it('returns to the lighter sanction when the heavier one is lifted', async () => {
    const { repository, moderator, administrator, author } = await world();

    await repository.applySanction({
      userId: author.id,
      action: 'restricted',
      reasonKey: 'spam',
      reason: 'Promotional posting',
      durationDays: 7,
      caseId: null,
      actorId: moderator.id,
    });
    const banId = await repository.applySanction({
      userId: author.id,
      action: 'banned',
      reasonKey: 'threats',
      reason: 'Threatened a neighbour by name',
      durationDays: null,
      caseId: null,
      actorId: administrator.id,
    });

    await repository.liftSanction(banId, 'Upheld on appeal', administrator.id);

    expect(await status(repository, author.id)).toBe('restricted');
  });

  it('refuses a moderator banning through the bare status path', async () => {
    const { repository, moderator, author } = await world();

    await expect(
      repository.setUserStatus(author.id, 'banned', moderator.id, 'a ban by the side door'),
    ).rejects.toThrow('Only an administrator may ban an account or lift a ban');

    expect(await status(repository, author.id)).toBe('active');
  });

  it('refuses a moderator or a trust admin un-banning through the bare status path', async () => {
    const { repository, moderator, trustAdmin, administrator, author } = await world();

    await repository.applySanction({
      userId: author.id,
      action: 'banned',
      reasonKey: 'threats',
      reason: 'Threatened a neighbour by name',
      durationDays: null,
      caseId: null,
      actorId: administrator.id,
    });

    for (const actor of [moderator, trustAdmin]) {
      await expect(
        repository.setUserStatus(author.id, 'active', actor.id, 'un-ban by the side door'),
      ).rejects.toThrow('Only an administrator may ban an account or lift a ban');
    }

    expect(await status(repository, author.id)).toBe('banned');
  });

  it('refuses a moderator lifting a suspension through the bare status path', async () => {
    const { repository, moderator, trustAdmin, author } = await world();

    await repository.setUserStatus(author.id, 'suspended', trustAdmin.id, 'Abusive conduct');

    await expect(
      repository.setUserStatus(author.id, 'restricted', moderator.id, 'downgrade it quietly'),
    ).rejects.toThrow('Suspending an account requires Trust and Safety authorisation');
  });

  it('still lets a moderator restrict and restore', async () => {
    const { repository, moderator, author } = await world();

    await repository.setUserStatus(author.id, 'restricted', moderator.id, 'Repeated spam');
    expect(await status(repository, author.id)).toBe('restricted');

    await repository.setUserStatus(author.id, 'active', moderator.id, 'Explained on review');
    expect(await status(repository, author.id)).toBe('active');
  });
});

describe('the session', () => {
  async function sessionFor(userId: string) {
    // Whatever secret the suite runs with — tests/setup.ts sets one — so the
    // cookie is genuine and a refusal means the standing, not the signature.
    // The control below is what proves that: without it, a cookie signed with
    // the wrong key made every "signed out" assertion pass for nothing.
    const secret = process.env.LIVD_SESSION_SECRET ?? 'livd-insecure-development-secret';
    const signature = createHmac('sha256', secret)
      .update(userId)
      .digest('base64url');

    vi.doMock('next/headers', () => ({
      cookies: async () => ({
        get: (name: string) =>
          name === 'livd_session' ? { value: `${userId}.${signature}` } : undefined,
      }),
    }));

    const { getCurrentUser } = await import('@/server/auth/session');
    return getCurrentUser();
  }

  it.each(['suspended', 'banned'] as const)('signs a %s account out', async (standing) => {
    const { repository, trustAdmin, administrator, author } = await world();

    await repository.applySanction({
      userId: author.id,
      action: standing,
      reasonKey: standing === 'banned' ? 'threats' : 'harassment',
      reason: 'Conduct towards another resident',
      durationDays: standing === 'banned' ? null : 7,
      caseId: null,
      actorId: standing === 'banned' ? administrator.id : trustAdmin.id,
    });

    expect(await sessionFor(author.id)).toBeNull();
  });

  it('keeps an account in good standing signed in', async () => {
    const { author } = await world();
    expect((await sessionFor(author.id))?.id).toBe(author.id);
  });

  it('refuses a restricted account at the Server Action guard', async () => {
    const { repository, moderator, author } = await world();

    await repository.applySanction({
      userId: author.id,
      action: 'restricted',
      reasonKey: 'spam',
      reason: 'Promotional posting',
      durationDays: 7,
      caseId: null,
      actorId: moderator.id,
    });

    await sessionFor(author.id);
    const { requireUser } = await import('@/server/auth/guards');
    await expect(requireUser()).rejects.toThrow(/restricted/);
  });
});

describe('corrections', () => {
  it('refuses a correction from an author who is no longer in good standing', async () => {
    const { repository, administrator, author, review } = await world();

    await repository.applySanction({
      userId: author.id,
      action: 'banned',
      reasonKey: 'threats',
      reason: 'Threatened a neighbour by name',
      durationDays: null,
      caseId: null,
      actorId: administrator.id,
    });

    await expect(
      repository.updateReview(review.id, author.id, {
        body: 'Rewritten after the ban, to say something else entirely about the building.',
      }),
    ).rejects.toThrow('This account cannot change its reviews while a restriction is in place');
  });

  it('still lets an author in good standing correct their review', async () => {
    const { repository, author, review } = await world();

    const { review: corrected } = await repository.updateReview(review.id, author.id, {
      body: 'Repairs took months, and the managing agent eventually stopped replying.',
    });

    expect(corrected.body).toContain('eventually');
  });
});

describe('deletion', () => {
  it('deletes a sanctioned account and keeps the record, unattributed', async () => {
    const { repository, moderator, author } = await world();

    const sanctionId = await repository.applySanction({
      userId: author.id,
      action: 'restricted',
      reasonKey: 'spam',
      reason: 'Promotional posting',
      durationDays: 7,
      caseId: null,
      actorId: moderator.id,
    });

    await repository.recordAdminAudit({
      actorId: author.id,
      action: 'identity_revealed',
      subjectType: 'user',
      subjectId: moderator.id,
      outcome: 'denied',
      reason: null,
      detail: {},
      actorIpHash: null,
    });

    await repository.deleteAccount(author.id);

    const sanction = (await repository.listSanctions({})).find((entry) => entry.id === sanctionId);
    expect(sanction).toBeDefined();
    expect(sanction?.userId).toBeNull();
    expect(await repository.getUserById(author.id)).toBeNull();
  });
});

describe('the audit log', () => {
  it('refuses a completed action recorded by somebody who is not staff', async () => {
    const { repository, author, moderator } = await world();

    await expect(
      repository.recordAdminAudit({
        actorId: author.id,
        action: 'user_detail_viewed',
        subjectType: 'user',
        subjectId: moderator.id,
        outcome: 'succeeded',
        reason: null,
        detail: {},
        actorIpHash: null,
      }),
    ).rejects.toThrow('Only staff may record a completed administrative action');
  });

  it('refuses a completed reveal recorded by anybody, because the reveal records itself', async () => {
    const { repository, administrator, author } = await world();

    await expect(
      repository.recordAdminAudit({
        actorId: administrator.id,
        action: 'identity_revealed',
        subjectType: 'user',
        subjectId: author.id,
        outcome: 'succeeded',
        reason: 'forged',
        detail: {},
        actorIpHash: null,
      }),
    ).rejects.toThrow('That action is recorded by the operation that performs it');
  });

  it('still records a refusal from anybody, which is what the log is for', async () => {
    const { repository, administrator, author } = await world();

    await expect(
      repository.recordAdminAudit({
        actorId: author.id,
        action: 'identity_revealed',
        subjectType: 'user',
        subjectId: administrator.id,
        outcome: 'denied',
        reason: null,
        detail: {},
        actorIpHash: null,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('the migration says the same thing', () => {
  const migration = () =>
    readFile(
      join(original.cwd, 'supabase', 'migrations', '0050_standing_and_the_record.sql'),
      'utf8',
    );

  it('severs every account column the append-only record holds, rather than refusing', async () => {
    const sql = await migration();

    for (const [table, columns] of [
      ['moderation_actions', "'actor_id'"],
      ['admin_audit_log', "'actor_id'"],
      ['review_snapshots', "'changed_by'"],
      ['case_events', "'actor_id'"],
      ['case_notes', "'author_id'"],
      ['disclosure_records', "'subject_user_id', 'authorised_by', 'recorded_by'"],
    ] as const) {
      expect(sql, table).toMatch(
        new RegExp(
          `before update or delete on ${table}\\s+for each row execute function\\s+livd_forbid_mutation_except_severance\\(${columns}\\)`,
        ),
      );
    }

    expect(sql).toContain(
      'foreign key (user_id) references profiles(id) on delete set null',
    );
  });

  it('binds standing to the correction path and to the child tables', async () => {
    const sql = await migration();

    expect(sql).toContain('create trigger reviews_guard_author_standing');
    expect(sql).toMatch(/livd_review_is_open_for_me[\s\S]+select livd_is_active_user\(\) and exists/);
  });

  it('never gives the sanctioned person the written reason', async () => {
    const sql = await migration();
    const body = sql.slice(sql.indexOf('create function livd_my_sanctions()'));
    const select = body.slice(body.indexOf('select s.action'), body.indexOf('from user_sanctions'));

    expect(select).not.toMatch(/s\.reason\b(?!_key)/);
  });
});
