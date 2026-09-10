import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Authority requests and disclosure records.
 *
 * The most important test in this file is the one that asserts an absence:
 * **nothing in this system gathers or transmits a user's information.** There
 * is no repository method, no admin-layer function and no database function
 * that takes an authority request and produces an account's data.
 *
 * That absence is deliberate and worth a test, because it is exactly the kind
 * of thing somebody adds later in good faith — "wouldn't it be easier if the
 * approve button just exported the fields?" — and a button that assembles and
 * sends an account's data on request is a button that will eventually be
 * pressed for a request nobody read properly.
 *
 * The rest pins the process: Trust & Safety only, a written decision before a
 * conclusion, no disclosure against an unapproved request, and every field
 * named one at a time.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-authority-'));
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
  const subject = await repository.upsertUser({ email: 'the.reviewer@example.test' });

  await mutate((database) => {
    const a = database.users.find((u) => u.id === actor.id);
    if (a) a.role = actorRole;
    const s = database.users.find((u) => u.id === subject.id);
    if (s) s.role = 'resident';
  });

  const current = await repository.getUserById(actor.id);
  vi.doMock('@/server/auth/guards', async () => {
    const real = await vi.importActual<typeof import('@/server/auth/guards')>(
      '@/server/auth/guards',
    );
    return { ...real, requireUser: async () => current };
  });

  const admin = await import('@/server/admin');
  return { admin, repository, actor: current!, subject };
}

const REQUEST = {
  requestingAuthority: 'Metropolitan Police',
  jurisdiction: 'England and Wales',
  requestType: 'account_information' as const,
  requestedInformation: 'Subscriber information for the account behind review X',
  externalReference: 'MPS/2026/00412',
  legalBasis: 'Data Protection Act 2018, Schedule 2 Part 1',
  documentationReceived: true,
};

describe('nothing here discloses anything', () => {
  it('exposes no method that gathers account data for a request', async () => {
    // The test that would fail the day somebody adds a convenience export. Every
    // name here is one that would plausibly be given to such a thing.
    const { repository } = await world('trust_admin');

    for (const forbidden of [
      'exportUserData',
      'gatherUserData',
      'fulfilAuthorityRequest',
      'fulfillAuthorityRequest',
      'sendDisclosure',
      'transmitDisclosure',
      'exportAccount',
      'collectSubjectData',
    ]) {
      expect(forbidden in repository, `${forbidden} exists on the repository`).toBe(false);
    }
  });

  it('exposes no such operation on the administrative layer either', async () => {
    const { admin } = await world('trust_admin');

    const names = Object.keys(admin);
    for (const name of names) {
      expect(name).not.toMatch(/export|transmit|send.*data|gather/i);
    }
  });

  it('returns only an id when a request is recorded, never account data', async () => {
    const { admin, subject } = await world('trust_admin');

    const result = await admin.openAuthorityRequest({ ...REQUEST, subjectUserId: subject.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.data)).toEqual(['requestId']);
    expect(JSON.stringify(result)).not.toContain('the.reviewer@example.test');
  });
});

describe('who may handle a request', () => {
  it('refuses a moderator recording one', async () => {
    const { admin } = await world('moderator');

    const result = await admin.openAuthorityRequest(REQUEST);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/not authorised|Trust and Safety/i);
  });

  it('refuses a moderator reading them', async () => {
    const { admin } = await world('moderator');
    // The database refuses; the layer turns that into an empty list rather than
    // a stack trace.
    expect(await admin.listAuthorityRequests()).toEqual([]);
  });

  it('lets a Trust & Safety admin record one', async () => {
    const { admin, repository, subject } = await world('trust_admin');

    const result = await admin.openAuthorityRequest({ ...REQUEST, subjectUserId: subject.id });
    expect(result.ok).toBe(true);

    const [request] = await repository.listAuthorityRequests();
    expect(request?.requestingAuthority).toBe('Metropolitan Police');
    expect(request?.status).toBe('received');
    expect(request?.reference).toMatch(/^AR-\d+$/);
    expect(request?.documentationReceived).toBe(true);
  });
});

