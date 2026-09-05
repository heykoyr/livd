import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import { generateSeed } from '../src/server/data/local/seed.ts';

/**
 * Renders the demonstration seed as SQL.
 *
 * The seed generator in `src/server/data/local/seed.ts` is the single source of
 * truth for demo data — this script reuses it rather than describing the same
 * properties twice, so the local store and a seeded database cannot drift.
 *
 * Output goes to `.seed-sql/` (git-ignored) as numbered chunks, small enough
 * to apply one at a time.
 *
 * Every row it produces is marked `is_demo`, which is what makes the "Sample
 * data" badge appear and what keeps these properties out of the sitemap and
 * out of any search index.
 *
 * Node 20 cannot import TypeScript directly, so this is bundled with esbuild
 * first — see the `seed:sql` script in package.json.
 */

const OUT_DIR = new URL('../.seed-sql/', import.meta.url);

/** Deterministic UUIDv5-shaped id, so re-running produces the same rows. */
function uuidFor(key) {
  const h = createHash('sha1').update(`livd-demo:${key}`).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '5' + h.slice(13, 16),
    ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

function sqlString(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlBool(value) {
  if (value === null || value === undefined) return 'null';
  return value ? 'true' : 'false';
}

function sqlNumber(value) {
  return value === null || value === undefined ? 'null' : String(value);
}

const seed = generateSeed();

mkdirSync(OUT_DIR, { recursive: true });

const chunks = [];

/* ---------------------------------------------------------------- users --
 * Reviews reference profiles, which reference auth.users, so the accounts
 * have to exist. The `.invalid` TLD is reserved by RFC 2606 and can never
 * receive mail, which is the correct domain for an account that must never be
 * confused with a real person's.
 * ------------------------------------------------------------------------ */

const userRows = seed.users
  .map((user) => {
    const id = uuidFor(user.id);
    return `('${id}'::uuid, ${sqlString(user.email)})`;
  })
  .join(',\n  ');

chunks.push(`
-- Demo auth users. Deleting them cascades to profiles, reviews and everything
-- downstream, which is how the demo data is removed in one statement.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  v.id,
  'authenticated', 'authenticated',
  v.email,
  '',
  now(), now(), now(),
  '{"provider":"demo","providers":["demo"]}'::jsonb,
  '{"livd_demo":true}'::jsonb,
  false, false
from (values
  ${userRows}
) as v(id, email)
on conflict (id) do nothing;
`);

/* ----------------------------------------------------------- properties -- */

const propertyRows = seed.properties
  .map((p) => {
    const a = p.address;
    return `(${[
      `'${uuidFor(p.id)}'::uuid`,
      sqlString(p.slug),
      sqlString(a.buildingName),
      sqlString(a.streetAddress),
      sqlString(a.neighbourhood),
      sqlString(a.locality),
      sqlString(a.adminArea),
      sqlString(a.postalCode),
      sqlString(a.countryCode),
      sqlNumber(p.coordinates?.latitude ?? null),
      sqlNumber(p.coordinates?.longitude ?? null),
      sqlString(p.propertyType),
      sqlNumber(p.unitCount),
      sqlNumber(p.yearBuilt),
      'true',
      sqlString(p.createdAt),
    ].join(', ')})`;
  })
  .join(',\n  ');

chunks.push(`
insert into properties (
  id, slug, building_name, street_address, neighbourhood, locality,
  admin_area, postal_code, country_code, latitude, longitude,
  property_type, unit_count, year_built, is_demo, created_at
) values
  ${propertyRows}
on conflict (id) do nothing;
`);

/* -------------------------------------------------------------- reviews -- */

const REVIEW_BATCH = 60;

for (let i = 0; i < seed.reviews.length; i += REVIEW_BATCH) {
  const batch = seed.reviews.slice(i, i + REVIEW_BATCH);
  const rows = batch
    .map((r) => {
      return `(${[
        `'${uuidFor(r.id)}'::uuid`,
        `'${uuidFor(r.propertyId)}'::uuid`,
        `'${uuidFor(r.authorId)}'::uuid`,
        sqlString(r.residencyStatus),
        sqlString(r.movedInMonth),
        sqlString(r.movedOutMonth),
        sqlNumber(r.tenureMonths),
        sqlNumber(r.overallRating),
        sqlString(r.body),
        sqlBool(r.wouldRecommend),
        sqlNumber(r.rent?.amountMinor ?? null),
        sqlString(r.rent?.currencyCode ?? null),
        sqlString(r.rentPeriod),
        sqlBool(r.noticedManagementChange),
        sqlString(r.verificationLevel),
        sqlString(r.status),
        'true',
        sqlString(r.createdAt),
      ].join(', ')})`;
    })
    .join(',\n  ');

  chunks.push(`
insert into reviews (
  id, property_id, author_id, residency_status, moved_in_month, moved_out_month,
  tenure_months, overall_rating, body, would_recommend, rent_amount_minor,
  rent_currency, rent_period, noticed_management_change, verification_level,
  status, is_demo, created_at
) values
  ${rows}
on conflict (id) do nothing;
`);
}

/* ------------------------------------------------- review child records -- */

const categoryRows = [];
const departureRows = [];
const tagRows = [];

for (const r of seed.reviews) {
  const reviewId = uuidFor(r.id);

  for (const c of r.categoryRatings) {
    categoryRows.push(`('${reviewId}'::uuid, ${sqlString(c.categoryKey)}, ${c.rating})`);
  }

  if (r.primaryDepartureReason) {
    departureRows.push(
      `('${reviewId}'::uuid, ${sqlString(r.primaryDepartureReason)}, true)`,
    );
  }
  for (const key of r.secondaryDepartureReasons) {
    if (key === r.primaryDepartureReason) continue;
    departureRows.push(`('${reviewId}'::uuid, ${sqlString(key)}, false)`);
  }

  for (const key of new Set([...r.positiveTags, ...r.problemTags])) {
    tagRows.push(`('${reviewId}'::uuid, ${sqlString(key)})`);
  }
}

const CHILD_BATCH = 400;

function pushChildChunks(table, columns, rows) {
  for (let i = 0; i < rows.length; i += CHILD_BATCH) {
    chunks.push(`
insert into ${table} (${columns}) values
  ${rows.slice(i, i + CHILD_BATCH).join(',\n  ')}
on conflict do nothing;
`);
  }
}

pushChildChunks('review_category_ratings', 'review_id, category_key, rating', categoryRows);
pushChildChunks('review_departure_reasons', 'review_id, reason_key, is_primary', departureRows);
pushChildChunks('review_tags', 'review_id, tag_key', tagRows);

/* ------------------------------------------------------------- rollups -- */

chunks.push(`
-- The stats triggers fired per row during insert; this recomputes every
-- property once at the end so the rollup reflects the finished dataset.
select livd_refresh_property_stats(id) from properties where is_demo;
`);

/* --------------------------------------------------------------- write -- */

chunks.forEach((sql, index) => {
  const name = `${String(index + 1).padStart(2, '0')}.sql`;
  writeFileSync(new URL(name, OUT_DIR), sql.trim() + '\n', 'utf8');
});

console.log(`Wrote ${chunks.length} chunk(s) to .seed-sql/`);
console.log(
  `  ${seed.users.length} users, ${seed.properties.length} properties, ` +
    `${seed.reviews.length} reviews, ${categoryRows.length} category ratings, ` +
    `${departureRows.length} departure reasons, ${tagRows.length} tags`,
);
