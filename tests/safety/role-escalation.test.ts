import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hasRole } from '@/server/auth/guards';
import type { UserProfile } from '@/types/domain';

/**
 * Privilege escalation.
 *
 * Until migration 0020, a moderator could make themselves an administrator
 * from a browser. `profiles_moderator_update` was written
 * `for update using (livd_is_moderator())` with no `with check`, so Postgres
 * reused the `using` expression as the check and permitted any new value;
 * `livd_guard_profile_self_update` then exempted moderators from the one rule
 * protecting `role` and `status`; and `authenticated` holds UPDATE on
 * `profiles` by Supabase default. A single
 * `PATCH /rest/v1/profiles?id=eq.<self>` carrying `{"role":"admin"}` was the
 * entire exploit, and the `requireRole('admin')` check in the Server Action
 * never entered into it, because PostgREST does not run Server Actions.
 *
 * These tests pin the rules that replaced it. They run against the local
 * adapter, in process, because that is where they can run on every commit —
 * and the same rules are enforced by `livd_set_user_role` and
 * `livd_set_user_status` in Postgres, which is what actually protects
 * production. The database half is exercised directly against the deployed
 * instance; `docs/security-testing.md` records those runs and their results.
 *
 * The distinction matters and is worth stating plainly: passing here proves
 * the rules are right, not that Postgres enforces them. Both were checked.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-escalation-'));
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
  const { resetCache } = await import('@/server/data/local/store');
  resetCache();
  await rm(join(workDir, '.data'), { recursive: true, force: true });
});

/** One account of each rank, so a test can name the pair it means. */
async function cast() {
  const { LocalRepository } = await import('@/server/data/local');
  const repository = new LocalRepository();

  const stamp = Date.now();
  const resident = await repository.upsertUser({ email: `resident-${stamp}@example.test` });
  const moderator = await repository.upsertUser({ email: `moderator-${stamp}@example.test` });
  const trustAdmin = await repository.upsertUser({ email: `trust-${stamp}@example.test` });
  const founder = await repository.upsertUser({ email: `founder-${stamp}@example.test` });
  const second = await repository.upsertUser({ email: `second-${stamp}@example.test` });

  // Bootstrapping: the first administrator cannot be granted by an
  // administrator, because there is not one yet. Everything after this goes
  // through the sanctioned path.
  const { getDatabase, mutate } = await import('@/server/data/local/store');
  await getDatabase();
  await mutate((database) => {
    for (const id of [founder.id, second.id]) {
      const row = database.users.find((u) => u.id === id);
      if (row) row.role = 'admin';
    }
  });

  await repository.setUserRole(moderator.id, 'moderator', founder.id, 'Joined the moderation team');
  await repository.setUserRole(trustAdmin.id, 'trust_admin', founder.id, 'Joined Trust & Safety');

  return { repository, resident, moderator, trustAdmin, founder, second };
}

describe('the escalation path is closed', () => {
  it('refuses a moderator granting themselves administrator', async () => {
    const { repository, moderator } = await cast();

    await expect(
      repository.setUserRole(moderator.id, 'admin', moderator.id, 'promoting myself'),
    ).rejects.toThrow(/Only an administrator may change a role/);

    const after = await repository.getUserById(moderator.id);
    expect(after?.role).toBe('moderator');
  });

  it('refuses a moderator granting anybody a role at all', async () => {
    const { repository, moderator, resident } = await cast();

    await expect(
      repository.setUserRole(resident.id, 'moderator', moderator.id, 'a favour'),
    ).rejects.toThrow(/Only an administrator may change a role/);

    const after = await repository.getUserById(resident.id);
    expect(after?.role).toBe('resident');
  });

  it('refuses a Trust & Safety admin granting roles', async () => {
    const { repository, trustAdmin, resident } = await cast();

    await expect(
      repository.setUserRole(resident.id, 'trust_admin', trustAdmin.id, 'expanding the team'),
    ).rejects.toThrow(/Only an administrator may change a role/);
  });

  it('refuses a resident granting themselves anything', async () => {
    const { repository, resident } = await cast();

    await expect(
      repository.setUserRole(resident.id, 'admin', resident.id, 'why not'),
    ).rejects.toThrow(/Only an administrator may change a role/);
  });

  it('refuses an administrator changing their own role', async () => {
    const { repository, founder } = await cast();

    await expect(
      repository.setUserRole(founder.id, 'resident', founder.id, 'stepping back'),
    ).rejects.toThrow(/You cannot change your own role/);
  });

  it('refuses a role change with no recorded reason', async () => {
    const { repository, founder, resident } = await cast();

    await expect(repository.setUserRole(resident.id, 'moderator', founder.id, '  ')).rejects.toThrow(
      /A reason is required/,
    );

    const after = await repository.getUserById(resident.id);
    expect(after?.role).toBe('resident');
  });

  it('refuses to demote the last administrator', async () => {
    const { repository, founder, second } = await cast();

    // Two administrators: demoting one is fine.
    await repository.setUserRole(second.id, 'resident', founder.id, 'Left the company');

    // One left: it cannot be demoted, or nobody could ever grant a role again.
    await expect(
      repository.setUserRole(founder.id, 'resident', second.id, 'nobody left'),
    ).rejects.toThrow(/Only an administrator may change a role/);
  });

  it('lets an administrator grant a role, and records why', async () => {
    const { repository, founder, resident } = await cast();

    await repository.setUserRole(resident.id, 'moderator', founder.id, 'Joined the moderation team');

    const after = await repository.getUserById(resident.id);
    expect(after?.role).toBe('moderator');

    const trail = await repository.listModerationActions(resident.id);
    const entry = trail.find((action) => action.action === 'role_changed');

    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(founder.id);
    expect(entry?.previousStatus).toBe('resident');
    expect(entry?.newStatus).toBe('moderator');
    expect(entry?.reason).toBe('Joined the moderation team');
  });

  it('writes one audit row for a repeated identical grant', async () => {
    const { repository, founder, resident } = await cast();

    await repository.setUserRole(resident.id, 'moderator', founder.id, 'Joined the team');
    await repository.setUserRole(resident.id, 'moderator', founder.id, 'Joined the team');

    const trail = await repository.listModerationActions(resident.id);
    const grants = trail.filter((action) => action.action === 'role_changed');

    expect(grants).toHaveLength(1);
  });
});

