import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Trust & Safety cases.
 *
 * Two properties matter more than the rest.
 *
 * **Opening a case does nothing to the review.** Not hidden, not flagged, not
 * touched. It is the same reasoning that stops a report from removing anything
 * on its own: if opening a case had a visible effect, opening cases would
 * become the attack, and anybody who disliked a review would have a lever.
 *
 * **A case that moved left a timeline entry.** Against Postgres that is a
 * transaction — every `livd_*_case` function writes its event alongside the
 * change — and the local adapter appends inside the same `mutate`. A history
 * assembled by code that remembers to append is a history with gaps in it, and
 * the gaps are always around the interesting part.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-cases-'));
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

async function world(actorRole: 'resident' | 'moderator' | 'trust_admin' | 'admin') {
  const { LocalRepository } = await import('@/server/data/local');
  const { mutate } = await import('@/server/data/local/store');
  const repository = new LocalRepository();

  const actor = await repository.upsertUser({ email: `${actorRole}@example.test` });
  const reviewer = await repository.upsertUser({ email: 'reviewer@example.test' });
  const reporter = await repository.upsertUser({ email: 'reporter@example.test' });

  // Every role explicit — the local store makes the first account an admin.
  await mutate((database) => {
    const a = database.users.find((u) => u.id === actor.id);
    if (a) a.role = actorRole;
    for (const id of [reviewer.id, reporter.id]) {
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
      coordinates: null,
    },
    reviewer.id,
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
    reviewer.id,
  );

  const report = await repository.createReport({
    reviewId: review.id,
    reporterId: reporter.id,
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
  return { admin, repository, actor: current!, reviewer, reporter, property, review, report };
}

describe('opening a case', () => {
  it('refuses a resident', async () => {
    const { admin, report } = await world('resident');

    const result = await admin.openCase({
      category: 'false_information',
      summary: 'Trying it on',
      fromReportId: report.id,
    });

    expect(result.ok).toBe(false);
  });

  it('does nothing whatsoever to the review', async () => {
    // The property that keeps reporting safe applies to cases too.
    const { admin, repository, report, review, property } = await world('moderator');

    const before = await repository.getReviewById(review.id);

    await admin.openCase({
      category: 'false_information',
      summary: 'Reported as inaccurate',
      fromReportId: report.id,
    });

    const after = await repository.getReviewById(review.id);

    expect(after?.status).toBe(before?.status);
    expect(after?.status).toBe('published');
    expect(after?.verificationLevel).toBe(before?.verificationLevel);
    expect(after?.body).toBe(before?.body);

    // And it is still on the property page.
    const published = await repository.listPublicReviews(property.id);
    expect(published.total).toBe(1);
  });

  it('inherits the review, property and author from the report', async () => {
    const { admin, repository, report, review, reviewer, property } = await world('moderator');

    const opened = await admin.openCase({
      category: 'false_information',
      summary: 'Reported as inaccurate',
      fromReportId: report.id,
    });

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const detail = await repository.getCase(opened.data.caseId);

    expect(detail?.subjectReviewId).toBe(review.id);
    expect(detail?.subjectUserId).toBe(reviewer.id);
    expect(detail?.subjectPropertyId).toBe(property.id);
    expect(detail?.reference).toMatch(/^LV-\d+$/);
  });

  it('attaches the report, and does not open a second one for it', async () => {
    const { admin, repository, report } = await world('moderator');

    const first = await admin.openCase({
      category: 'false_information',
      summary: 'First',
      fromReportId: report.id,
    });
    const second = await admin.openCase({
      category: 'spam',
      summary: 'Second attempt',
      fromReportId: report.id,
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Two moderators clicking at once is a normal Tuesday, not an error.
    expect(second.data.caseId).toBe(first.data.caseId);

    const all = await repository.listCases({});
    expect(all.total).toBe(1);

    const linked = await repository.listCaseReports(first.data.caseId);
    expect(linked).toHaveLength(1);
    expect(linked[0]?.id).toBe(report.id);
  });

  it('takes the category default priority', async () => {
    const { admin, repository } = await world('moderator');

    const opened = await admin.openCase({
      category: 'threatening_content',
      summary: 'Threat in a review body',
    });

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const detail = await repository.getCase(opened.data.caseId);
    // The category's default is critical, but the *category* choosing it is
    // different from a moderator asserting it — see the next test.
    expect(detail?.priority).toBe('critical');
  });

  it('refuses a moderator opening straight into critical', async () => {
    const { admin } = await world('moderator');

    const result = await admin.openCase({
      category: 'harassment',
      summary: 'Feels urgent',
      priority: 'critical',
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/critical/i);
  });

  it('refuses a summary nobody could pick the case up from', async () => {
    const { admin } = await world('moderator');

    const result = await admin.openCase({ category: 'spam', summary: 'x' });
    expect(result.ok).toBe(false);
  });
});

describe('the timeline', () => {
  async function openOne() {
    const world_ = await world('trust_admin');
    const opened = await world_.admin.openCase({
      category: 'false_information',
      summary: 'Reported as inaccurate',
      fromReportId: world_.report.id,
    });
    if (!opened.ok) throw new Error('expected a case');
    return { ...world_, caseId: opened.data.caseId };
  }

  it('records opening, and the report being attached', async () => {
    const { repository, caseId } = await openOne();

    const events = await repository.listCaseEvents(caseId);
    expect(events.map((e) => e.kind)).toEqual(['created', 'report_linked']);
  });

  it('records every change, in order', async () => {
    const { admin, repository, caseId, actor } = await openOne();

    await admin.assignCase({ caseId, assigneeId: actor.id });
    await admin.setCasePriority({ caseId, priority: 'high', why: 'Repeat reporter' });
    await admin.addCaseNote({ caseId, body: 'Read the review. Nothing to answer.' });
    await admin.setCaseStatus({
      caseId,
      status: 'dismissed',
      outcome: 'The review stands. The reporter disagrees with it.',
    });

    const events = await repository.listCaseEvents(caseId);

    expect(events.map((e) => e.kind)).toEqual([
      'created',
      'report_linked',
      'assigned',
      'priority_changed',
      'note_added',
      'status_changed',
    ]);
  });

  it('cannot be edited or removed', async () => {
    // Postgres enforces this with a trigger on `case_events`. Here the shape of
    // the repository is the enforcement: nothing exposes a way to do it.
    const { repository } = await openOne();
    expect('deleteCaseEvent' in repository).toBe(false);
    expect('updateCaseEvent' in repository).toBe(false);
  });

  it('names who did each thing', async () => {
    const { admin, repository, caseId, actor } = await openOne();

    await admin.addCaseNote({ caseId, body: 'Looked at it.' });

    const events = await repository.listCaseEvents(caseId);
    for (const event of events) {
      expect(event.actorId).toBe(actor.id);
    }
  });
});

describe('concluding a case', () => {
  async function openOne(role: 'moderator' | 'trust_admin' = 'moderator') {
    const world_ = await world(role);
    const opened = await world_.admin.openCase({
      category: 'false_information',
      summary: 'Reported as inaccurate',
      fromReportId: world_.report.id,
    });
    if (!opened.ok) throw new Error('expected a case');
    return { ...world_, caseId: opened.data.caseId };
  }

  it('refuses to close without saying what was decided', async () => {
    const { admin, repository, caseId } = await openOne();

    for (const status of ['resolved', 'dismissed', 'closed'] as const) {
      const result = await admin.setCaseStatus({ caseId, status, outcome: null });
      expect(result.ok, `${status} closed with no outcome`).toBe(false);
    }

    const detail = await repository.getCase(caseId);
    expect(detail?.status).toBe('new');
  });

  it('records the outcome where somebody will find it', async () => {
    const { admin, repository, caseId } = await openOne();

    await admin.setCaseStatus({
      caseId,
      status: 'resolved',
      outcome: 'Review removed for fabricated content. Author restricted for 7 days.',
    });

    const detail = await repository.getCase(caseId);
    expect(detail?.status).toBe('resolved');
    expect(detail?.outcome).toContain('fabricated content');
    expect(detail?.resolvedAt).not.toBeNull();
  });

  it('drops out of the open queue once concluded', async () => {
    const { admin, repository, caseId } = await openOne();

    await admin.setCaseStatus({ caseId, status: 'dismissed', outcome: 'Nothing to answer.' });

    const open = await repository.listCases({ openOnly: true });
    expect(open.total).toBe(0);

    const everything = await repository.listCases({});
    expect(everything.total).toBe(1);
  });
});

describe('priority', () => {
  it('refuses a moderator raising a case to critical', async () => {
    // A keyword is not a threat. Critical means somebody may be about to be
    // hurt, and it is a judgement Trust & Safety makes.
    const world_ = await world('moderator');
    const opened = await world_.admin.openCase({ category: 'spam', summary: 'Promotional' });
    if (!opened.ok) throw new Error('expected a case');

    const result = await world_.admin.setCasePriority({
      caseId: opened.data.caseId,
      priority: 'critical',
      why: 'feels urgent',
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Trust and Safety authorisation/i);
  });

  it('lets a Trust & Safety admin raise one', async () => {
    const world_ = await world('trust_admin');
    const opened = await world_.admin.openCase({ category: 'harassment', summary: 'Targeted abuse' });
    if (!opened.ok) throw new Error('expected a case');

    const result = await world_.admin.setCasePriority({
      caseId: opened.data.caseId,
      priority: 'critical',
      why: 'Credible threat against a named person',
    });

    expect(result.ok).toBe(true);

    const detail = await world_.repository.getCase(opened.data.caseId);
    expect(detail?.priority).toBe('critical');
  });

  it('orders the queue by priority, worst first', async () => {
    const world_ = await world('trust_admin');

    await world_.admin.openCase({ category: 'spam', summary: 'Low one' });
    await world_.admin.openCase({ category: 'harassment', summary: 'High one' });
    await world_.admin.openCase({ category: 'fake_review', summary: 'Medium one' });

    const listed = await world_.repository.listCases({});
    expect(listed.items.map((c) => c.priority)).toEqual(['high', 'medium', 'low']);
  });
});

describe('assignment', () => {
  it('refuses handing a case to somebody who could not work it', async () => {
    const world_ = await world('moderator');
    const opened = await world_.admin.openCase({ category: 'spam', summary: 'Promotional' });
    if (!opened.ok) throw new Error('expected a case');

    const result = await world_.admin.assignCase({
      caseId: opened.data.caseId,
      assigneeId: world_.reviewer.id,
    });

    expect(result.ok).toBe(false);
  });

  it('starts a new case when it is picked up', async () => {
    const world_ = await world('moderator');
    const opened = await world_.admin.openCase({ category: 'spam', summary: 'Promotional' });
    if (!opened.ok) throw new Error('expected a case');

    await world_.admin.assignCase({ caseId: opened.data.caseId, assigneeId: world_.actor.id });

    const detail = await world_.repository.getCase(opened.data.caseId);
    expect(detail?.status).toBe('open');
    expect(detail?.assignedTo).toBe(world_.actor.id);
  });

  it('does not un-escalate a case by reassigning it', async () => {
    const world_ = await world('trust_admin');
    const opened = await world_.admin.openCase({ category: 'harassment', summary: 'Targeted abuse' });
    if (!opened.ok) throw new Error('expected a case');

    await world_.admin.setCaseStatus({ caseId: opened.data.caseId, status: 'escalated' });
    await world_.admin.assignCase({ caseId: opened.data.caseId, assigneeId: world_.actor.id });

    const detail = await world_.repository.getCase(opened.data.caseId);
    expect(detail?.status).toBe('escalated');
  });
});

describe('preservation holds', () => {
  it('refuse a moderator', async () => {
    const world_ = await world('moderator');
    const opened = await world_.admin.openCase({ category: 'spam', summary: 'Promotional' });
    if (!opened.ok) throw new Error('expected a case');

    const result = await world_.admin.setCasePreservation({
      caseId: opened.data.caseId,
      hold: true,
      reason: 'Might be needed',
    });

    expect(result.ok).toBe(false);
  });

  it('are applied by Trust & Safety, with a reason, and recorded', async () => {
    const world_ = await world('trust_admin');
    const opened = await world_.admin.openCase({ category: 'harassment', summary: 'Targeted abuse' });
    if (!opened.ok) throw new Error('expected a case');

    const result = await world_.admin.setCasePreservation({
      caseId: opened.data.caseId,
      hold: true,
      reason: 'Anticipated legal request',
    });

    expect(result.ok).toBe(true);

    const detail = await world_.repository.getCase(opened.data.caseId);
    expect(detail?.preservationHold).toBe(true);

    const events = await world_.repository.listCaseEvents(opened.data.caseId);
    expect(events.some((e) => e.kind === 'preservation_applied')).toBe(true);
  });
});

describe('notes', () => {
  it('are internal, attributed and timestamped', async () => {
    const world_ = await world('moderator');
    const opened = await world_.admin.openCase({ category: 'spam', summary: 'Promotional' });
    if (!opened.ok) throw new Error('expected a case');

    await world_.admin.addCaseNote({
      caseId: opened.data.caseId,
      body: 'Location verification exists for this property. No sign of manipulation.',
    });

    const notes = await world_.repository.listCaseNotes(opened.data.caseId);

    expect(notes).toHaveLength(1);
    expect(notes[0]?.authorId).toBe(world_.actor.id);
    expect(notes[0]?.body).toContain('No sign of manipulation');
    expect(notes[0]?.createdAt).toBeTruthy();
  });

  it('cannot be edited afterwards, including by their author', async () => {
    const world_ = await world('moderator');
    // A note that can be rewritten later is worth nothing as a record of what
    // was thought at the time. Postgres enforces this with a trigger; here it
    // is that nothing exposes a way to do it.
    expect('updateCaseNote' in world_.repository).toBe(false);
    expect('deleteCaseNote' in world_.repository).toBe(false);
  });
});
