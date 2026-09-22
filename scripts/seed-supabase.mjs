import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { generateSeed } from '../src/server/data/local/seed.ts';
import { SAMPLE_AS_OF } from '../src/server/data/seed/generate.ts';

/**
 * Loads the sample dataset into a Supabase project.
 *
 * Reuses the generator in `src/server/data/local/seed.ts`, so the local store
 * and a seeded database cannot describe different properties. See
 * docs/sample-data.md for the dataset itself.
 *
 * Everything it writes is marked `is_demo` (properties and reviews) or lives on
 * the reserved `demo.livd.invalid` domain (accounts). That is what makes the
 * "Sample data" badge appear, keeps these pages out of the sitemap and out of
 * search indexes, and keeps them out of the admin platform figures.
 *
 * INSERT-ONLY. Every write is `ON CONFLICT DO NOTHING`: a row that already
 * exists — seeded or real — is never modified, so re-running is safe and
 * growing the dataset means inserting only what is new. A property whose rows
 * are already all present is skipped without sending anything.
 *
 * It never deletes, except under --purge, which refuses outright if any real
 * account has touched sample data (saved it, location-checked it, reviewed or
 * reported it) — because deleting a sample property cascades into those rows.
 *
 * It never sends email. It writes rows directly and runs no application code,
 * and every notification Livd sends is sent by a Server Action.
 *
 *   npm run seed:supabase -- --dry                       # the plan, nothing written
 *   npm run seed:supabase                                # everything
 *   npm run seed:supabase -- --countries=NG,GB           # just these markets
 *   npm run seed:supabase -- --cities=NG/Lagos,GB/London # just these cities
 *   npm run seed:supabase -- --full                      # resend even complete properties
 *   npm run seed:supabase -- --purge                     # remove it all, if nothing real depends on it
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY: sample rows have no authenticated
 * author, so every RLS insert policy correctly refuses them. That key is the
 * one real secret in the project — read from .env.local and never logged.
 */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const entry = argv.find((arg) => arg.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3).split(',').map((v) => v.trim()).filter(Boolean) : undefined;
};

const DRY_RUN = flag('dry');
const PURGE = flag('purge');
const FULL = flag('full');
const COUNTRIES = option('countries');
const CITIES = option('cities');

/** Rows per request. Each review and rating fires the stats trigger, and the
 *  authenticator's statement timeout is eight seconds. */
const BATCH = 400;
/** Properties checked and written together. */
const PROPERTY_BATCH = 40;

/* ---------------------------------------------------------------- env -- */

function loadEnvLocal() {
  const env = {};
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8').replace(/^\uFEFF/, '');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (match) env[match[1]] = match[2].trim();
    }
  } catch {
    // No .env.local; fall back to the process environment.
  }
  return { ...env, ...process.env };
}

const env = loadEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Add them to .env.local. The service-role key is at:\n' +
      '  Supabase dashboard > Project Settings > API keys > service_role',
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* --------------------------------------------------------------- ids -- */

/** Mirrors `livd_demo_uuid` in the database, so both agree on every id. */
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

const addressKey = (countryCode, locality, street, building) =>
  [countryCode, locality, street ?? '', building ?? ''].map((v) => String(v).toLowerCase()).join('|');

/* ------------------------------------------------------------- helpers -- */

function fail(context, error) {
  throw new Error(`${context}: ${error.message}`);
}

/** Every row of a query, a thousand at a time — PostgREST truncates past that. */
async function readAll(build, context) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) fail(context, error);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function insertAll(table, rows, conflictTarget) {
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from(table)
      .upsert(slice, { onConflict: conflictTarget, ignoreDuplicates: true });
    if (error) fail(table, error);
    written += slice.length;
  }
  return written;
}

async function countWhere(table, select, apply) {
  const { count, error } = await apply(
    supabase.from(table).select(select, { count: 'exact', head: true }),
  );
  if (error) fail(`count ${table}`, error);
  return count ?? 0;
}

/* --------------------------------------------------------------- purge -- */

