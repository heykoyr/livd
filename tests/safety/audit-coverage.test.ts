import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REASON_REQUIRED, normaliseAuditAction } from '@/server/admin/audit';

/**
 * Audit coverage.
 *
 * A vocabulary entry for an action no code takes is a claim that Livd audits
 * something it does not, and that is a worse failure than a missing entry —
 * a gap looks like a gap, but a name in a list looks like a guarantee.
 *
 * Five entries were removed in Phase 10 for exactly that reason. This file is
 * what stops them coming back, and what stops the two halves of the vocabulary
 * drifting: the actions the administrative layer writes into the audit log,
 * and the ones that reach it from the moderation trail through
 * `normaliseAuditAction`.
 *
 * It reads the source rather than mocking it, and there is deliberately no
 * hand-maintained list of "actions the layer emits" to check against — a list
 * like that is one more thing to drift. What produces an action is worked out
 * from the files themselves: the administrative layer, the migrations, or the
 * normaliser. A vocabulary entry that appears in none of the three is a name
 * nothing produces.
 */

const ROOT = process.cwd();

async function sourceOf(...parts: string[]): Promise<string> {
  return readFile(join(ROOT, ...parts), 'utf8');
}

/**
 * Source with its comments removed.
 *
 * Necessary because the adapter *documents* the bug it replaced, quoting the
 * unchecked insert verbatim. A test that matched the explanation would fail
 * for the wrong reason and — worse — would start passing if somebody deleted
 * the comment.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Every `.ts` in the administrative layer, concatenated. */
async function adminLayerSource(): Promise<string> {
  const directory = join(ROOT, 'src', 'server', 'admin');
  const files = (await readdir(directory)).filter((name) => name.endsWith('.ts'));

  const contents = await Promise.all(files.map((file) => readFile(join(directory, file), 'utf8')));
  return contents.join('\n');
}

/** Every migration, concatenated. */
async function migrationSource(): Promise<string> {
  const directory = join(ROOT, 'supabase', 'migrations');
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql'));

  const contents = await Promise.all(files.map((file) => readFile(join(directory, file), 'utf8')));
  return contents.join('\n');
}