describe('the process', () => {
  async function recorded() {
    const w = await world('trust_admin');
    const opened = await w.admin.openAuthorityRequest({
      ...REQUEST,
      subjectUserId: w.subject.id,
    });
    if (!opened.ok) throw new Error('expected a request');
    return { ...w, requestId: opened.data.requestId };
  }

  it('refuses a disclosure against a request that has not been approved', async () => {
    const { admin, requestId } = await recorded();

    const result = await admin.recordDisclosure({
      requestId,
      disclosedFields: ['email'],
      disclosedTo: 'DC Smith',
      method: 'secure_email',
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/not been approved/i);
  });

  it('refuses to conclude without a written decision', async () => {
    const { admin, requestId } = await recorded();

    for (const status of ['approved', 'declined', 'closed'] as const) {
      const result = await admin.decideAuthorityRequest({ requestId, status, decision: null });
      expect(result.ok, `${status} concluded with no decision`).toBe(false);
    }
  });

  it('records the decision where somebody will find it', async () => {
    const { admin, repository, requestId } = await recorded();

    await admin.decideAuthorityRequest({
      requestId,
      status: 'partially_approved',
      decision: 'Registration date only. The request for review content had no basis.',
    });

    const [request] = await repository.listAuthorityRequests();
    expect(request?.status).toBe('partially_approved');
    expect(request?.decision).toContain('Registration date only');
    expect(request?.decidedBy).not.toBeNull();
  });

  it('refuses a disclosure that names nothing', async () => {
    const { admin, requestId } = await recorded();

    await admin.decideAuthorityRequest({
      requestId,
      status: 'approved',
      decision: 'Registration date only.',
    });

    const result = await admin.recordDisclosure({
      requestId,
      disclosedFields: [],
      disclosedTo: 'DC Smith',
      method: 'secure_email',
    });

    expect(result.ok).toBe(false);
  });

  it('records exactly what left, field by field', async () => {
    const { admin, repository, requestId, subject } = await recorded();

    await admin.decideAuthorityRequest({
      requestId,
      status: 'partially_approved',
      decision: 'Registration date only.',
    });

    await admin.recordDisclosure({
      requestId,
      disclosedFields: ['account_created_at'],
      disclosedTo: 'DC Smith, MPS',
      method: 'secure_email',
      notes: 'Registration date only, as decided.',
    });

    const [disclosure] = await repository.listDisclosures(requestId);

    expect(disclosure?.disclosedFields).toEqual(['account_created_at']);
    expect(disclosure?.disclosedTo).toBe('DC Smith, MPS');
    expect(disclosure?.subjectUserId).toBe(subject.id);

    // The request moves to fulfilled once something has actually left.
    const [request] = await repository.listAuthorityRequests();
    expect(request?.status).toBe('fulfilled');
    expect(request?.disclosureCount).toBe(1);
  });

  it('audits the whole flow without ever holding a disclosed value', async () => {
    const { admin, repository, requestId } = await recorded();

    await admin.decideAuthorityRequest({
      requestId,
      status: 'approved',
      decision: 'Registration date only.',
    });
    await admin.recordDisclosure({
      requestId,
      disclosedFields: ['account_created_at'],
      disclosedTo: 'DC Smith, MPS',
      method: 'secure_email',
    });

    const log = await repository.listAdminAudit();
    const actions = log.items.map((row) => row.action);

    expect(actions).toContain('authority_request_created');
    expect(actions).toContain('authority_request_updated');
    expect(actions).toContain('disclosure_recorded');

    // Field names, never their values. An audit log holding the disclosed data
    // would be a second copy of the disclosure, with a longer retention.
    expect(JSON.stringify(log)).not.toContain('the.reviewer@example.test');
  });

  it('keeps the decision and the disclosure as separate records', async () => {
    // "Approved but never sent" is a real and common outcome. A single row
    // could not express it.
    const { admin, repository, requestId } = await recorded();

    await admin.decideAuthorityRequest({
      requestId,
      status: 'approved',
      decision: 'Approved in full.',
    });

    const [request] = await repository.listAuthorityRequests();
    expect(request?.status).toBe('approved');
    expect(request?.disclosureCount).toBe(0);
    expect(await repository.listDisclosures(requestId)).toEqual([]);
  });

  it('offers no way to delete a disclosure record', async () => {
    const { repository } = await world('trust_admin');
    expect('deleteDisclosure' in repository).toBe(false);
    expect('updateDisclosure' in repository).toBe(false);
  });
});