describe('account standing is separate from privilege', () => {
  it('lets a moderator restrict an ordinary account, with a reason', async () => {
    const { repository, moderator, resident } = await cast();

    await repository.setUserStatus(resident.id, 'restricted', moderator.id, 'Repeated spam');

    const after = await repository.getUserById(resident.id);
    expect(after?.status).toBe('restricted');
    expect(after?.role).toBe('resident');

    const trail = await repository.listModerationActions(resident.id);
    const entry = trail.find((action) => action.action === 'status_changed');
    expect(entry?.actorId).toBe(moderator.id);
    expect(entry?.reason).toBe('Repeated spam');
  });

  it('refuses a plain moderator suspending an account', async () => {
    const { repository, moderator, resident } = await cast();

    await expect(
      repository.setUserStatus(resident.id, 'suspended', moderator.id, 'Coordinated manipulation'),
    ).rejects.toThrow(/Trust and Safety authorisation/);

    const after = await repository.getUserById(resident.id);
    expect(after?.status).toBe('active');
  });

  it('lets a Trust & Safety admin suspend an account', async () => {
    const { repository, trustAdmin, resident } = await cast();

    await repository.setUserStatus(
      resident.id,
      'suspended',
      trustAdmin.id,
      'Coordinated review manipulation',
    );

    const after = await repository.getUserById(resident.id);
    expect(after?.status).toBe('suspended');
  });

  it('refuses a moderator acting on another privileged account', async () => {
    const { repository, moderator, trustAdmin } = await cast();

    await expect(
      repository.setUserStatus(trustAdmin.id, 'restricted', moderator.id, 'a disagreement'),
    ).rejects.toThrow(/Only an administrator may act on a privileged account/);
  });

  it('refuses anyone changing their own standing', async () => {
    const { repository, moderator } = await cast();

    await expect(
      repository.setUserStatus(moderator.id, 'active', moderator.id, 'lifting my own restriction'),
    ).rejects.toThrow(/You cannot change your own standing/);
  });

  it('leaves a suspended account its published reviews', async () => {
    const { repository, trustAdmin, resident } = await cast();

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
      resident.id,
    );

    await repository.createReview(
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
      resident.id,
    );

    await repository.setUserStatus(resident.id, 'suspended', trustAdmin.id, 'Abusive conduct');

    // Sanctioning the author does not retract what they wrote. Those are two
    // decisions, and a moderator who wants the review gone still has to make
    // the second one, with its own reason and its own audit row.
    const published = await repository.listPublicReviews(property.id);
    expect(published.total).toBe(1);
  });
});

describe('the role ladder', () => {
  const account = (role: UserProfile['role']): UserProfile => ({
    id: 'u',
    email: '',
    role,
    status: 'active',
    countryCode: null,
    preferredLocale: 'en',
    createdAt: new Date().toISOString(),
  });

  it('does not put a property owner above a resident', () => {
    // `owner` used to rank above `resident`, which modelled the party a
    // reviewer most needs protecting from as the more privileged one.
    expect(hasRole(account('owner'), 'moderator')).toBe(false);
    expect(hasRole(account('owner'), 'trust_admin')).toBe(false);
    expect(hasRole(account('owner'), 'admin')).toBe(false);
  });

  it('stops a moderator at the identity boundary', () => {
    expect(hasRole(account('moderator'), 'moderator')).toBe(true);
    expect(hasRole(account('moderator'), 'trust_admin')).toBe(false);
    expect(hasRole(account('moderator'), 'admin')).toBe(false);
  });

  it('lets a Trust & Safety admin moderate but not grant roles', () => {
    expect(hasRole(account('trust_admin'), 'moderator')).toBe(true);
    expect(hasRole(account('trust_admin'), 'trust_admin')).toBe(true);
    expect(hasRole(account('trust_admin'), 'admin')).toBe(false);
  });

  it('gives an administrator every tier', () => {
    expect(hasRole(account('admin'), 'moderator')).toBe(true);
    expect(hasRole(account('admin'), 'trust_admin')).toBe(true);
    expect(hasRole(account('admin'), 'admin')).toBe(true);
  });

  it('gives a suspended administrator nothing', () => {
    const suspended: UserProfile = { ...account('admin'), status: 'suspended' };
    expect(hasRole(suspended, 'moderator')).toBe(false);
    expect(hasRole(suspended, 'admin')).toBe(false);
  });
});
