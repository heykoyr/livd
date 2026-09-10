import { readdir, readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Signals.
 *
 * One property is pinned here above all others: **a signal never acts**.
 *
 * Nothing in the detection layer changes a review's status, its verification
 * level, a property's score or an account's standing. The strongest thing a
 * signal can do is cause a person to be asked, and that is not a limitation
 * waiting to be lifted — a detector that could act would eventually act on a
 * property that had simply become popular, or on a resident who moved twice in
 * a year, and there is no threshold clever enough to be trusted with that.
 *
 * The rest of the file is about the other half of Phase 12: that a signal can
 * become an investigation. Until then a flag ended at reviewed or dismissed,
 * which is a verdict on the *signal* and leaves no way to say the thing an
 * unexplained pattern most often warrants.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-signals-'));
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

async function world(actorRole: 'resident' | 'moderator' | 'trust_admin' = 'moderator') {
  const { LocalRepository } = await import('@/server/data/local');
  const { mutate } = await import('@/server/data/local/store');
  const repository = new LocalRepository();

  const actor = await repository.upsertUser({ email: 'the.moderator@example.test' });
  const subject = await repository.upsertUser({ email: 'the.subject@example.test' });

  await mutate((database) => {
    const a = database.users.find((u) => u.id === actor.id);
    if (a) a.role = actorRole;
    const s = database.users.find((u) => u.id === subject.id);
    if (s) s.role = 'resident';
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
      body: 'The boiler was broken for the whole of one winter and nobody replied.',
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

  /** An account signal, written straight into the store as the detector would. */
  const raiseSignal = async (kind: 'author_spread' | 'serial_reporter') => {
    const id = `signal-${kind}`;
    await mutate((database) => {
      database.accountSignals.push({
        id,
        userId: subject.id,
        kind,
        severity: 2,
        windowStart: new Date(Date.now() - 48 * 3_600_000).toISOString(),
        windowEnd: new Date().toISOString(),
        observed:
          kind === 'author_spread'
            ? { properties_reviewed: 6, reviews_written: 6, window_hours: 48 }
            : { reports_filed: 9, reports_dismissed: 7, window_hours: 48 },
        detail:
          kind === 'author_spread'
            ? '6 reviews across 6 different properties in 48 hours.'
            : '9 reports in 48 hours, 7 of them dismissed, across 1 property.',
        status: 'open',
        reviewedBy: null,
        reviewedAt: null,
        caseId: null,
        createdAt: new Date().toISOString(),
      });
    });
    return id;
  };

  const current = await repository.getUserById(actor.id);
  vi.doMock('@/server/auth/guards', async () => {
    const real = await vi.importActual<typeof import('@/server/auth/guards')>(
      '@/server/auth/guards',
    );
    return { ...real, requireUser: async () => current };
  });

  const admin = await import('@/server/admin');
  return { admin, repository, actor: current!, subject, property, review, raiseSignal };
}

describe('a signal never acts', () => {
  it('changes nothing about a review when it is decided', async () => {
    const { admin, repository, review, raiseSignal } = await world();
    const signalId = await raiseSignal('author_spread');

    const before = await repository.getReviewById(review.id);

    const result = await admin.decideAccountSignal({ signalId, status: 'dismissed' });
    expect(result.ok).toBe(true);

    const after = await repository.getReviewById(review.id);
    expect(after?.status).toBe(before?.status);
    expect(after?.verificationLevel).toBe(before?.verificationLevel);
  });

  it('changes nothing about the account when it is decided', async () => {
    const { admin, repository, subject, raiseSignal } = await world();
    const signalId = await raiseSignal('serial_reporter');

    await admin.decideAccountSignal({ signalId, status: 'reviewed' });

    const after = await repository.getUserById(subject.id);
    expect(after?.status).toBe('active');
    expect(after?.role).toBe('resident');
  });

  it('changes nothing about a review when a case is opened from it', async () => {
    const { admin, repository, review, raiseSignal } = await world();
    const signalId = await raiseSignal('author_spread');

    const result = await admin.investigateSignal({
      signalKind: 'account',
      signalId,
      why: 'Six buildings in an afternoon does not read like somebody who lived in them.',
    });
    expect(result.ok).toBe(true);

    const after = await repository.getReviewById(review.id);
    expect(after?.status).toBe('published');
    expect(after?.verificationLevel).toBe('unverified');
  });

  it('exposes no operation that acts on a signal automatically', async () => {
    const { admin, repository } = await world();

    for (const forbidden of [
      'applySignal',
      'enforceSignal',
      'autoRemoveFlagged',
      'suspendFromSignal',
      'quarantineReviews',
    ]) {
      expect(forbidden in repository, `${forbidden} exists on the repository`).toBe(false);
    }

    for (const name of Object.keys(admin)) {
      expect(name).not.toMatch(/auto.*(remove|suspend|hide)|enforce/i);
    }
  });

  it('has no detector that writes to reviews or profiles', async () => {
    // Read the migrations rather than trusting the description. A detection
    // function that gained an UPDATE on `reviews` would be the single most
    // damaging change anybody could make to this product, and it would look
    // entirely reasonable in a diff.
    const directory = join(original.cwd, 'supabase', 'migrations');
    const files = (await readdir(directory)).filter((name) => name.endsWith('.sql'));

    // Counted, because a scan that matched nothing would pass in silence — and
    // this project has already shipped one detector whose regex could not have
    // matched anything at all.
    let examined = 0;

    for (const file of files) {
      const sql = await readFile(join(directory, file), 'utf8');

      for (const block of sql.split(/create or replace function /i).slice(1)) {
        const name = block.slice(0, block.indexOf('(')).trim();
        if (!/^livd_(detect|raise)_/.test(name)) continue;

        examined += 1;
        const body = block.slice(0, block.indexOf('$fn$;') + 5 || undefined);

        expect(body, `${name} writes to reviews`).not.toMatch(/update\s+reviews\b/i);
        expect(body, `${name} writes to profiles`).not.toMatch(/update\s+profiles\b/i);
        expect(body, `${name} deletes something`).not.toMatch(/\bdelete\s+from\b/i);
      }
    }

    expect(examined, 'the scan found no detector functions at all').toBeGreaterThanOrEqual(4);
  });
});

describe('from a signal to an investigation', () => {
  it('opens a case carrying the arithmetic', async () => {
    const { admin, repository, raiseSignal } = await world();
    const signalId = await raiseSignal('serial_reporter');

    const result = await admin.investigateSignal({
      signalKind: 'account',
      signalId,
      why: 'Nine reports in two days, seven of them wrong.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const events = await repository.listCaseEvents(result.data.caseId);
    const linked = events.find((event) => event.kind === 'signal_linked');

    expect(linked).toBeDefined();
    // The numbers travel, so somebody reading the case in three weeks sees
    // what was observed rather than a paraphrase of it.
    expect(linked?.detail.reports_filed).toBe(9);
    expect(linked?.detail.reports_dismissed).toBe(7);
  });

  it('points the case at the account the signal is about', async () => {
    const { admin, repository, subject, raiseSignal } = await world();
    const signalId = await raiseSignal('author_spread');

    const result = await admin.investigateSignal({
      signalKind: 'account',
      signalId,
      why: 'Worth reading these six together.',
    });
    if (!result.ok) throw new Error(result.error);

    const opened = await repository.getCase(result.data.caseId);
    expect(opened?.subjectUserId).toBe(subject.id);
  });

  it('marks the signal as acted on and remembers where it went', async () => {
    const { admin, repository, raiseSignal } = await world();
    const signalId = await raiseSignal('author_spread');

    const result = await admin.investigateSignal({
      signalKind: 'account',
      signalId,
      why: 'Worth reading these six together.',
    });
    if (!result.ok) throw new Error(result.error);

    expect(await repository.listAccountSignals('open')).toEqual([]);

    const [signal] = await repository.listAccountSignals('reviewed');
    expect(signal?.caseId).toBe(result.data.caseId);
    expect(signal?.caseReference).toMatch(/^LV-\d+$/);
  });

  it('hands back the same case rather than opening a second', async () => {
    const { admin, raiseSignal } = await world();
    const signalId = await raiseSignal('serial_reporter');

    const first = await admin.investigateSignal({
      signalKind: 'account',
      signalId,
      why: 'Reports arriving faster than anybody could be reading.',
    });
    const second = await admin.investigateSignal({
      signalKind: 'account',
      signalId,
      why: 'Again.',
    });

    if (!first.ok || !second.ok) throw new Error('expected both to succeed');
    expect(second.data.caseId).toBe(first.data.caseId);
  });

  it('refuses to open one without saying what to look into', async () => {
    const { admin, raiseSignal } = await world();
    const signalId = await raiseSignal('author_spread');

    const result = await admin.investigateSignal({ signalKind: 'account', signalId, why: '  ' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/what you want looked into/i);
  });
});

describe('who may act on a signal', () => {
  it('refuses a resident', async () => {
    const { admin, raiseSignal } = await world('resident');
    const signalId = await raiseSignal('author_spread');

    const decided = await admin.decideAccountSignal({ signalId, status: 'dismissed' });
    expect(decided.ok).toBe(false);

    const investigated = await admin.investigateSignal({
      signalKind: 'account',
      signalId,
      why: 'Trying it on.',
    });
    expect(investigated.ok).toBe(false);
  });

  it('never carries the subject of a signal any closer to their identity', async () => {
    const { admin, raiseSignal } = await world();
    await raiseSignal('serial_reporter');

    const signals = await admin.listAccountSignals('open');

    // An account id and arithmetic. Establishing that one account did all of
    // this does not require knowing who they are, and finding that out is a
    // separate decision with a reason and a record.
    expect(JSON.stringify(signals)).not.toContain('@example.test');
    expect(Object.keys(signals[0] ?? {})).not.toContain('email');
  });
});
