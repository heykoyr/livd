import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { REASON_REQUIRED, type AdminAuditAction } from '@/server/admin/audit';

/**
 * The privileged administrative layer.
 *
 * What is being tested here is the *pipeline*, not the operations that run
 * inside it: that an unauthorised attempt is refused and recorded, that a
 * sensitive action without a written reason never reaches its operation, that
 * a refusal is audited as a denial rather than passing silently, and that a
 * failure inside an operation does not leak its message to the caller.
 *
 * The point of a layer like this is that a new operation inherits all of that
 * by being written as a spec rather than as a function that remembers to check
 * things. So the tests exercise the wrapper directly with throwaway specs, and
 * the real operations are covered by their own files.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-admin-layer-'));
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

/**
 * Runs the layer as a given account.
 *
 * `requireUser` is what the layer calls to establish who is acting, and it
 * reads a session. There is no session in a test, so it is mocked — and only
 * it. Everything downstream, including the repository and the audit write, is
 * the real thing.
 */
async function actingAs(role: 'resident' | 'moderator' | 'trust_admin' | 'admin') {
  const { LocalRepository } = await import('@/server/data/local');
  const { mutate } = await import('@/server/data/local/store');
  const repository = new LocalRepository();

  const actor = await repository.upsertUser({ email: `${role}-${Date.now()}@example.test` });

  // Set explicitly even for `resident`: the local adapter makes the first
  // account in a fresh store an administrator, so relying on the default would
  // quietly give this fixture the opposite of the role it asked for.
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

  const { runAdminAction } = await import('@/server/admin/run');
  return { runAdminAction, repository, actor: current! };
}

const passthrough = {
  subject: () => ({ type: 'user' as const, id: null }),
};

describe('authorise', () => {
  it('refuses an actor below the required tier', async () => {
    const { runAdminAction } = await actingAs('moderator');
    const { z } = await import('zod');

    const ran = vi.fn(async () => 'should not happen');

    const result = await runAdminAction(
      {
        action: 'identity_revealed',
        requires: 'trust_admin',
        schema: z.object({ reason: z.string() }),
        reason: (input) => input.reason,
        ...passthrough,
        run: ran,
      },
      { reason: 'a safety investigation' },
    );

    expect(result.ok).toBe(false);
    expect(ran).not.toHaveBeenCalled();
  });

  it('records the refusal rather than letting it pass silently', async () => {
    const { runAdminAction, repository } = await actingAs('moderator');
    const { z } = await import('zod');

    await runAdminAction(
      {
        action: 'identity_revealed',
        requires: 'trust_admin',
        schema: z.object({ reason: z.string() }),
        reason: (input) => input.reason,
        subject: () => ({ type: 'user', id: null }),
        run: async () => null,
      },
      { reason: 'a safety investigation' },
    );

    const log = await repository.listAdminAudit();
    expect(log.items).toHaveLength(1);
    expect(log.items[0]?.action).toBe('identity_revealed');
    expect(log.items[0]?.outcome).toBe('denied');
  });

  it('admits an actor above the required tier', async () => {
    const { runAdminAction } = await actingAs('admin');
    const { z } = await import('zod');

    const result = await runAdminAction(
      {
        action: 'user_directory_searched',
        requires: 'moderator',
        schema: z.object({}),
        ...passthrough,
        run: async () => 'ran',
      },
      {},
    );

    expect(result).toEqual({ ok: true, data: 'ran' });
  });
});

describe('a written reason', () => {
  it('is demanded for every action on the sensitive list', async () => {
    const { runAdminAction } = await actingAs('admin');
    const { z } = await import('zod');

    for (const action of REASON_REQUIRED) {
      const ran = vi.fn(async () => null);

      const result = await runAdminAction(
        {
          action,
          requires: 'moderator',
          schema: z.object({}),
          ...passthrough,
          run: ran,
        },
        {},
      );

      expect(result.ok, `${action} ran without a reason`).toBe(false);
      expect(ran, `${action} reached its operation`).not.toHaveBeenCalled();
    }
  });

  it('treats whitespace as no reason at all', async () => {
    const { runAdminAction } = await actingAs('admin');
    const { z } = await import('zod');

    const result = await runAdminAction(
      {
        action: 'identity_revealed',
        requires: 'moderator',
        schema: z.object({ reason: z.string() }),
        reason: (input) => input.reason,
        ...passthrough,
        run: async () => null,
      },
      { reason: '   ' },
    );

    expect(result.ok).toBe(false);
  });

  it('is not demanded for an action that is not sensitive', async () => {
    const { runAdminAction } = await actingAs('moderator');
    const { z } = await import('zod');

    const result = await runAdminAction(
      {
        action: 'user_directory_searched',
        requires: 'moderator',
        schema: z.object({}),
        ...passthrough,
        run: async () => 'listed',
      },
      {},
    );

    expect(result.ok).toBe(true);
  });

  it('covers identity reveal, sanctions and evidence access', async () => {
    // A list that quietly loses an entry is worse than no list, because the
    // enforcement is invisible either way.
    const mustBeListed: AdminAuditAction[] = [
      'identity_revealed',
      'user_sanctioned',
      'user_status_changed',
      'evidence_accessed',
      'verification_evidence_accessed',
      'disclosure_recorded',
      'review_status_changed',
    ];

    for (const action of mustBeListed) {
      expect(REASON_REQUIRED.has(action), `${action} is not on the reason-required list`).toBe(true);
    }
  });
});