/** Every action name in the union, read out of the type declaration. */
async function vocabulary(): Promise<string[]> {
  const source = await sourceOf('src', 'server', 'admin', 'audit.ts');
  const end = "| 'audit_log_read';";

  const declaration = source.slice(
    source.indexOf('export type AdminAuditAction ='),
    source.indexOf(end) + end.length,
  );

  return [...declaration.matchAll(/'([a-z_]+)'/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

describe('the vocabulary describes what actually happens', () => {
  it('lists every action exactly once', async () => {
    const actions = await vocabulary();

    expect(actions.length).toBeGreaterThan(0);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('has something that produces every action it lists', async () => {
    // The failure this catches: somebody adds a name to the union, means to
    // wire it up, and does not.
    const actions = await vocabulary();
    const layer = await adminLayerSource();
    const migrations = await migrationSource();

    // The strings the moderation trail actually stores. Taken from its
    // writers, not invented for the test.
    const fromModeration = new Set(
      [
        'set_status:removed',
        'set_verification:verified_resident',
        'report_upheld',
        'claim_approved',
        'verification_approved',
        'role_changed',
        'status_changed',
      ].map(normaliseAuditAction),
    );

    for (const action of actions) {
      const produced =
        layer.includes(`'${action}'`) ||
        migrations.includes(`'${action}'`) ||
        fromModeration.has(action);

      expect(produced, `${action} is in the vocabulary but nothing produces it`).toBe(true);
    }
  });

  it('writes nothing into the trail that the vocabulary does not know', async () => {
    // The other direction. A migration calling `livd_record_admin_audit` with
    // a string the union has never heard of would produce entries no filter in
    // the console can find.
    const migrations = await migrationSource();
    const actions = new Set(await vocabulary());

    const calls = [...migrations.matchAll(/livd_record_admin_audit\(\s*\n\s*'([a-z_]+)'/g)];
    expect(calls.length).toBeGreaterThan(0);

    for (const [, action] of calls) {
      expect(
        actions.has(action ?? ''),
        `${action} is written by a migration but is not in the union`,
      ).toBe(true);
    }
  });

  it('has no entry for an export, because nothing exports', async () => {
    // Phase 9's defining property is an absence: no code path takes an
    // authority request and produces an account's data. A `data_exported`
    // entry in the vocabulary would quietly contradict it — reading as though
    // exporting is a thing Livd does and records.
    const actions = await vocabulary();

    expect(actions).not.toContain('data_exported');
    expect(actions).not.toContain('security_config_changed');
  });

  it('requires a reason only for actions that exist', async () => {
    const actions = new Set(await vocabulary());

    for (const action of REASON_REQUIRED) {
      expect(actions.has(action), `${action} needs a reason but is not in the vocabulary`).toBe(
        true,
      );
    }
  });

  it('does not require a written reason to open the trail', () => {
    // Deliberate. Requiring one would mean the people meant to be checking the
    // log stop opening it, and a log nobody reads deters nothing. The read is
    // recorded; it does not have to be justified.
    expect(REASON_REQUIRED.has('audit_log_read')).toBe(false);
  });
});

describe('the two normalisers agree', () => {
  it('maps the same strings as livd_normalise_audit_action', async () => {
    // The local adapter uses the TypeScript one and Postgres uses the SQL one.
    // If they disagree, a filter means one thing in development and another in
    // production — the kind of difference nobody notices until an
    // investigation comes up empty.
    const migration = await sourceOf('supabase', 'migrations', '0036_audit_feed.sql');

    const pairs = [...migration.matchAll(/when raw (?:like|=)\s+'([^']+)'\s+then\s+'([^']+)'/g)];
    expect(pairs.length).toBeGreaterThan(5);

    for (const [, pattern, expected] of pairs) {
      // 'set_status:%' in SQL is a prefix; give the TypeScript side a real
      // value carrying it.
      const sample = (pattern ?? '').replace('%', 'x');
      expect(normaliseAuditAction(sample), `${sample} normalises differently`).toBe(expected);
    }
  });

  it('passes an unrecognised action through unchanged', () => {
    // Rather than bucketing it as 'other'. An action nobody has taught the
    // function about should look conspicuous in the list, not disappear.
    expect(normaliseAuditAction('something_nobody_mapped')).toBe('something_nobody_mapped');
  });
});

describe('the four oldest moderation paths are atomic', () => {
  it('no longer writes the record as a separate unchecked statement', async () => {
    // The bug this replaced: an UPDATE whose error was thrown, followed by an
    // INSERT into `moderation_actions` whose error was never examined. A failed
    // record left a review removed with nothing saying who removed it, and the
    // operation reported success.
    const source = withoutComments(
      await sourceOf('src', 'server', 'data', 'supabase', 'index.ts'),
    );

    // One writer is left — `recordModerationAction`, the last app-side one —
    // and its result goes through `unwrap`, which throws on an error. An insert
    // that is not wrapped that way is a record that can fail in silence.
    const inserts = [...source.matchAll(/\.from\('moderation_actions'\)\s*\.insert\(/g)];
    expect(inserts).toHaveLength(1);

    for (const insert of inserts) {
      const preceding = source.slice(Math.max(0, (insert.index ?? 0) - 200), insert.index);
      expect(
        preceding.includes('unwrap('),
        'a moderation_actions insert is back to being fire-and-forget',
      ).toBe(true);
    }
  });

  it('routes all four through a database function instead', async () => {
    const source = await sourceOf('src', 'server', 'data', 'supabase', 'index.ts');

    for (const fn of [
      'livd_set_review_status',
      'livd_set_review_verification',
      'livd_resolve_report',
      'livd_decide_claim',
    ]) {
      expect(source.includes(fn), `${fn} is not called by the adapter`).toBe(true);
    }
  });

  it('takes the actor from the session rather than an argument', async () => {
    // Each of those functions reads `auth.uid()`. An actor passed in is an
    // actor that can be chosen, which is not an audit trail.
    const migration = await sourceOf('supabase', 'migrations', '0035_moderation_trail.sql');

    const bodies = migration.split('create or replace function').slice(1);
    expect(bodies).toHaveLength(4);

    for (const body of bodies) {
      expect(body).toContain('auth.uid()');
      expect(body).toContain('livd_is_moderator()');
      expect(body).toContain('insert into moderation_actions');
    }
  });
});

describe('no function parameter shadows a column it writes', () => {
  it('finds no ambiguous reference in any migration', async () => {
    // This has now bitten twice: `documentation_received` in 0033 and
    // `resolution` in 0035. Inside an UPDATE the target table's columns are in
    // scope, so a parameter with a column's name makes the reference
    // ambiguous — and Postgres resolves that at *call* time rather than at
    // creation. The function is created without complaint and fails the first
    // time somebody uses it, which review does not catch and a test that never
    // passes that argument does not either.
    expect(await shadowedParameters()).toEqual([]);
  });

  it('would catch it if one came back', async () => {
    // A detector nobody has seen fail is a detector nobody knows works. This
    // runs the same extraction over a function that has the bug on purpose.
    const broken = `create or replace function livd_example(
  target_report uuid,
  resolution    text
)
returns void
language plpgsql
as $fn$
begin
  update review_reports
     set status = 'upheld',
         resolution = btrim(resolution),
         resolved_at = now()
   where id = target_report;
end;
$fn$;`;

    expect(shadowedIn('example.sql', broken)).toEqual([
      'example.sql: livd_example takes a parameter named resolution, which it also writes',
    ]);
  });
});

/** Every parameter in every migration that collides with a column it assigns. */
async function shadowedParameters(): Promise<string[]> {
  const directory = join(ROOT, 'supabase', 'migrations');
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql'));

  const found: string[] = [];
  for (const file of files) {
    found.push(...shadowedIn(file, await readFile(join(directory, file), 'utf8')));
  }

  return found;
}

function shadowedIn(file: string, sql: string): string[] {
  const collisions: string[] = [];

  for (const block of sql.split(/create or replace function /i).slice(1)) {
    const open = block.indexOf('(');
    const close = block.indexOf(')');
    if (open < 0 || close < 0) continue;

    const name = block.slice(0, open).trim();

    const parameters = new Set(
      block
        .slice(open + 1, close)
        .split(',')
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((word): word is string => !!word && /^[a-z_][a-z0-9_]*$/.test(word)),
    );

    // Only an UPDATE puts the target table's columns in scope. An INSERT's
    // VALUES list does not, which is why `livd_open_authority_request` may
    // take a `documentation_received` argument quite safely.
    const body = block.slice(0, block.indexOf('$fn$;') + 5 || undefined);

    for (const [, assignments] of body.matchAll(
      /\bupdate\s+[a-z_.]+\s+set\s+([\s\S]*?)(?:\bwhere\b|;)/gi,
    )) {
      for (const fragment of (assignments ?? '').split(',')) {
        const column = /^\s*([a-z_][a-z0-9_]*)\s*=/.exec(fragment)?.[1];

        if (column && parameters.has(column)) {
          collisions.push(
            `${file}: ${name} takes a parameter named ${column}, which it also writes`,
          );
        }
      }
    }
  }

  return collisions;
}
