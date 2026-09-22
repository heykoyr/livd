// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The sample-data loader, read as text.
 *
 * It runs with the service role against production, where it can do anything,
 * so what it may do is pinned here rather than trusted to review: it inserts
 * and never updates, it deletes only behind the purge's refusal, and it never
 * reaches the code paths that send email.
 */

const source = () => readFile(join(process.cwd(), 'scripts', 'seed-supabase.mjs'), 'utf8');

describe('seed loader', () => {
  it('never overwrites a row that exists', async () => {
    const text = await source();
    const upserts = [...text.matchAll(/\.upsert\(([^;]+?)\)/gs)].map((match) => match[1]!);
    expect(upserts.length).toBeGreaterThan(0);
    for (const call of upserts) expect(call).toContain('ignoreDuplicates: true');
    // No row is written except through the upserts above. (`createHash(...)
    // .update` is hashing, not the database.)
    expect(text).not.toMatch(/\.from\([^)]*\)\s*\.(?:update|insert)\(/);
    expect(text).not.toMatch(/\.(?:update|insert)\(\s*[{[]/);
  });

  it('deletes only after checking that nothing real depends on sample data', async () => {
    const text = await source();
    const deletes = [...text.matchAll(/\.delete\(/g)];
    expect(deletes).toHaveLength(1);
    expect(text.indexOf('Refusing to purge')).toBeGreaterThan(0);
    expect(text.indexOf('Refusing to purge')).toBeLessThan(deletes[0]!.index!);
    // The delete is scoped to sample rows.
    expect(text.slice(deletes[0]!.index!, deletes[0]!.index! + 60)).toContain(".eq('is_demo', true)");
  });

  it('writes rows directly and never goes through the application', async () => {
    const text = await source();
    expect(text).not.toMatch(/server\/notify|server\/actions|\/api\//);
    // Accounts are confirmed at creation, so no confirmation email is sent.
    expect(text).toContain('email_confirm: true');
    expect(text).not.toMatch(/inviteUserByEmail|signInWithOtp|resetPasswordForEmail/);
  });

  it('refuses a seed dated inside the window the abuse detectors watch', async () => {
    const text = await source();
    expect(text).toContain('SAMPLE_AS_OF');
    expect(text).toMatch(/ageDays < 3/);
  });
});
