import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { VERIFICATION_GEO, VERIFICATION_LIFETIME, VERIFICATION_WEIGHTS } from '@/config/verification';
import { SCORING } from '@/lib/intelligence/scoring';

/**
 * The two copies of the verification arithmetic.
 *
 * The proximity rule exists twice on purpose: in TypeScript, where the local
 * development adapter runs it and where it can be tested exhaustively, and in
 * SQL, where production runs it because the decision has to be made somewhere a
 * browser holding the public key cannot reach. Two copies of a rule drift, and
 * the failure mode is quiet — a radius tuned in one place and not the other
 * means the number in the code review is not the number deciding anything.
 *
 * So this reads the migration as text and asserts the constants match. It is a
 * blunt instrument and that is the point: it fails loudly the moment somebody
 * edits one side, which is exactly when it should.
 *
 * `docs/database-schema.md` documents the same pairing for the scoring
 * constants, which have carried this hazard since 0003.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

const sql = (file: string): string => readFileSync(join(MIGRATIONS, file), 'utf8');

describe('verification constants are the same in TypeScript and SQL', () => {
  const migration = sql('0014_property_verification.sql');

  it('uses the same verification radius', () => {
    expect(migration).toContain(
      `create or replace function livd_verification_radius_meters(country char(2))`,
    );
    expect(migration).toMatch(
      new RegExp(`select ${VERIFICATION_GEO.radiusMeters}::numeric`),
    );
  });

  it('has no per-country radius overrides that SQL does not know about', () => {
    // `livd_verification_radius_meters` returns one number and ignores its
    // argument. The moment an override is added to the config it has to be
    // added to that function too, or production and development will disagree
    // about who is verified. This is the guard that makes that impossible to
    // forget.
    expect(Object.keys(VERIFICATION_GEO.radiusOverridesByCountry)).toHaveLength(0);
  });

  it('uses the same grid half-cell', () => {
    expect(migration).toContain(
      `power(${VERIFICATION_GEO.coordinateGridHalfCellDegrees} * (pi() / 180)`,
    );
  });

  it('uses the same accuracy cap', () => {
    expect(migration).toContain(
      `least(greatest(reported_accuracy_meters, 0), ${VERIFICATION_GEO.accuracyAllowanceCapMeters})`,
    );
  });

  it('uses the same maximum acceptable accuracy', () => {
    expect(migration).toContain(
      `max_accuracy_meters   constant numeric := ${VERIFICATION_GEO.maxAcceptableAccuracyMeters};`,
    );
  });

  it('uses the same maximum fix age', () => {
    expect(migration).toContain(
      `max_fix_age_seconds   constant numeric := ${VERIFICATION_GEO.maxFixAgeSeconds};`,
    );
  });

  it('uses the same implausible-movement threshold', () => {
    expect(migration).toContain(
      `implausible_speed_kmh constant numeric := ${VERIFICATION_GEO.implausibleSpeedKmh};`,
    );
  });

  it('uses the same attach window', () => {
    expect(migration).toContain(
      `attach_window_minutes constant integer := ${VERIFICATION_LIFETIME.attachWindowMinutes};`,
    );
  });

  it('uses the same Earth radius', () => {
    expect(migration).toContain('select 6371008.8::numeric');
  });
});

describe('the location weight is the same in all three places', () => {
  it('config and the scoring module agree', () => {
    expect(SCORING.weightLocationVerified).toBe(VERIFICATION_WEIGHTS.location);
  });

  it('SQL agrees', () => {
    expect(sql('0014_property_verification.sql')).toContain(
      `when 'location_verified' then ${VERIFICATION_WEIGHTS.location}`,
    );
  });

  it('sits between an unchecked claim and a document a moderator read', () => {
    // Not an arbitrary assertion. The ordering is the argument: presence at an
    // address is real evidence and is worth more than nothing, and it is not
    // evidence of a tenancy and must be worth less than one.
    expect(SCORING.weightUnverified).toBeLessThan(SCORING.weightLocationVerified);
    expect(SCORING.weightLocationVerified).toBeLessThan(SCORING.weightVerified);
  });
});

describe('the verified-review count means the same thing everywhere', () => {
  it('SQL counts both levels', () => {
    expect(sql('0014_property_verification.sql')).toContain(
      "where verification_level in ('verified_resident', 'location_verified')",
    );
  });
});

describe('the enum gains its value before anything uses it', () => {
  it('adds location_verified in a migration of its own', () => {
    // Postgres will not let a new enum label be used in the transaction that
    // adds it, and every migration runner wraps a file in one. Splitting them
    // is not tidiness; 0014 fails to apply otherwise.
    const enumMigration = sql('0013_location_verified_level.sql');
    expect(enumMigration).toContain("add value if not exists 'location_verified'");
    expect(enumMigration).not.toContain('create table');
    expect(enumMigration).not.toContain('create or replace function');
  });
});
