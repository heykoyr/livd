import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The email delivery check.
 *
 * It sends every Livd email from a verified domain, which makes it the one
 * administrative operation whose abuse would be visible outside the building:
 * a button that mails an arbitrary address from `notifications@livd.site` is
 * a relay, and a relay on a fresh sending domain is how that domain's
 * reputation ends in its first month.
 *
 * So the properties under test are the ones that stop it being one — who may
 * run it, that the recipient cannot be chosen, that it cannot be run in a
 * loop — and the ones that stop it corrupting the real system: it claims no
 * notification dedupe key, so a test can never suppress a real send.
 *
 * `sendEmail` is replaced with a recorder for the cases that need to see what
 * was sent. With no `RESEND_API_KEY` in the test environment the real
 * transport would log and return, so nothing here can reach a network either
 * way.
 */

const original = {
  cwd: process.cwd(),
  backend: process.env.LIVD_DATA_BACKEND,
  site: process.env.NEXT_PUBLIC_SITE_URL,
  key: process.env.RESEND_API_KEY,
};
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-email-check-'));
  process.chdir(workDir);
  process.env.LIVD_DATA_BACKEND = 'local';
  process.env.LIVD_SHOW_DEMO_DATA = 'false';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://livd.site';
  delete process.env.RESEND_API_KEY;
});