if (PURGE) {
  // What deleting every sample property and account would cascade into, that
  // is not itself sample data. Any of it is a reason to stop.
  const references = {
    'saved by a real account': await countWhere(
      'saved_properties',
      'user_id, properties!inner(is_demo)',
      (q) => q.eq('properties.is_demo', true),
    ),
    'location checks': await countWhere(
      'property_verifications',
      'id, properties!inner(is_demo)',
      (q) => q.eq('properties.is_demo', true),
    ),
    'real reviews of sample properties': await countWhere(
      'reviews',
      'id, properties!inner(is_demo)',
      (q) => q.eq('is_demo', false).eq('properties.is_demo', true),
    ),
    'ownership claims': await countWhere(
      'property_claims',
      'id, properties!inner(is_demo)',
      (q) => q.eq('properties.is_demo', true),
    ),
    'reports on sample reviews': await countWhere(
      'review_reports',
      'id, reviews!inner(is_demo)',
      (q) => q.eq('reviews.is_demo', true),
    ),
  };

  const blocking = Object.entries(references).filter(([, count]) => count > 0);
  if (blocking.length > 0) {
    console.error('Refusing to purge: real activity depends on sample data.\n');
    for (const [label, count] of blocking) console.error(`  ${count} ${label}`);
    console.error(
      '\nDeleting sample properties would cascade into these rows. Resolve them by hand ' +
        '(they belong to real people) before purging, or leave the sample data and turn it ' +
        'off with LIVD_SHOW_DEMO_DATA=false instead.',
    );
    process.exit(1);
  }

  console.log(DRY_RUN ? 'Would remove all sample data.' : 'Removing sample data...');
  if (!DRY_RUN) {
    const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const demoUsers = (data?.users ?? []).filter((u) => u.email?.endsWith('@demo.livd.invalid'));
    for (const user of demoUsers) await supabase.auth.admin.deleteUser(user.id);
    const { error } = await supabase.from('properties').delete().eq('is_demo', true);
    if (error) fail('purge properties', error);
    console.log(`  removed ${demoUsers.length} sample accounts and every sample property`);
  }
  process.exit(0);
}

/* ------------------------------------------------------------ preflight -- */

// Signals and review-burst detection look at the last 48 hours. A seed dated
// inside that window would put sample accounts in front of moderators.
const ageDays = (Date.now() - SAMPLE_AS_OF.getTime()) / 86_400_000;
if (ageDays < 3) {
  console.error(
    `SAMPLE_AS_OF (${SAMPLE_AS_OF.toISOString()}) is less than three days ago. ` +
      'Seeded reviews dated this recently would trip the Trust & Safety detectors. Wait, or move it back.',
  );
  process.exit(1);
}

const seed = generateSeed({ scale: 'full', countries: COUNTRIES, cities: CITIES });

// The original sixteen are always part of a full run; a scoped run takes only
// what falls inside its scope.
const inScope = (p) =>
  (!COUNTRIES || COUNTRIES.map((c) => c.toUpperCase()).includes(p.address.countryCode)) &&
  (!CITIES ||
    CITIES.map((c) => c.toLowerCase()).includes(`${p.address.countryCode}/${p.address.locality}`.toLowerCase()));

const properties = seed.properties.filter(inScope);
const scopedIds = new Set(properties.map((p) => p.id));
const reviews = seed.reviews.filter((r) => scopedIds.has(r.propertyId));

console.log(
  `${DRY_RUN ? 'Plan' : 'Seeding'}: ${properties.length} properties, ${reviews.length} reviews` +
    (COUNTRIES ? ` in ${COUNTRIES.join(', ')}` : '') +
    (CITIES ? ` in ${CITIES.join(', ')}` : ''),
);

/* --- what is already there --- */

const existing = await readAll(
  () =>
    supabase
      .from('properties')
      .select('id, slug, is_demo, country_code, locality, street_address, building_name, status')
      .order('id'),
  'existing properties',
);

const existingById = new Map(existing.map((row) => [row.id, row]));
const realSlugs = new Set(existing.filter((row) => !row.is_demo).map((row) => row.slug));
const demoSlugOwner = new Map(existing.filter((row) => row.is_demo).map((row) => [row.slug, row.id]));
const demoAddressOwner = new Map(
  existing
    .filter((row) => row.is_demo && row.status === 'active')
    .map((row) => [addressKey(row.country_code, row.locality, row.street_address, row.building_name), row.id]),
);

