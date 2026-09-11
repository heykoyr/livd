import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationPreferences, NotificationRecipient } from '@/server/data/repository';

/**
 * The four guarantees the dispatcher makes.
 *
 * Every one of them is a thing that goes wrong in production and nowhere
 * else, so they are asserted against a fake repository and a fake transport
 * rather than left to be discovered by somebody receiving the same email five
 * times.
 *
 *   sends once            a retried action, two concurrent callers and five
 *                         writes of one status produce one email
 *   respects the switch   a category somebody turned off is recorded as
 *                         skipped, not sent
 *   never breaks the act  a transport that throws does not propagate
 *   logs no identities    the address never reaches a log line
 */

const ALL_ON: NotificationPreferences = {
  reviewUpdates: true,
  propertyResponses: true,
  trustSafety: true,
};

interface Claimed {
  dedupeKey: string;
  kind: string;
  recipientId: string | null;
}

/** A repository with exactly the six methods the dispatcher touches. */
function fakeRepository(options: {
  recipient?: NotificationRecipient | null;
  staff?: NotificationRecipient[];
  claimThrows?: boolean;
}) {
  const claims: Claimed[] = [];
  const settled: Array<{ dedupeKey: string; status: string; detail: string | null }> = [];
  const keys = new Set<string>();

  return {
    claims,
    settled,
    repository: {
      async claimNotification(input: Claimed & { payload: unknown }) {
        if (options.claimThrows) throw new Error('database unreachable');
        if (keys.has(input.dedupeKey)) return false;
        keys.add(input.dedupeKey);
        claims.push({
          dedupeKey: input.dedupeKey,
          kind: input.kind,
          recipientId: input.recipientId,
        });
        return true;
      },
      async settleNotification(dedupeKey: string, status: string, detail: string | null) {
        settled.push({ dedupeKey, status, detail });
      },
      async notificationRecipient() {
        return options.recipient ?? null;
      },
      async notificationStaff() {
        return options.staff ?? [];
      },
    },
  };
}

const sent: Array<{ to: string; subject: string }> = [];
let transportFails = false;
let transportThrows = false;

vi.mock('@/server/notify/transport', () => ({
  hasMailProvider: () => true,
  recipientDomain: (address: string) => address.split('@')[1] ?? 'unknown',
  sendEmail: async (email: { to: string; subject: string }) => {
    if (transportThrows) throw new Error('socket hang up');
    if (transportFails) return { ok: false as const, provider: 'resend' as const, error: 'HTTP 422' };
    sent.push({ to: email.to, subject: email.subject });
    return { ok: true as const, provider: 'resend' as const, id: 'msg_1' };
  },
}));

const getRepository = vi.hoisted(() => vi.fn());
vi.mock('@/server/data', () => ({ getRepository }));

const { notify, notifyStaff } = await import('@/server/notify');

const REVIEWER: NotificationRecipient = {
  userId: 'u1',
  email: 'someone@example.com',
  locale: 'en',
  preferences: ALL_ON,
};

const MESSAGE = {
  kind: 'review_published' as const,
  propertyName: 'The Franklin',
  propertySlug: 'the-franklin-brooklyn',
};

beforeEach(() => {
  sent.length = 0;
  transportFails = false;
  transportThrows = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sending once', () => {
  it('sends the first time and not the second', async () => {
    const fake = fakeRepository({ recipient: REVIEWER });
    getRepository.mockResolvedValue(fake.repository);

    await notify({ to: 'u1', dedupe: 'review_published:r1', message: MESSAGE });
    await notify({ to: 'u1', dedupe: 'review_published:r1', message: MESSAGE });
    await notify({ to: 'u1', dedupe: 'review_published:r1', message: MESSAGE });

    expect(sent).toHaveLength(1);
    expect(fake.claims).toHaveLength(1);
  });

  it('survives the same event arriving from two callers at once', async () => {
    const fake = fakeRepository({ recipient: REVIEWER });
    getRepository.mockResolvedValue(fake.repository);

    await Promise.all([
      notify({ to: 'u1', dedupe: 'review_published:r2', message: MESSAGE }),
      notify({ to: 'u1', dedupe: 'review_published:r2', message: MESSAGE }),
    ]);

    expect(sent).toHaveLength(1);
  });

  it('treats a different event as a different email', async () => {
    const fake = fakeRepository({ recipient: REVIEWER });
    getRepository.mockResolvedValue(fake.repository);

    await notify({ to: 'u1', dedupe: 'review_published:r1', message: MESSAGE });
    await notify({ to: 'u1', dedupe: 'review_published:r2', message: MESSAGE });

    expect(sent).toHaveLength(2);
  });

  it('claims per recipient on a staff fan-out, so one bounce is not everybody', async () => {
    const staff: NotificationRecipient[] = [
      { userId: 'm1', email: 'a@livd.test', locale: 'en', preferences: ALL_ON },
      { userId: 'm2', email: 'b@livd.test', locale: 'en', preferences: ALL_ON },
    ];
    const fake = fakeRepository({ staff });
    getRepository.mockResolvedValue(fake.repository);

    await notifyStaff({
      minRole: 'moderator',
      dedupe: 'report_opened:x',
      message: { kind: 'staff_report_opened', propertyName: 'The Franklin', reason: 'spam' },
    });
    await notifyStaff({
      minRole: 'moderator',
      dedupe: 'report_opened:x',
      message: { kind: 'staff_report_opened', propertyName: 'The Franklin', reason: 'spam' },
    });

    expect(sent).toHaveLength(2);
    expect(fake.claims.map((claim) => claim.dedupeKey).sort()).toEqual([
      'report_opened:x:m1',
      'report_opened:x:m2',
    ]);
  });
});

