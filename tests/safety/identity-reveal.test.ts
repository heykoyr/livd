import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The identity boundary.
 *
 * This is the operation the whole product is built around not doing casually.
 * "Anonymous to the public, accountable to Livd" means somebody at Livd can
 * find out who wrote a review — and it means that finding out is an event with
 * a name on it, not a page load.
 *
 * The property these tests exist to pin is narrow and absolute: **there is no
 * ordering in which an address is disclosed and no record is written.** Against
 * Postgres that is a transaction — `livd_reveal_user_identity` inserts the
 * audit entry and returns the address in one statement block. Here it is
 * ordering: the record is written first, and the address is returned only if
 * that succeeded.
 *
 * Everything else — the role, the reason, the detail requirement — is friction
 * around that one guarantee.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-reveal-'));
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

const REVIEWER_EMAIL = 'anonymous.reviewer@example.test';

async function actingAs(role: 'resident' | 'owner' | 'moderator' | 'trust_admin' | 'admin') {
  const { LocalRepository } = await import('@/server/data/local');
  const { mutate } = await import('@/server/data/local/store');
  const repository = new LocalRepository();

  const actor = await repository.upsertUser({ email: `${role}@example.test` });
  const reviewer = await repository.upsertUser({ email: REVIEWER_EMAIL });

  // Both roles are set explicitly, including `resident`. The local adapter
  // makes the first account in a fresh store an administrator so the moderation
  // tools are reachable during development — which silently made the "resident"
  // in this fixture an admin, and turned a test that should have caught a
  // privilege failure into one that passed for the wrong reason. A fixture that
  // depends on a default is a fixture that is not testing what it says.
  await mutate((database) => {
    const actorRow = database.users.find((u) => u.id === actor.id);
    if (actorRow) actorRow.role = role;

    const reviewerRow = database.users.find((u) => u.id === reviewer.id);
    if (reviewerRow) reviewerRow.role = 'resident';
  });

  const current = await repository.getUserById(actor.id);
  vi.doMock('@/server/auth/guards', async () => {
    const real = await vi.importActual<typeof import('@/server/auth/guards')>(
      '@/server/auth/guards',
    );
    return { ...real, requireUser: async () => current };
  });

  const admin = await import('@/server/admin');
  return { admin, repository, actor: current!, reviewer };
}

describe('who may cross the boundary', () => {
  it('refuses a resident', async () => {
    const { admin, reviewer } = await actingAs('resident');

    const result = await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'safety_investigation',
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(REVIEWER_EMAIL);
  });

  it('refuses a property owner', async () => {
    // The party a reviewer most needs protecting from. An owner who claimed a
    // property and disliked a review must find nothing here.
    const { admin, reviewer } = await actingAs('owner');

    const result = await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'safety_investigation',
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(REVIEWER_EMAIL);
  });

  it('refuses a moderator', async () => {
    const { admin, reviewer } = await actingAs('moderator');

    const result = await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'safety_investigation',
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/not authorised/i);
    expect(JSON.stringify(result)).not.toContain(REVIEWER_EMAIL);
  });

  it('allows a Trust & Safety admin', async () => {
    const { admin, reviewer } = await actingAs('trust_admin');

    const result = await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'safety_investigation',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.email).toBe(REVIEWER_EMAIL);
  });

  it('allows an administrator', async () => {
    const { admin, reviewer } = await actingAs('admin');

    const result = await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'fraud_investigation',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.email).toBe(REVIEWER_EMAIL);
  });
});

describe('a reason is not optional', () => {
  it('refuses a reason nobody has defined', async () => {
    const { admin, reviewer } = await actingAs('trust_admin');

    const result = await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'because_i_felt_like_it',
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(REVIEWER_EMAIL);
  });

  it('refuses "other" with a token explanation', async () => {
    const { admin, reviewer } = await actingAs('trust_admin');

    const result = await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'other',
      reasonDetail: 'hmm',
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/written explanation/i);
  });

  it('accepts "other" with real words', async () => {
    const { admin, reviewer } = await actingAs('trust_admin');

    const result = await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'other',
      reasonDetail: 'Duplicate accounts suspected across four unrelated properties.',
    });

    expect(result.ok).toBe(true);
  });

  it('demands an explanation for a legal request', async () => {
    const { admin, reviewer } = await actingAs('trust_admin');

    const result = await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'legal_request',
      reasonDetail: null,
    });

    expect(result.ok).toBe(false);
  });
});