const skipped = [];
const candidates = properties.filter((p) => {
  const id = uuidFor(p.id);
  if (existingById.has(id)) {
    if (!existingById.get(id).is_demo) {
      skipped.push(`${p.slug}: id belongs to a real property`);
      return false;
    }
    return true;
  }
  // Only sample rows are compared: 0052 lets a real property and a sample one
  // share a name, and a real slug has a random suffix no seed can produce.
  if (realSlugs.has(p.slug)) {
    skipped.push(`${p.slug}: slug taken by a real property`);
    return false;
  }
  const slugOwner = demoSlugOwner.get(p.slug);
  const addressOwner = demoAddressOwner.get(
    addressKey(p.address.countryCode, p.address.locality, p.address.streetAddress, p.address.buildingName),
  );
  if ((slugOwner && slugOwner !== id) || (addressOwner && addressOwner !== id)) {
    skipped.push(`${p.slug}: another sample property already has this name here`);
    return false;
  }
  return true;
});

if (DRY_RUN) {
  const fresh = candidates.filter((p) => !existingById.has(uuidFor(p.id))).length;
  console.log(`  ${fresh} new, ${candidates.length - fresh} already present, ${skipped.length} skipped`);
  for (const line of skipped.slice(0, 20)) console.log(`  skip ${line}`);
  console.log('\nDry run complete. Nothing was written.');
  process.exit(0);
}

/* --- accounts --- */

const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (listError) fail('list accounts', listError);
const idByEmail = new Map((listed?.users ?? []).map((u) => [u.email, u.id]));

let accountsCreated = 0;
for (const user of seed.users) {
  if (idByEmail.has(user.email)) continue;
  // Confirmed directly, so no confirmation email is ever sent.
  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    email_confirm: true,
    user_metadata: { livd_demo: true },
  });
  if (error && !/already/i.test(error.message)) fail(`account ${user.email}`, error);
  if (data?.user) idByEmail.set(user.email, data.user.id);
  accountsCreated += 1;
}

const emailBySeedId = new Map(seed.users.map((u) => [u.id, u.email]));
function authorIdFor(seedUserId) {
  const resolved = idByEmail.get(emailBySeedId.get(seedUserId));
  if (!resolved) throw new Error(`No account for ${seedUserId}`);
  return resolved;
}

/* ------------------------------------------------------------- rows -- */

function propertyRow(p) {
  return {
    id: uuidFor(p.id),
    slug: p.slug,
    building_name: p.address.buildingName,
    street_address: p.address.streetAddress,
    neighbourhood: p.address.neighbourhood,
    locality: p.address.locality,
    admin_area: p.address.adminArea,
    postal_code: p.address.postalCode,
    country_code: p.address.countryCode,
    latitude: p.coordinates?.latitude ?? null,
    longitude: p.coordinates?.longitude ?? null,
    property_type: p.propertyType,
    unit_count: p.unitCount,
    year_built: p.yearBuilt,
    is_demo: true,
    created_at: p.createdAt,
  };
}

function reviewRow(r) {
  return {
    id: uuidFor(r.id),
    property_id: uuidFor(r.propertyId),
    author_id: authorIdFor(r.authorId),
    residency_status: r.residencyStatus,
    moved_in_month: r.movedInMonth,
    moved_out_month: r.movedOutMonth,
    tenure_months: r.tenureMonths,
    overall_rating: r.overallRating,
    body: r.body,
    would_recommend: r.wouldRecommend,
    rent_amount_minor: r.rent?.amountMinor ?? null,
    rent_currency: r.rent?.currencyCode ?? null,
    rent_period: r.rentPeriod,
    noticed_management_change: r.noticedManagementChange,
    verification_level: r.verificationLevel,
    status: r.status,
    helpful_count: r.helpfulCount,
    is_demo: true,
    created_at: r.createdAt,
  };
}

