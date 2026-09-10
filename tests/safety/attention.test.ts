import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The dashboard.
 *
 * Three things are worth pinning, and only the first is about layout:
 *
 *   it reports the *age* of what is waiting, not only how much
 *   the Trust & Safety figures are null for a moderator, never zero
 *   it carries no identity and no content, so opening it discloses nothing
 *
 * The second matters more than it looks. Zero says "there are none"; null says
 * "not yours to see". A dashboard that answered a moderator's question about
 * how many authority requests are open — even with a truthful zero — would be
 * telling them something about a part of the system that is not theirs, and on
 * a quiet week the answer would be right often enough to be trusted.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-attention-'));
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

async function world(viewerRole: 'resident' | 'moderator' | 'trust_admin' | 'admin') {
  const { LocalRepository } = await import('@/server/data/local');
  const { mutate } = await import('@/server/data/local/store');
  const repository = new LocalRepository();

  const viewer = await repository.upsertUser({ email: 'the.viewer@example.test' });
  const other = await repository.upsertUser({ email: 'the.other@example.test' });
  const author = await repository.upsertUser({ email: 'the.author@example.test' });

  await mutate((database) => {
    const roles: Array<[string, string]> = [
      [viewer.id, viewerRole],
      [other.id, 'moderator'],
      [author.id, 'resident'],
    ];

    for (const [id, role] of roles) {
      const user = database.users.find((u) => u.id === id);
      if (user) user.role = role as typeof user.role;
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
      body: 'The boiler was broken for the whole of one winter and nobody replied.',
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

  const current = await repository.getUserById(viewer.id);
  vi.doMock('@/server/auth/guards', async () => {
    const real = await vi.importActual<typeof import('@/server/auth/guards')>(
      '@/server/auth/guards',
    );
    return { ...real, requireUser: async () => current };
  });

  const admin = await import('@/server/admin');
  return { admin, repository, viewer: current!, other, author, property, review };
}

describe('who sees what', () => {
  it('tells a resident nothing at all', async () => {
    const { admin } = await world('resident');

    const attention = await admin.readAttention();

    expect(attention.platform.reviews).toBe(0);
    expect(attention.platform.users).toBe(0);
    expect(attention.trustAndSafety).toBeNull();
  });

  it('gives a moderator the queues but not the legal figures', async () => {
    const { admin } = await world('moderator');

    const attention = await admin.readAttention();

    expect(attention.platform.users).toBeGreaterThan(0);
    // Null rather than zero. Zero would be an answer to a question that is not
    // theirs, and on a quiet week it would be right often enough to be trusted.
    expect(attention.trustAndSafety).toBeNull();
  });

  it('gives Trust & Safety the whole picture', async () => {
    const { admin } = await world('trust_admin');

    const attention = await admin.readAttention();

    expect(attention.trustAndSafety).not.toBeNull();
    expect(attention.trustAndSafety?.openAuthorityRequests).toBe(0);
    expect(attention.trustAndSafety?.refusalsLast7Days).toBe(0);
  });
});

describe('age, not only volume', () => {
  it('reports nothing waiting as a count of zero and no age', async () => {
    const { admin } = await world('moderator');

    const attention = await admin.readAttention();

    expect(attention.openReports.count).toBe(0);
    expect(attention.openReports.oldest).toBeNull();
  });

  it('reports the arrival of the oldest thing waiting, not the newest', async () => {
    // The whole point of the phase. Three open reports is a number; one of them
    // having been open nine days is the part somebody acts on.
    const { admin, repository, other, author, review } = await world('moderator');
    const { mutate } = await import('@/server/data/local/store');

    const first = await repository.createReport({
      reviewId: review.id,
      reporterId: other.id,
      reason: 'false_information',
      detail: 'The dates do not match.',
    });
    await repository.createReport({
      reviewId: review.id,
      reporterId: author.id,
      reason: 'spam',
      detail: 'Posted twice.',
    });

    const nineDaysAgo = new Date(Date.now() - 9 * 86_400_000).toISOString();
    await mutate((database) => {
      const report = database.reports.find((r) => r.id === first.id);
      if (report) report.createdAt = nineDaysAgo;
    });

    const attention = await admin.readAttention();

    expect(attention.openReports.count).toBe(2);
    expect(attention.openReports.oldest).toBe(nineDaysAgo);
  });

  it('stops counting something once it has been dealt with', async () => {
    const { admin, repository, other, review } = await world('moderator');

    const report = await repository.createReport({
      reviewId: review.id,
      reporterId: other.id,
      reason: 'false_information',
      detail: 'The dates do not match.',
    });

    expect((await admin.readAttention()).openReports.count).toBe(1);

    await repository.resolveReport(report.id, 'dismissed', other.id, 'Dates check out.');

    const after = await admin.readAttention();
    expect(after.openReports.count).toBe(0);
    expect(after.openReports.oldest).toBeNull();
  });
});

describe('cases', () => {
  it('counts a case as open until it is actually concluded', async () => {
    // `action_taken` still needs somebody to close it and `escalated` needs
    // somebody senior. Both are work, and both vanish from a naive
    // status === 'open' count.
    const { admin, repository, viewer, review } = await world('trust_admin');

    const caseId = await repository.openCase({
      category: 'review_manipulation',
      summary: 'Several reviews from new accounts in one week.',
      reviewId: review.id,
      actorId: viewer.id,
    });

    for (const status of ['open', 'investigating', 'action_taken', 'escalated'] as const) {
      await repository.setCaseStatus(caseId, status, 'Moving it along.', viewer.id);
      expect((await admin.readAttention()).cases.open, status).toBe(1);
    }

    await repository.setCaseStatus(caseId, 'resolved', 'Nothing further to do.', viewer.id);
    expect((await admin.readAttention()).cases.open).toBe(0);
  });

  it('separates yours from unassigned', async () => {
    const { admin, repository, viewer, other, review } = await world('trust_admin');

    const mine = await repository.openCase({
      category: 'review_manipulation',
      summary: 'One for me.',
      reviewId: review.id,
      actorId: viewer.id,
    });
    const theirs = await repository.openCase({
      category: 'review_manipulation',
      summary: 'One for somebody else.',
      reviewId: review.id,
      actorId: viewer.id,
    });
    await repository.openCase({
      category: 'review_manipulation',
      summary: 'One for nobody yet.',
      reviewId: review.id,
      actorId: viewer.id,
    });

    await repository.assignCase(mine, viewer.id, viewer.id);
    await repository.assignCase(theirs, other.id, viewer.id);

    const attention = await admin.readAttention();

    expect(attention.cases.open).toBe(3);
    expect(attention.cases.mine).toBe(1);
    expect(attention.cases.unassigned).toBe(1);
  });

  it('counts the critical ones separately', async () => {
    const { admin, repository, viewer, review } = await world('trust_admin');

    const caseId = await repository.openCase({
      category: 'safety_concern',
      summary: 'Something that cannot wait.',
      reviewId: review.id,
      actorId: viewer.id,
    });
    await repository.setCasePriority(caseId, 'critical', 'Somebody may be at risk.', viewer.id);

    expect((await admin.readAttention()).cases.critical).toBe(1);
  });
});

describe('what it does not carry', () => {
  it('holds no address, no review body and no position', async () => {
    const { admin, repository, other, review } = await world('trust_admin');

    await repository.createReport({
      reviewId: review.id,
      reporterId: other.id,
      reason: 'false_information',
      detail: 'The dates do not match.',
    });

    const serialised = JSON.stringify(await admin.readAttention());

    expect(serialised).not.toContain('@example.test');
    expect(serialised).not.toContain('boiler');
    expect(serialised).not.toContain('51.5');
    expect(serialised).not.toContain('latitude');
  });

  it('answers in counts and timestamps only', async () => {
    const { admin } = await world('trust_admin');

    const attention = await admin.readAttention();

    for (const queue of [
      attention.pendingReviews,
      attention.openReports,
      attention.openFlags,
      attention.pendingVerifications,
      attention.pendingClaims,
    ]) {
      expect(Object.keys(queue).sort()).toEqual(['count', 'oldest']);
      expect(typeof queue.count).toBe('number');
    }
  });
});

describe('the two adapters answer the same question', () => {
  it('returns every field livd_admin_attention does', async () => {
    // Parity by construction: the SQL declares the shape, and the local
    // adapter has to produce all of it. A field added to one and forgotten in
    // the other is a dashboard that means different things in development and
    // in production.
    const migration = await readFile(
      join(original.cwd, 'supabase', 'migrations', '0037_admin_attention.sql'),
      'utf8',
    );

    const declaration = migration.slice(
      migration.indexOf('returns table ('),
      migration.indexOf('language plpgsql'),
    );

    const columns = [...declaration.matchAll(/^\s{2}([a-z_]+)\s+(?:bigint|timestamptz)/gm)]
      .map((match) => match[1])
      .filter((name): name is string => Boolean(name));

    expect(columns.length).toBeGreaterThan(20);

    const { admin } = await world('trust_admin');
    const attention = await admin.readAttention();

    // Every column maps to something the local adapter fills in. The mapping
    // is written out rather than derived, so adding a column to the SQL
    // without deciding where it lives here fails this test.
    const mapped: Record<string, unknown> = {
      pending_reviews: attention.pendingReviews.count,
      oldest_pending_review: attention.pendingReviews.oldest,
      open_reports: attention.openReports.count,
      oldest_open_report: attention.openReports.oldest,
      open_flags: attention.openFlags.count,
      oldest_open_flag: attention.openFlags.oldest,
      pending_verifications: attention.pendingVerifications.count,
      oldest_pending_verification: attention.pendingVerifications.oldest,
      pending_claims: attention.pendingClaims.count,
      oldest_pending_claim: attention.pendingClaims.oldest,
      open_cases: attention.cases.open,
      unassigned_cases: attention.cases.unassigned,
      my_cases: attention.cases.mine,
      critical_cases: attention.cases.critical,
      oldest_open_case: attention.cases.oldest,
      open_authority_requests: attention.trustAndSafety?.openAuthorityRequests,
      preservation_holds: attention.trustAndSafety?.preservationHolds,
      sanctions_expiring: attention.trustAndSafety?.sanctionsExpiring,
      refusals_7d: attention.trustAndSafety?.refusalsLast7Days,
      property_count: attention.platform.properties,
      review_count: attention.platform.reviews,
      user_count: attention.platform.users,
      reviews_30d: attention.platform.reviewsLast30Days,
    };

    for (const column of columns) {
      expect(column in mapped, `${column} has no equivalent in the local adapter`).toBe(true);
      expect(mapped[column], `${column} is undefined`).not.toBeUndefined();
    }
  });
});
