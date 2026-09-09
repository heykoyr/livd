import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The account directory and the detail view.
 *
 * Two things are being pinned. The first is that neither surface can produce an
 * email address, whatever it is asked — the mask is applied in SQL against
 * Postgres and in the adapter here, and no shape returned by either has a field
 * for the real thing.
 *
 * The second is the search boundary. Looking an account up by its internal id
 * is a moderator's tool: the identifier means nothing outside Livd and cannot
 * be guessed. Looking one up by email address is not, because getting a result
 * back confirms that address holds an account on a platform where the accounts
 * write anonymous reviews of the buildings they live in. That confirmation is
 * the disclosure, and it needs Trust & Safety authorisation.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-directory-'));
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
  const subject = await repository.upsertUser({ email: 'quiet.resident@example.test' });
  const other = await repository.upsertUser({ email: 'someone.else@example.test' });

  await mutate((database) => {
    const row = database.users.find((u) => u.id === actor.id);
    if (row) row.role = actorRole;
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
      body: 'Repairs took months and the managing agent stopped replying entirely.',
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

  await repository.createReport({
    reviewId: review.id,
    reporterId: other.id,
    reason: 'false_information',
    detail: 'This is not accurate.',
  });

  const current = await repository.getUserById(actor.id);
  vi.doMock('@/server/auth/guards', async () => {
    const real = await vi.importActual<typeof import('@/server/auth/guards')>(
      '@/server/auth/guards',
    );
    return { ...real, requireUser: async () => current };
  });

  const admin = await import('@/server/admin');
  return { admin, repository, actor: current!, subject, other, property, review };
}

describe('searching', () => {
  it('lets a moderator look an account up by id prefix', async () => {
    const { admin, subject } = await world('moderator');

    const result = await admin.readUserDirectory({ search: subject.id.slice(0, 8) });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.items).toHaveLength(1);
    expect(result.ok && result.data.items[0]?.id).toBe(subject.id);
  });

  it('refuses a moderator searching by email address', async () => {
    const { admin } = await world('moderator');

    const result = await admin.readUserDirectory({ search: 'quiet.resident@example.test' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Trust & Safety authorisation/);
  });

  it('lets a Trust & Safety admin search by email address', async () => {
    const { admin, subject } = await world('trust_admin');

    const result = await admin.readUserDirectory({ search: 'quiet.resident@example.test' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.items[0]?.id).toBe(subject.id);
  });

  it('records that an email search happened, and never the address', async () => {
    const { admin, repository } = await world('trust_admin');

    await admin.readUserDirectory({ search: 'quiet.resident@example.test' });

    const log = await repository.listAdminAudit();
    const entry = log.items.find((row) => row.action === 'user_directory_searched');

    expect(entry?.detail.searchKind).toBe('email');

    // An audit log that quotes the address it was asked about has become
    // another copy of the thing it protects.
    expect(JSON.stringify(entry)).not.toContain('quiet.resident@example.test');
    expect(JSON.stringify(entry)).not.toContain('quiet.resident');
  });

  it('records a refused email search as a denial', async () => {
    const { admin, repository } = await world('moderator');

    await admin.readUserDirectory({ search: 'quiet.resident@example.test' });

    const log = await repository.listAdminAudit();
    expect(log.items[0]?.action).toBe('user_directory_searched');
    expect(log.items[0]?.outcome).toBe('denied');
  });
});

describe('filters', () => {
  it('narrows by standing', async () => {
    const { admin, repository, actor, subject } = await world('trust_admin');
    await repository.setUserStatus(subject.id, 'restricted', actor.id, 'Repeated spam');

    const restricted = await admin.readUserDirectory({ status: 'restricted' });
    expect(restricted.ok && restricted.data.items).toHaveLength(1);
    expect(restricted.ok && restricted.data.items[0]?.id).toBe(subject.id);

    const active = await admin.readUserDirectory({ status: 'active' });
    expect(active.ok && active.data.items.map((u) => u.id)).not.toContain(subject.id);
  });

  it('narrows to accounts something they wrote has been reported about', async () => {
    const { admin, subject } = await world('moderator');

    const reported = await admin.readUserDirectory({ hasReports: true });
    expect(reported.ok && reported.data.items).toHaveLength(1);
    expect(reported.ok && reported.data.items[0]?.id).toBe(subject.id);

    const clean = await admin.readUserDirectory({ hasReports: false });
    expect(clean.ok && clean.data.items.map((u) => u.id)).not.toContain(subject.id);
  });

  it('counts reviews and reports beside each account', async () => {
    const { admin, subject } = await world('moderator');

    const result = await admin.readUserDirectory({ search: subject.id.slice(0, 8) });
    const row = result.ok ? result.data.items[0] : null;

    expect(row?.reviewCount).toBe(1);
    expect(row?.reportsAgainst).toBe(1);
    expect(row?.verifiedReviewCount).toBe(0);
  });
});

describe('the detail view', () => {
  it('shows what the account wrote and what was reported', async () => {
    const { admin, subject, property } = await world('moderator');

    const result = await admin.readUserDetail({ userId: subject.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.detail.reviewCount).toBe(1);
    expect(result.data.detail.publishedReviewCount).toBe(1);
    expect(result.data.detail.reportsAgainst).toBe(1);
    expect(result.data.reviews.items[0]?.propertyId).toBe(property.id);
    expect(result.data.reports.items).toHaveLength(1);
  });

  it('agrees with the directory about the counts', async () => {
    // Two surfaces disagreeing about how many reviews somebody wrote is a bug
    // somebody chases for an afternoon.
    const { admin, subject } = await world('moderator');

    const listed = await admin.readUserDirectory({ search: subject.id.slice(0, 8) });
    const detailed = await admin.readUserDetail({ userId: subject.id });

    expect(listed.ok && detailed.ok).toBe(true);
    if (!listed.ok || !detailed.ok) return;

    expect(listed.data.items[0]?.reviewCount).toBe(detailed.data.detail.reviewCount);
    expect(listed.data.items[0]?.reportsAgainst).toBe(detailed.data.detail.reportsAgainst);
  });

  it('carries no email address anywhere in the payload', async () => {
    const { admin, subject } = await world('trust_admin');

    const result = await admin.readUserDetail({ userId: subject.id });
    const serialised = JSON.stringify(result);

    expect(serialised).not.toContain('quiet.resident@example.test');
    expect(serialised).not.toContain('quiet.resident');
    expect(result.ok && result.data.detail.maskedEmail).toBe('qui***@example.test');
    expect(result.ok && result.data.detail).not.toHaveProperty('email');
  });

  it('keeps the reporter anonymous to the investigator', async () => {
    const { admin, subject, other } = await world('trust_admin');

    const result = await admin.readUserDetail({ userId: subject.id });
    if (!result.ok) throw new Error('expected a result');

    // An id, so a pattern of nine reports from one account is visible. Nothing
    // more, because who that account belongs to is a different question.
    expect(result.data.reports.items[0]?.reporterId).toBe(other.id);
    expect(JSON.stringify(result.data.reports)).not.toContain('someone.else@example.test');
  });

  it('is audited, so who looked at an account can be answered', async () => {
    const { admin, repository, actor, subject } = await world('moderator');

    await admin.readUserDetail({ userId: subject.id });

    const log = await repository.listAdminAudit();
    const entry = log.items.find((row) => row.action === 'user_detail_viewed');

    expect(entry?.subjectId).toBe(subject.id);
    expect(entry?.actorId).toBe(actor.id);
    expect(entry?.outcome).toBe('succeeded');
  });

  it('refuses an account that does not exist, without saying which it was', async () => {
    const { admin } = await world('moderator');

    const result = await admin.readUserDetail({
      userId: '00000000-0000-0000-0000-000000000000',
    });

    expect(result.ok).toBe(false);
  });
});