describe('respecting the switch', () => {
  it('does not send a category the recipient turned off', async () => {
    const fake = fakeRepository({
      recipient: { ...REVIEWER, preferences: { ...ALL_ON, reviewUpdates: false } },
    });
    getRepository.mockResolvedValue(fake.repository);

    await notify({ to: 'u1', dedupe: 'review_published:r1', message: MESSAGE });

    expect(sent).toHaveLength(0);
    // Recorded, so "why did I not get that" has an answer.
    expect(fake.settled[0]).toMatchObject({ status: 'skipped' });
  });

  it('still sends a different category', async () => {
    const fake = fakeRepository({
      recipient: { ...REVIEWER, preferences: { ...ALL_ON, reviewUpdates: false } },
    });
    getRepository.mockResolvedValue(fake.repository);

    await notify({
      to: 'u1',
      dedupe: 'owner_responded:r1',
      message: {
        kind: 'owner_responded',
        propertyName: 'The Franklin',
        propertySlug: 'the-franklin-brooklyn',
      },
    });

    expect(sent).toHaveLength(1);
  });

  it('ignores preferences for operational mail to staff', async () => {
    const fake = fakeRepository({
      staff: [
        {
          userId: 'm1',
          email: 'a@livd.test',
          locale: 'en',
          preferences: { reviewUpdates: false, propertyResponses: false, trustSafety: false },
        },
      ],
    });
    getRepository.mockResolvedValue(fake.repository);

    await notifyStaff({
      minRole: 'moderator',
      dedupe: 'report_opened:y',
      message: { kind: 'staff_report_opened', propertyName: 'The Franklin', reason: 'spam' },
    });

    expect(sent).toHaveLength(1);
  });

  it('writes to nobody when the account is gone or banned', async () => {
    const fake = fakeRepository({ recipient: null });
    getRepository.mockResolvedValue(fake.repository);

    await notify({ to: 'gone', dedupe: 'review_published:r9', message: MESSAGE });

    expect(sent).toHaveLength(0);
    expect(fake.settled[0]).toMatchObject({ status: 'skipped' });
  });
});

describe('never breaking the action it reports on', () => {
  it('swallows a transport failure and records it', async () => {
    transportFails = true;
    const fake = fakeRepository({ recipient: REVIEWER });
    getRepository.mockResolvedValue(fake.repository);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      notify({ to: 'u1', dedupe: 'review_published:r1', message: MESSAGE }),
    ).resolves.toBeUndefined();

    expect(fake.settled[0]).toMatchObject({ status: 'failed' });

    // The domain, never the address. A product whose promise is anonymity
    // cannot keep a log of who was told what.
    const logged = errors.mock.calls.flat().join(' ');
    expect(logged).not.toContain('someone@example.com');
    expect(logged).toContain('example.com');
  });

  it('swallows a transport that throws', async () => {
    transportThrows = true;
    const fake = fakeRepository({ recipient: REVIEWER });
    getRepository.mockResolvedValue(fake.repository);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      notify({ to: 'u1', dedupe: 'review_published:r1', message: MESSAGE }),
    ).resolves.toBeUndefined();
  });

  it('swallows a database that will not take the claim, and sends nothing', async () => {
    // Failing closed here is deliberate. A claim that cannot be recorded and
    // is sent anyway would re-send on every retry for ever.
    const fake = fakeRepository({ recipient: REVIEWER, claimThrows: true });
    getRepository.mockResolvedValue(fake.repository);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      notify({ to: 'u1', dedupe: 'review_published:r1', message: MESSAGE }),
    ).resolves.toBeUndefined();

    expect(sent).toHaveLength(0);
  });
});