function childRows(batchReviews) {
  const ratings = [];
  const departures = [];
  const tags = [];
  for (const r of batchReviews) {
    const reviewId = uuidFor(r.id);
    for (const c of r.categoryRatings) {
      ratings.push({ review_id: reviewId, category_key: c.categoryKey, rating: c.rating });
    }
    if (r.primaryDepartureReason) {
      departures.push({ review_id: reviewId, reason_key: r.primaryDepartureReason, is_primary: true });
    }
    for (const key of r.secondaryDepartureReasons) {
      if (key !== r.primaryDepartureReason) {
        departures.push({ review_id: reviewId, reason_key: key, is_primary: false });
      }
    }
    for (const key of new Set([...r.positiveTags, ...r.problemTags])) {
      tags.push({ review_id: reviewId, tag_key: key });
    }
  }
  return { ratings, departures, tags };
}

/** Whether every row a batch would write is already in the database. */
async function batchComplete(batch, batchReviews, expected) {
  if (!batch.every((p) => existingById.has(uuidFor(p.id)))) return false;
  const ids = batch.map((p) => uuidFor(p.id));
  const [reviewCount, ratingCount, departureCount, tagCount] = await Promise.all([
    countWhere('reviews', 'id', (q) => q.in('property_id', ids).eq('is_demo', true)),
    countWhere('review_category_ratings', 'review_id, reviews!inner(property_id)', (q) =>
      q.in('reviews.property_id', ids),
    ),
    countWhere('review_departure_reasons', 'review_id, reviews!inner(property_id)', (q) =>
      q.in('reviews.property_id', ids),
    ),
    countWhere('review_tags', 'review_id, reviews!inner(property_id)', (q) => q.in('reviews.property_id', ids)),
  ]);
  return (
    reviewCount === batchReviews.length &&
    ratingCount === expected.ratings.length &&
    departureCount === expected.departures.length &&
    tagCount === expected.tags.length
  );
}

/* ------------------------------------------------------------- write -- */

const reviewsByProperty = new Map();
for (const r of reviews) {
  const bucket = reviewsByProperty.get(r.propertyId) ?? [];
  bucket.push(r);
  reviewsByProperty.set(r.propertyId, bucket);
}

const totals = { properties: 0, reviews: 0, ratings: 0, departures: 0, tags: 0, batchesSkipped: 0 };
const started = Date.now();

for (let i = 0; i < candidates.length; i += PROPERTY_BATCH) {
  const batch = candidates.slice(i, i + PROPERTY_BATCH);
  const batchReviews = batch.flatMap((p) => reviewsByProperty.get(p.id) ?? []);
  const children = childRows(batchReviews);

  if (!FULL && (await batchComplete(batch, batchReviews, children))) {
    totals.batchesSkipped += 1;
  } else {
    totals.properties += await insertAll('properties', batch.map(propertyRow), 'id');
    totals.reviews += await insertAll('reviews', batchReviews.map(reviewRow), 'id');
    totals.ratings += await insertAll('review_category_ratings', children.ratings, 'review_id,category_key');
    totals.departures += await insertAll('review_departure_reasons', children.departures, 'review_id,reason_key');
    totals.tags += await insertAll('review_tags', children.tags, 'review_id,tag_key');
  }

  const done = Math.min(i + PROPERTY_BATCH, candidates.length);
  const elapsed = Math.round((Date.now() - started) / 1000);
  process.stdout.write(`\r  ${done}/${candidates.length} properties · ${elapsed}s`);
}
process.stdout.write('\n');

console.log(
  `\nDone. Sent ${totals.properties} properties, ${totals.reviews} reviews, ` +
    `${totals.ratings} category ratings, ${totals.departures} departure reasons and ` +
    `${totals.tags} tags (existing rows are left untouched); ` +
    `${totals.batchesSkipped} batches were already complete` +
    (accountsCreated ? `; created ${accountsCreated} sample accounts` : '') +
    '.',
);
if (skipped.length > 0) {
  console.log(`Skipped ${skipped.length} properties that would have collided:`);
  for (const line of skipped.slice(0, 50)) console.log(`  ${line}`);
}
