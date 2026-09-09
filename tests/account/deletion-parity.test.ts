import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The two halves of account deletion, held together.
 *
 * The local adapter performs the erasure by hand; Postgres performs it through
 * foreign keys. Both have to produce the outcome the legal pages promise, and
 * nothing in either file makes the other one true — so this reads the
 * migrations as text and asserts the rules they encode.
 *
 * Blunt on purpose. It fails the moment somebody changes one side, which is
 * exactly when it should. It is also the test that would have caught 0018's
 * bug earlier: 0017 was correct in isolation and still made account deletion
 * impossible, because a guard trigger refused the foreign key's own update.
 */

const sql = (file: string): string =>
  readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8');

describe('what the schema promises to keep', () => {
  const migration = sql('0017_account_deletion.sql');

  it.each([
    ['reviews', 'author_id'],
    ['owner responses', 'responder_id'],
    ['the moderation log', 'actor_id'],
    ['reports', 'reporter_id'],
  ])('%s survives its author, severed', (_label, column) => {
    expect(migration).toContain(
      `foreign key (${column}) references profiles(id) on delete set null`,
    );
  });

  it('makes the severed columns nullable, or the sever cannot happen', () => {
    for (const alter of [
      'alter table reviews alter column author_id drop not null',
      'alter table owner_responses alter column responder_id drop not null',
      'alter table moderation_actions alter column actor_id drop not null',
      'alter table review_reports alter column reporter_id drop not null',
    ]) {
      expect(migration).toContain(alter);
    }
  });

  it('unblocks the three reviewed_by keys that would refuse the delete', () => {
    // These were NO ACTION, which does not mean "leave it alone" — it means the
    // delete is refused. Any moderator who had ever decided anything could
    // never have deleted their account.
    for (const constraint of [
      'property_claims_reviewed_by_fkey',
      'property_flags_reviewed_by_fkey',
      'verification_records_reviewed_by_fkey',
    ]) {
      expect(migration).toContain(constraint);
    }
  });
});

describe('the guard lets deletion through, and nothing else', () => {
  const migration = sql('0018_let_deletion_unlink.sql');

  it('permits an unlink only in that direction', () => {
    // Null to something would be somebody adopting an orphaned review.
    expect(migration).toContain('old.author_id is not null');
    expect(migration).toContain('new.author_id is null');
  });

  it('requires every other guarded column to be untouched', () => {
    for (const column of [
      'body',
      'would_recommend',
      'status',
      'verification_level',
      'verification_id',
      'property_id',
      'overall_rating',
      'residency_status',
      'moved_in_month',
      'moved_out_month',
      'helpful_count',
      'is_demo',
    ]) {
      expect(migration).toContain(`new.${column}`);
      expect(migration).toContain(`old.${column}`);
    }

    // The exemption is a conjunction of "is not distinct from" checks — one per
    // column — so it cannot be used as cover for changing anything else.
    const exemption = migration.slice(
      migration.indexOf('old.author_id is not null'),
      migration.indexOf('return new;', migration.indexOf('old.author_id is not null')),
    );
    expect((exemption.match(/is not distinct from/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });

  it('still refuses an ordinary attempt to change the author', () => {
    expect(migration).toContain('is distinct from old.author_id');
    expect(migration).toContain(
      "raise exception 'Only the written review and recommendation may be corrected'",
    );
  });
});
