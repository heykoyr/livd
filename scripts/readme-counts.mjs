/**
 * The numbers in README.md, counted rather than remembered.
 *
 * Every figure the README states about the size of this project — tables,
 * policies, migrations, routes, tests — went stale twice in nine days. Not
 * because anyone was careless, but because a number written by hand is a
 * snapshot, and this repository moves faster than anyone updates prose. A wrong
 * count is worse than no count: the README's whole authority rests on it being
 * checkable, and a reader who verifies one figure and finds it wrong stops
 * believing the rest.
 *
 *   npm run docs:counts            # rewrite README.md in place
 *   npm run docs:counts -- --check # report drift and exit 1, for `npm run verify`
 *   npm run docs:counts -- --skip-tests   # every count except the slow one
 *
 * ---------------------------------------------------------------------------
 * How the README is marked up
 *
 * Each maintained figure sits between a pair of HTML comments:
 *
 *   <!--count:tables-->`41` tables<!--/count-->
 *
 * GitHub strips HTML comments when it renders Markdown, so the published page
 * is exactly what it was before. Inside the block this script replaces **only
 * the first run of digits** and leaves every other character alone — so the
 * wording belongs to whoever writes the README, and only the arithmetic belongs
 * here. That also means a block must contain exactly one number: the one it
 * maintains.
 *
 * The markers cannot go *inside* a code span. `` `<!--count:x-->41<!--/count-->` ``
 * renders the comment literally, because everything between backticks is taken
 * as text. Wrap the span instead, as above.
 * ---------------------------------------------------------------------------
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const SKIP_TESTS = args.includes('--skip-tests');

/* -------------------------------------------------------------------------
 * Walking the tree
 *
 * `node_modules`, `.next` and `.data` are excluded by name rather than by a
 * glob library, because adding a dependency to count files would be a poor
 * trade.
 * ---------------------------------------------------------------------- */

