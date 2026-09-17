import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Sanction, SanctionReason } from '@/types/domain';

/**
 * Who is told about a sanction, and what they are told.
 *
 * The Server Actions in src/server/actions/sanctions.ts are the only place a
 * standing notice is sent from. Three rules are pinned here:
 *
 *   - the notice carries the category and its public description, never the
 *     moderator's written reason
 *   - a sanction that does not change what the person can do — a restriction
 *     recorded under a ban — sends nothing
 *   - lifting writes only to the account the sanction actually belongs to, not
 *     to whichever id the form carried
 */

const notified: Array<{ to: string; dedupe: string; message: Record<string, unknown> }> = [];
let sanctions: Sanction[] = [];

const REASONS: SanctionReason[] = [
  {
    key: 'harassment',
    label: 'Harassment',
    description: 'Targeted abuse of another person.',
    suggestedAction: 'suspended',
  },
  { key: 'spam', label: 'Spam', description: 'Promotional or automated posting.', suggestedAction: 'restricted' },
];

function sanction(overrides: Partial<Sanction>): Sanction {
  return {
    id: 's-1',
    userId: 'u-1',
    action: 'suspended',
    reasonKey: 'harassment',
    reason: 'INTERNAL: matched the reporter in flat 4',
    caseId: null,
    caseReference: null,
    appliedBy: 'm-1',
    startsAt: '2026-09-17T12:00:00.000Z',
    endsAt: '2026-09-24T12:00:00.000Z',
    liftedAt: null,
    liftedBy: null,
    liftedReason: null,
    isActive: true,
    createdAt: '2026-09-17T12:00:00.000Z',
    ...overrides,
  };
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
// `after` runs its callback straight away here, so the assertion can see it.
vi.mock('next/server', () => ({ after: (callback: () => unknown) => void callback() }));
vi.mock('@/server/notify', () => ({
  notify: async (input: { to: string; dedupe: string; message: Record<string, unknown> }) => {
    notified.push(input);
  },
}));
vi.mock('@/server/admin', () => ({
  applySanction: async () => ({ ok: true, data: { sanctionId: 's-1' } }),
  liftSanction: async () => ({ ok: true, data: null }),
  listSanctions: async ({ userId }: { userId: string }) =>
    sanctions.filter((entry) => entry.userId === userId),
  sanctionReasons: async () => REASONS,
}));

const { applySanction, liftSanction } = await import('@/server/actions/sanctions');
const idle = { error: null, message: null };

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  notified.length = 0;
  sanctions = [];
});

describe('applying a sanction', () => {
  it('tells the account, with the category and never the written reason', async () => {
    sanctions = [sanction({})];

    const result = await applySanction(
      idle,
      form({ userId: 'u-1', action: 'suspended', reasonKey: 'harassment', reason: 'x'.repeat(10) }),
    );

    expect(result.error).toBeNull();
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({
      to: 'u-1',
      dedupe: 'account_sanctioned:s-1',
      message: {
        kind: 'account_sanctioned',
        action: 'suspended',
        reasonLabel: 'Harassment',
        reasonDescription: 'Targeted abuse of another person.',
        endsAt: '2026-09-24T12:00:00.000Z',
      },
    });
    expect(JSON.stringify(notified[0])).not.toContain('INTERNAL');
  });

  it('sends nothing when a heavier sanction is already running', async () => {
    sanctions = [
      sanction({ id: 's-1', action: 'restricted', reasonKey: 'spam' }),
      sanction({ id: 's-0', action: 'banned', reasonKey: 'harassment', endsAt: null }),
    ];

    await applySanction(
      idle,
      form({ userId: 'u-1', action: 'restricted', reasonKey: 'spam', reason: 'x'.repeat(10) }),
    );

    expect(notified).toHaveLength(0);
  });
});

describe('lifting a sanction', () => {
  it('tells the account it belongs to, and whether it is back in good standing', async () => {
    sanctions = [sanction({ isActive: false, liftedAt: '2026-09-18T12:00:00.000Z' })];

    await liftSanction(idle, form({ sanctionId: 's-1', userId: 'u-1', reason: 'Upheld on appeal' }));

    expect(notified).toEqual([
      {
        to: 'u-1',
        dedupe: 'account_sanction_lifted:s-1',
        message: { kind: 'account_sanction_lifted', action: 'suspended', stillRestricted: false },
      },
    ]);
  });

  it('says so when another sanction is still running', async () => {
    sanctions = [
      sanction({ isActive: false, liftedAt: '2026-09-18T12:00:00.000Z' }),
      sanction({ id: 's-2', action: 'restricted', reasonKey: 'spam' }),
    ];

    await liftSanction(idle, form({ sanctionId: 's-1', userId: 'u-1', reason: 'Upheld on appeal' }));

    expect(notified[0]?.message).toMatchObject({ stillRestricted: true });
  });

  it('writes to nobody when the form names an account the sanction does not belong to', async () => {
    sanctions = [sanction({ userId: 'u-1' })];

    await liftSanction(
      idle,
      form({ sanctionId: 's-1', userId: 'somebody-else', reason: 'Upheld on appeal' }),
    );

    expect(notified).toHaveLength(0);
  });
});