describe('audit', () => {
  it('records a successful action with its reason and subject', async () => {
    const { runAdminAction, repository, actor } = await actingAs('trust_admin');
    const { z } = await import('zod');

    await runAdminAction(
      {
        action: 'identity_revealed',
        requires: 'trust_admin',
        schema: z.object({ userId: z.string(), reason: z.string() }),
        subject: (input) => ({ type: 'user', id: input.userId }),
        reason: (input) => input.reason,
        detail: () => ({ fields: 'email' }),
        run: async () => null,
      },
      { userId: actor.id, reason: 'Safety investigation, case LV-1048' },
    );

    const log = await repository.listAdminAudit();
    const entry = log.items[0];

    expect(entry?.action).toBe('identity_revealed');
    expect(entry?.outcome).toBe('succeeded');
    expect(entry?.actorId).toBe(actor.id);
    expect(entry?.actorRole).toBe('trust_admin');
    expect(entry?.subjectId).toBe(actor.id);
    expect(entry?.reason).toBe('Safety investigation, case LV-1048');
    expect(entry?.detail).toEqual({ fields: 'email' });
  });

  it('writes nothing when the database audits the action itself', async () => {
    // `action: null` means the record is written transactionally in Postgres,
    // alongside the change. Emitting one here too would produce two rows for
    // one act.
    const { runAdminAction, repository } = await actingAs('admin');
    const { z } = await import('zod');

    await runAdminAction(
      {
        action: null,
        requires: 'admin',
        schema: z.object({}),
        ...passthrough,
        run: async () => null,
      },
      {},
    );

    const log = await repository.listAdminAudit();
    expect(log.items).toHaveLength(0);
  });

  it('does not lose the result when the audit write fails', async () => {
    const { runAdminAction } = await actingAs('admin');
    const { z } = await import('zod');
    const { LocalRepository } = await import('@/server/data/local');

    // On the prototype, not on a local instance: the layer resolves the
    // repository through `getRepository()`, which returns a cached singleton,
    // so an instance created here is a different object.
    vi.spyOn(LocalRepository.prototype, 'recordAdminAudit').mockRejectedValue(
      new Error('audit sink down'),
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runAdminAction(
      {
        action: 'user_directory_searched',
        requires: 'moderator',
        schema: z.object({}),
        ...passthrough,
        run: async () => 'the work still happened',
      },
      {},
    );

    // The operation completed. Discarding its result because the record could
    // not be written would be the wrong trade — but it must not pass unnoticed.
    expect(result).toEqual({ ok: true, data: 'the work still happened' });
    expect(errors).toHaveBeenCalled();
  });
});

describe('failure handling', () => {
  it('shows an AdminActionError, because those are written for a person', async () => {
    const { runAdminAction } = await actingAs('admin');
    const { z } = await import('zod');
    const { refused } = await import('@/server/admin/errors');

    const result = await runAdminAction(
      {
        action: 'user_directory_searched',
        requires: 'moderator',
        schema: z.object({}),
        ...passthrough,
        run: async () => {
          throw refused('You cannot change your own role.');
        },
      },
      {},
    );

    expect(result).toEqual({ ok: false, error: 'You cannot change your own role.' });
  });

  it('swallows anything else, because error text is where schemas leak', async () => {
    const { runAdminAction } = await actingAs('admin');
    const { z } = await import('zod');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runAdminAction(
      {
        action: 'user_directory_searched',
        requires: 'moderator',
        schema: z.object({}),
        ...passthrough,
        run: async () => {
          throw new Error('permission denied for relation verification_records');
        },
      },
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).not.toContain('verification_records');
    expect(result.ok === false && result.error).toBe('Something went wrong. Nothing was changed.');
  });

  it('records a failure as a failure', async () => {
    const { runAdminAction, repository } = await actingAs('admin');
    const { z } = await import('zod');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await runAdminAction(
      {
        action: 'user_directory_searched',
        requires: 'moderator',
        schema: z.object({}),
        ...passthrough,
        run: async () => {
          throw new Error('something internal');
        },
      },
      {},
    );

    const log = await repository.listAdminAudit();
    expect(log.items[0]?.outcome).toBe('failed');
  });

  it('rejects input that does not validate, before the operation runs', async () => {
    const { runAdminAction } = await actingAs('admin');
    const { z } = await import('zod');

    const ran = vi.fn(async () => null);

    const result = await runAdminAction(
      {
        action: 'user_directory_searched',
        requires: 'moderator',
        schema: z.object({ userId: z.string().min(1) }),
        subject: (input) => ({ type: 'user', id: input.userId }),
        run: ran,
      },
      { userId: '' },
    );

    expect(result.ok).toBe(false);
    expect(ran).not.toHaveBeenCalled();
  });
});