const IGNORED = new Set(['node_modules', '.next', '.git', '.data', '.seed-sql', '.vercel', 'out']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function readAll(files) {
  return files.map((f) => readFileSync(f, 'utf8'));
}

/* -------------------------------------------------------------------------
 * The counts
 * ---------------------------------------------------------------------- */

function migrationSql() {
  const dir = join(ROOT, 'supabase', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => join(dir, f));
  return { files, sql: readAll(files).join('\n') };
}

function countDistinct(sql, pattern, strip) {
  const found = sql.match(pattern) ?? [];
  return new Set(found.map((m) => m.replace(strip, '').toLowerCase())).size;
}

function computeCounts() {
  const { files: migrationFiles, sql } = migrationSql();

  const srcFiles = walk(join(ROOT, 'src'));
  const testFiles = walk(join(ROOT, 'tests')).filter((f) => /\.test\.tsx?$/.test(f));
  const componentFiles = walk(join(ROOT, 'src', 'components')).filter((f) => f.endsWith('.tsx'));
  const routeFiles = walk(join(ROOT, 'src', 'app')).filter((f) => /[\\/]page\.tsx$/.test(f));

  const counts = {
    /** Every table the migrations create, deduplicated — some are altered later. */
    tables: countDistinct(
      sql,
      /create table (?:if not exists )?(?:public\.)?[a-z_]+/gi,
      /create table (?:if not exists )?(?:public\.)?/i,
    ),

    /** Row Level Security policies. Counted as written: a policy per statement. */
    policies: (sql.match(/create policy/gi) ?? []).length,

    /**
     * Distinct database functions. `create or replace` is idempotent and a
     * function is frequently redefined by a later migration, so the name is
     * what is counted, not the statement.
     */
    dbFunctions: countDistinct(
      sql,
      /create or replace function (?:public\.)?[a-z_]+/gi,
      /create or replace function (?:public\.)?/i,
    ),

    migrations: migrationFiles.length,

    /** One per `page.tsx` under the App Router. */
    routes: routeFiles.length,

    sourceFiles: srcFiles.filter((f) => /\.(ts|tsx|css)$/.test(f)).length,

    testFiles: testFiles.length,

    /**
     * Exported components. Every component in this codebase is a PascalCase
     * function export; helpers like `buttonClasses` and `scoreTone` are
     * deliberately excluded by the capital letter.
     */
    components: readAll(componentFiles).join('\n').match(/^export function [A-Z][A-Za-z0-9]*/gm)
      ?.length ?? 0,

    /**
     * Runs recorded in the security log — one dated heading per session spent
     * attacking the deployed database.
     *
     * Deliberately not "attacks". Sixteen of its result tables number their
     * rows and eight do not, so counting numbered rows undercounts by whatever
     * the unnumbered tables hold. A figure that is quietly wrong in a document
     * whose entire value is that it can be checked would be worse than no
     * figure, and a run is a thing this file actually delimits.
     */
    securityRuns: (readFileSync(join(ROOT, 'docs', 'security-testing.md'), 'utf8').match(
      /^## \d{4}-\d{2}-\d{2} /gm,
    ) ?? []).length,
  };

  if (!SKIP_TESTS) counts.tests = countTests();
  return counts;
}

/**
 * The number of tests, from Vitest itself rather than by counting `it(` in the
 * source. Counting text undercounts badly: `it.each([...])` is one call and
 * many tests, and this suite leans on it.
 *
 * Two ways to get it, and the cheap one first. `npm test` writes a JSON report
 * as it runs, so if that report is newer than every test and source file, the
 * suite has not changed since it was produced and its total is exact and free.
 * Only when it is missing or stale does this fall back to `vitest list`, which
 * collects every file to enumerate what would run — correct, but a four-minute
 * pass that duplicates work `npm run verify` has usually just done.
 */
const TEST_REPORT = join(ROOT, '.vitest-report.json');

function newestMtime(files) {
  return files.reduce((latest, f) => {
    try {
      return Math.max(latest, statSync(f).mtimeMs);
    } catch {
      return latest;
    }
  }, 0);
}

function countTests() {
  const watched = [...walk(join(ROOT, 'tests')), ...walk(join(ROOT, 'src'))];

  try {
    const report = statSync(TEST_REPORT);
    if (report.mtimeMs >= newestMtime(watched)) {
      const total = JSON.parse(readFileSync(TEST_REPORT, 'utf8')).numTotalTests;
      if (Number.isInteger(total)) return total;
    }
  } catch {
    // No report, or an unreadable one. Fall through and collect.
  }

  const out = join(tmpdir(), `livd-test-list-${process.pid}.json`);
  try {
    execFileSync(
      process.execPath,
      [join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'list', `--json=${out}`],
      { cwd: ROOT, stdio: 'ignore' },
    );
    const listed = JSON.parse(readFileSync(out, 'utf8'));
    return Array.isArray(listed) ? listed.length : (listed.tests?.length ?? 0);
  } catch (error) {
    throw new Error(
      `Could not count tests (${error.message}). Run \`npm test\` first, or pass --skip-tests.`,
    );
  }
}

/* -------------------------------------------------------------------------
 * Rewriting
 * ---------------------------------------------------------------------- */

const format = (n) => n.toLocaleString('en-GB');

function apply(markdown, counts) {
  const seen = new Set();
  const drift = [];

  const updated = markdown.replace(
    /<!--count:([a-zA-Z]+)-->([\s\S]*?)<!--\/count-->/g,
    (whole, key, body) => {
      seen.add(key);
      if (!(key in counts)) return whole;

      const wanted = format(counts[key]);
      // Only the first run of digits, so the prose around it is never touched.
      const next = body.replace(/[0-9][0-9,]*/, wanted);
      if (next === body) {
        if (!/[0-9]/.test(body)) {
          throw new Error(`Block <!--count:${key}--> contains no number to update.`);
        }
      } else {
        drift.push({ key, from: body.match(/[0-9][0-9,]*/)[0], to: wanted });
      }
      return `<!--count:${key}-->${next}<!--/count-->`;
    },
  );

  const unused = Object.keys(counts).filter((k) => !seen.has(k));
  return { updated, drift, unused };
}

/* -------------------------------------------------------------------------
 * Run
 * ---------------------------------------------------------------------- */

const counts = computeCounts();
const markdown = readFileSync(README, 'utf8');
const { updated, drift, unused } = apply(markdown, counts);

const width = Math.max(...Object.keys(counts).map((k) => k.length));
for (const [key, value] of Object.entries(counts)) {
  console.log(`  ${key.padEnd(width)}  ${format(value)}`);
}

if (unused.length > 0) {
  console.log(`\n  Counted but not referenced in README.md: ${unused.join(', ')}`);
}

if (drift.length === 0) {
  console.log('\nREADME.md is up to date.');
  process.exit(0);
}

if (CHECK) {
  console.error('\nREADME.md is out of date:');
  for (const d of drift) console.error(`  ${d.key}: says ${d.from}, should be ${d.to}`);
  console.error('\nRun `npm run docs:counts` to fix.');
  process.exit(1);
}

writeFileSync(README, updated);
console.log('\nUpdated README.md:');
for (const d of drift) console.log(`  ${d.key}: ${d.from} → ${d.to}`);