describe('the record and the disclosure cannot come apart', () => {
  it('writes an audit entry naming the actor, the target and the reason', async () => {
    const { admin, repository, actor, reviewer } = await actingAs('trust_admin');

    await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'safety_investigation',
      reasonDetail: 'Credible threat reported against a resident.',
      caseReference: 'LV-1048',
    });

    const log = await repository.listAdminAudit();
    const entry = log.items.find((row) => row.action === 'identity_revealed');

    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(actor.id);
    expect(entry?.actorRole).toBe('trust_admin');
    expect(entry?.subjectId).toBe(reviewer.id);
    expect(entry?.outcome).toBe('succeeded');
    expect(entry?.reason).toContain('Safety investigation');
    expect(entry?.reason).toContain('Credible threat');
    expect(entry?.detail.caseReference).toBe('LV-1048');
  });

  it('never puts the address into the record it writes', async () => {
    // An audit log that quotes the address it is recording access to has become
    // a second copy of the thing it protects.
    const { admin, repository, reviewer } = await actingAs('trust_admin');

    await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'safety_investigation',
    });

    const log = await repository.listAdminAudit();
    expect(JSON.stringify(log)).not.toContain(REVIEWER_EMAIL);
    expect(JSON.stringify(log)).not.toContain('anonymous.reviewer');
  });

  it('discloses nothing when the record cannot be written', async () => {
    // The guarantee, stated as a test. Postgres gets this from a transaction;
    // here it comes from writing the record first.
    const { admin, reviewer } = await actingAs('trust_admin');
    const { LocalRepository } = await import('@/server/data/local');

    vi.spyOn(LocalRepository.prototype, 'recordAdminAudit').mockRejectedValue(
      new Error('audit sink down'),
    );
    const store = await import('@/server/data/local/store');
    vi.spyOn(store, 'mutate').mockRejectedValue(new Error('audit sink down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'safety_investigation',
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(REVIEWER_EMAIL);
  });

  it('records a refused attempt, so repeated trying is visible', async () => {
    const { admin, repository, actor, reviewer } = await actingAs('moderator');

    await admin.revealIdentity({ userId: reviewer.id, reasonKey: 'safety_investigation' });
    await admin.revealIdentity({ userId: reviewer.id, reasonKey: 'fraud_investigation' });

    const log = await repository.listAdminAudit();
    const denials = log.items.filter(
      (row) => row.action === 'identity_revealed' && row.outcome === 'denied',
    );

    expect(denials).toHaveLength(2);
    expect(denials[0]?.actorId).toBe(actor.id);
    expect(denials[0]?.subjectId).toBe(reviewer.id);
  });

  it('writes exactly one entry per successful reveal', async () => {
    // The database audits this one transactionally; the layer must not add a
    // second row for the same act.
    const { admin, repository, reviewer } = await actingAs('trust_admin');

    await admin.revealIdentity({ userId: reviewer.id, reasonKey: 'safety_investigation' });

    const log = await repository.listAdminAudit();
    const reveals = log.items.filter((row) => row.action === 'identity_revealed');

    expect(reveals).toHaveLength(1);
  });
});

describe('what a reveal returns', () => {
  it('returns the address and the account metadata, and nothing more', async () => {
    const { admin, reviewer } = await actingAs('trust_admin');

    const result = await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'safety_investigation',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Data minimisation: the reveal answers "who is this account" and stops.
    expect(Object.keys(result.data).sort()).toEqual(
      ['accountId', 'auditEntryId', 'countryCode', 'createdAt', 'email', 'role', 'status'].sort(),
    );
    expect(result.data.accountId).toBe(reviewer.id);
  });

  it('refuses a reveal of your own account, which needs no machinery', async () => {
    const { admin, actor } = await actingAs('trust_admin');

    const result = await admin.revealIdentity({
      userId: actor.id,
      reasonKey: 'safety_investigation',
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/your own account/i);
  });

  it('refuses an account that does not exist', async () => {
    const { admin } = await actingAs('trust_admin');

    const result = await admin.revealIdentity({
      userId: '00000000-0000-0000-0000-000000000000',
      reasonKey: 'safety_investigation',
    });

    expect(result.ok).toBe(false);
  });
});

describe('the access history', () => {
  it('is readable by a moderator, who cannot perform the access', async () => {
    const { admin, repository, reviewer } = await actingAs('trust_admin');

    await admin.revealIdentity({
      userId: reviewer.id,
      reasonKey: 'safety_investigation',
      caseReference: 'LV-1048',
    });

    // Seeing that an identity was looked at is the deterrent, and it is a
    // different thing from being able to look.
    const history = await repository.listIdentityAccess(reviewer.id);

    expect(history).toHaveLength(1);
    expect(history[0]?.caseReference).toBe('LV-1048');
    expect(history[0]?.outcome).toBe('succeeded');
    expect(JSON.stringify(history)).not.toContain(REVIEWER_EMAIL);
  });
});

describe('the reason vocabulary matches the database', () => {
  it('offers the same keys migration 0025 defines', async () => {
    const { admin } = await actingAs('trust_admin');
    const reasons = await admin.identityAccessReasons();

    expect(reasons.map((reason) => reason.key).sort()).toEqual(
      [
        'fraud_investigation',
        'legal_request',
        'other',
        'regulatory_request',
        'safety_investigation',
        'security_investigation',
        'serious_abuse',
      ].sort(),
    );
  });

  it('marks the three that need real words', async () => {
    const { admin } = await actingAs('trust_admin');
    const reasons = await admin.identityAccessReasons();

    const needsDetail = reasons.filter((reason) => reason.requiresDetail).map((r) => r.key);
    expect(needsDetail.sort()).toEqual(['legal_request', 'other', 'regulatory_request']);
  });
});
