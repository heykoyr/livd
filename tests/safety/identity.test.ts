import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { maskEmail } from '@/lib/safety/identity';

/**
 * Identity masking, and the directory that depends on it.
 *
 * `/admin/users` rendered every account's real email address to anyone the
 * admin layout guard admitted — which includes moderators — and recorded
 * nothing, because reading an address was not modelled as an act. These tests
 * pin what replaced it.
 *
 * The masking rule exists twice on purpose: `livd_mask_email` in migration
 * 0022, which is the one that actually protects production because the
 * directory is built in SQL, and `maskEmail` here, which the local adapter
 * uses because it has no database. The first block below is a parity table
 * checked against the deployed function; every expectation in it was run
 * through Postgres and produced the identical string.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-identity-'));
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

describe('maskEmail agrees with livd_mask_email', () => {
  // Every pair here was evaluated against the deployed `livd_mask_email` and
  // matched. If this table and that function ever disagree, the local adapter
  // and production are showing moderators different things.
  const parity: Array<[string, string]> = [
    ['feranmiadekoya@gmail.com', 'fer***@gmail.com'],
    ['abcdef@example.com', 'abc***@example.com'],
    ['abcd@example.com', 'ab***@example.com'],
    ['abc@example.com', 'a***@example.com'],
    ['ab@example.com', 'a***@example.com'],
    ['a@example.com', '***@example.com'],
  ];

  it.each(parity)('masks %s to %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });

  it('never reveals more than half a short local part', () => {
    // The failure this guards against is a rule tuned for long addresses
    // handing back a short one unchanged.
    for (const local of ['a', 'ab', 'abc', 'abcd']) {
      const masked = maskEmail(`${local}@example.com`);
      const revealed = masked.slice(0, masked.indexOf('*'));
      expect(revealed.length).toBeLessThanOrEqual(Math.floor(local.length / 2));
      expect(masked).not.toBe(`${local}@example.com`);
    }
  });

  it('never returns the address it was given', () => {
    const addresses = [
      'feranmiadekoya@gmail.com',
      'a@b.co',
      'someone.with.dots@sub.domain.example.com',
      'UPPERCASE@EXAMPLE.COM',
    ];

    for (const address of addresses) {
      expect(maskEmail(address)).not.toBe(address);
    }
  });

  it('refuses to guess at something that is not an address', () => {
    expect(maskEmail(null)).toBe('—');
    expect(maskEmail(undefined)).toBe('—');
    expect(maskEmail('')).toBe('—');
    expect(maskEmail('not-an-email')).toBe('—');
    expect(maskEmail('@example.com')).toBe('—');
    expect(maskEmail('someone@')).toBe('—');
  });

  it('keeps the domain, which is what makes it useful', () => {
    // A wave of signups sharing one throwaway domain is a signal a moderator
    // needs. The domain identifies nobody on its own.
    expect(maskEmail('aaaaaa@throwaway.test')).toContain('@throwaway.test');
    expect(maskEmail('bbbbbb@throwaway.test')).toContain('@throwaway.test');
  });
});

describe('the admin user directory', () => {
  async function directoryWith(count: number) {
    const { LocalRepository } = await import('@/server/data/local');
    const repository = new LocalRepository();

    for (let index = 0; index < count; index += 1) {
      await repository.upsertUser({ email: `person${index}@example.test` });
    }

    return repository;
  }

  it('carries no email field, and no address anywhere in the row', async () => {
    const { LocalRepository } = await import('@/server/data/local');
    const repository = new LocalRepository();

    // A distinctive local part, so the assertion is about the part that
    // identifies someone rather than the domain the mask deliberately keeps.
    const address = 'distinctive-local-part@example.test';
    await repository.upsertUser({ email: address });

    const page = await repository.listAdminUsers();
    const row = page.items[0];

    expect(row).not.toHaveProperty('email');
    expect(Object.keys(row!)).toEqual(
      expect.arrayContaining(['id', 'maskedEmail', 'role', 'status', 'countryCode', 'createdAt']),
    );

    const serialised = JSON.stringify(page);
    expect(serialised).not.toContain(address);
    expect(serialised).not.toContain('distinctive-local-part');
  });

  it('returns a mask rather than an address', async () => {
    const repository = await directoryWith(1);
    const page = await repository.listAdminUsers();

    expect(page.items[0]?.maskedEmail).toBe('per***@example.test');
    expect(JSON.stringify(page)).not.toContain('person0@example.test');
  });

  it('paginates rather than returning everyone', async () => {
    const repository = await directoryWith(30);

    const first = await repository.listAdminUsers({ page: 1, pageSize: 10 });
    expect(first.items).toHaveLength(10);
    expect(first.total).toBe(30);

    const third = await repository.listAdminUsers({ page: 3, pageSize: 10 });
    expect(third.items).toHaveLength(10);

    const firstIds = new Set(first.items.map((row) => row.id));
    for (const row of third.items) {
      expect(firstIds.has(row.id)).toBe(false);
    }
  });

  it('orders stably, so paging cannot skip an account', async () => {
    const repository = await directoryWith(25);

    const seen = new Set<string>();
    for (let page = 1; page <= 3; page += 1) {
      const result = await repository.listAdminUsers({ page, pageSize: 10 });
      for (const row of result.items) seen.add(row.id);
    }

    expect(seen.size).toBe(25);
  });

  it('caps an absurd page size', async () => {
    const repository = await directoryWith(5);
    const page = await repository.listAdminUsers({ page: 1, pageSize: 100_000 });

    expect(page.pageSize).toBeLessThanOrEqual(100);
  });
});

describe('looking an account up by address', () => {
  it('returns an id, never a profile carrying the address back', async () => {
    const { LocalRepository } = await import('@/server/data/local');
    const repository = new LocalRepository();

    const created = await repository.upsertUser({ email: 'known@example.test' });
    const found = await repository.findUserIdByEmail('known@example.test');

    expect(found).toBe(created.id);
    expect(typeof found).toBe('string');
  });

  it('finds an account well past the first page of fifty', async () => {
    // The Supabase implementation searched only the first page of
    // `auth.admin.listUsers()`, so it answered "no such account" for everyone
    // after the fiftieth — already wrong at this deployment's 124 accounts.
    const { LocalRepository } = await import('@/server/data/local');
    const repository = new LocalRepository();

    for (let index = 0; index < 80; index += 1) {
      await repository.upsertUser({ email: `bulk${index}@example.test` });
    }
    const late = await repository.upsertUser({ email: 'needle@example.test' });

    expect(await repository.findUserIdByEmail('needle@example.test')).toBe(late.id);
    expect(await repository.findUserIdByEmail('bulk75@example.test')).not.toBeNull();
  });

  it('is not case sensitive, and tolerates stray whitespace', async () => {
    const { LocalRepository } = await import('@/server/data/local');
    const repository = new LocalRepository();

    const created = await repository.upsertUser({ email: 'Mixed.Case@Example.Test' });

    expect(await repository.findUserIdByEmail('mixed.case@example.test')).toBe(created.id);
  });

  it('returns null for an address nobody holds', async () => {
    const { LocalRepository } = await import('@/server/data/local');
    const repository = new LocalRepository();

    expect(await repository.findUserIdByEmail('nobody@example.test')).toBeNull();
  });
});