afterAll(async () => {
  process.chdir(original.cwd);
  for (const [key, value] of [
    ['LIVD_DATA_BACKEND', original.backend],
    ['NEXT_PUBLIC_SITE_URL', original.site],
    ['RESEND_API_KEY', original.key],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.resetModules();
  vi.doUnmock('@/server/notify/transport');
  const { resetCache } = await import('@/server/data/local/store');
  resetCache();
  // `resetModules` also discards the rate limiter's in-memory store, so every
  // test starts with an unspent allowance.
  await rm(join(workDir, '.data'), { recursive: true, force: true });
});

interface Sent {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/** As a given account, optionally recording every send instead of making it. */
async function actingAs(
  role: 'resident' | 'owner' | 'moderator' | 'trust_admin' | 'admin',
  { record = false }: { record?: boolean } = {},
) {
  const { LocalRepository } = await import('@/server/data/local');
  const { mutate } = await import('@/server/data/local/store');
  const repository = new LocalRepository();

  const actor = await repository.upsertUser({
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
  });

  await mutate((database) => {
    const row = database.users.find((u) => u.id === actor.id);
    if (row) row.role = role;
  });

  const current = await repository.getUserById(actor.id);

  vi.doMock('@/server/auth/guards', async () => {
    const real = await vi.importActual<typeof import('@/server/auth/guards')>(
      '@/server/auth/guards',
    );
    return { ...real, requireUser: async () => current };
  });

  const sent: Sent[] = [];
  if (record) {
    vi.doMock('@/server/notify/transport', async () => {
      const real = await vi.importActual<typeof import('@/server/notify/transport')>(
        '@/server/notify/transport',
      );
      return {
        ...real,
        sendEmail: async (email: Sent) => {
          sent.push(email);
          return { ok: true as const, provider: 'resend' as const, id: `msg_${sent.length}` };
        },
      };
    });
  }

  const { sendDeliveryTest } = await import('@/server/admin/email');
  return { sendDeliveryTest, repository, actor: current!, sent };
}

describe('who may run it', () => {
  for (const role of ['resident', 'owner', 'moderator', 'trust_admin'] as const) {
    it(`refuses a ${role}, and sends nothing`, async () => {
      const { sendDeliveryTest, sent } = await actingAs(role, { record: true });

      const result = await sendDeliveryTest({ kind: 'all' });

      expect(result.ok).toBe(false);
      expect(sent).toHaveLength(0);
    });
  }

  it('records a refusal in the audit trail rather than letting it pass silently', async () => {
    const { sendDeliveryTest, repository } = await actingAs('moderator');

    await sendDeliveryTest({ kind: 'all' });

    const log = await repository.listAdminAudit();
    const entry = log.items.find((item) => item.action === 'email_delivery_tested');
    expect(entry?.outcome).toBe('denied');
  });

  it('runs for an administrator, and records that it did', async () => {
    const { sendDeliveryTest, repository } = await actingAs('admin', { record: true });

    const result = await sendDeliveryTest({ kind: 'all' });

    expect(result.ok).toBe(true);

    const log = await repository.listAdminAudit();
    const entry = log.items.find((item) => item.action === 'email_delivery_tested');
    expect(entry?.outcome).toBe('succeeded');
  });
});

describe('who it can reach', () => {
  it('sends only to the signed-in administrator', async () => {
    const { sendDeliveryTest, actor, sent } = await actingAs('admin', { record: true });

    await sendDeliveryTest({ kind: 'all' });

    expect(sent.length).toBeGreaterThan(0);
    expect(new Set(sent.map((email) => email.to))).toEqual(new Set([actor.email]));
  });

  it('ignores a recipient smuggled into the request', async () => {
    // The schema has no recipient field. This is the attack a relay would be
    // built from, sent straight at the operation the way a direct POST to the
    // Server Action would deliver it.
    const { sendDeliveryTest, actor, sent } = await actingAs('admin', { record: true });

    await sendDeliveryTest({
      kind: 'review_published',
      to: 'victim@elsewhere.test',
      recipient: 'victim@elsewhere.test',
      email: 'victim@elsewhere.test',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(actor.email);
    expect(JSON.stringify(sent)).not.toContain('victim@elsewhere.test');
  });

  it('cannot be run in a loop', async () => {
    const { sendDeliveryTest } = await actingAs('admin', { record: true });

    const outcomes = [];
    for (let run = 0; run < 4; run++) {
      outcomes.push((await sendDeliveryTest({ kind: 'review_held' })).ok);
    }

    expect(outcomes).toEqual([true, true, true, false]);
  });
});

describe('what it sends', () => {
  it('sends the whole catalogue, once each, when asked for everything', async () => {
    const { sendDeliveryTest, sent } = await actingAs('admin', { record: true });
    const { DELIVERY_TEST_KINDS } = await import('@/server/admin/email');

    const result = await sendDeliveryTest({ kind: 'all' });

    expect(result.ok && result.data.results.map((r) => r.kind)).toEqual([...DELIVERY_TEST_KINDS]);
    expect(sent).toHaveLength(12);
  });

  it('marks every message as a test, in the subject and in a header', async () => {
    const { sendDeliveryTest, sent } = await actingAs('admin', { record: true });

    await sendDeliveryTest({ kind: 'all' });

    for (const email of sent) {
      expect(email.subject.startsWith('[Test] '), email.subject).toBe(true);
      expect(email.headers?.['X-Livd-Test']).toBe('delivery-check');
    }
  });

  it('carries the same unsubscribe header a real notification carries', async () => {
    const { sendDeliveryTest, sent } = await actingAs('admin', { record: true });

    await sendDeliveryTest({ kind: 'owner_new_review' });

    expect(sent[0]?.headers?.['List-Unsubscribe']).toBe('<https://livd.site/account/notifications>');
  });

  it('puts every link on the canonical origin', async () => {
    const { sendDeliveryTest, sent } = await actingAs('admin', { record: true });

    await sendDeliveryTest({ kind: 'all' });

    const links = sent.flatMap((email) => [
      ...(email.html.match(/https?:\/\/[^\s"'<>)]+/g) ?? []),
      ...(email.text.match(/https?:\/\/[^\s"'<>)]+/g) ?? []),
    ]);

    expect(links.length).toBeGreaterThan(12);
    for (const link of links) {
      expect(link === 'https://livd.site' || link.startsWith('https://livd.site/'), link).toBe(true);
    }
  });

  it('reports nothing left the server when no provider key is configured', async () => {
    // No recorder: the real transport, with no key, logs instead of sending.
    const { sendDeliveryTest } = await actingAs('admin');
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await sendDeliveryTest({ kind: 'review_published' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.providerConfigured).toBe(false);
    expect(result.data.results[0]?.provider).toBe('console');
  });
});

describe('what it leaves behind', () => {
  it('claims no notification dedupe key, so it can never suppress a real send', async () => {
    const { sendDeliveryTest } = await actingAs('admin', { record: true });

    await sendDeliveryTest({ kind: 'all' });

    const { getDatabase } = await import('@/server/data/local/store');

    expect((await getDatabase()).notifications).toHaveLength(0);
  });

  it('writes no recipient address into the audit entry', async () => {
    const { sendDeliveryTest, repository, actor } = await actingAs('admin', { record: true });

    await sendDeliveryTest({ kind: 'all' });

    const log = await repository.listAdminAudit();
    const entry = log.items.find((item) => item.action === 'email_delivery_tested');

    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain(actor.email);
    expect(entry?.detail?.recipientDomain).toBe('example.test');
  });
});
