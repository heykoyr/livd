import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { generateSeed } from '../src/server/data/local/seed.ts';

/**
 * Loads the demonstration data into a Supabase project.
 *
 * Reuses the generator in `src/server/data/local/seed.ts`, so the local store
 * and a seeded database cannot describe different properties.
 *
 * Everything it writes is marked `is_demo`, which is what makes the "Sample
 * data" badge appear, keeps these properties out of the sitemap, and marks
 * their pages noindex. Nothing here should ever be mistaken for a real review.
 *
 * Idempotent: every row is upserted on a deterministic id derived from the
 * seed key, so re-running updates rather than duplicates.
 *
 *   npm run seed:supabase           # apply
 *   npm run seed:supabase -- --dry  # report what it would do
 *   npm run seed:supabase -- --purge
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY: demo rows have no authenticated author,
 * so every RLS insert policy correctly refuses them. That key is the one real
 * secret in the project — it is read from .env.local and never logged.
 */

const DRY_RUN = process.argv.includes('--dry');
const PURGE = process.argv.includes('--purge');
const BATCH = 500;

/* ---------------------------------------------------------------- env -- */

function loadEnvLocal() {
  const env = {};
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
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

/* ------------------------------------------------------------- helpers -- */

async function upsertAll(table, rows, conflictTarget) {
  if (rows.length === 0) return 0;
  if (DRY_RUN) return rows.length;

  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from(table)
      .upsert(slice, { onConflict: conflictTarget, ignoreDuplicates: false });

    if (error) throw new Error(`${table}: ${error.message}`);
    written += slice.length;
    process.stdout.write(`\r  ${table}: ${written}/${rows.length}`);
  }
  process.stdout.write('\n');
  return written;
}

/* --------------------------------------------------------------- purge -- */

if (PURGE) {
  console.log('Removing demo data...');
  if (!DRY_RUN) {
    // Deleting the accounts cascades through profiles to reviews and every
    // child row, so this is the whole cleanup.
    const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const demoUsers = (data?.users ?? []).filter((u) =>
      u.email?.endsWith('@demo.livd.invalid'),
    );
    for (const user of demoUsers) {
      await supabase.auth.admin.deleteUser(user.id);
    }
    await supabase.from('properties').delete().eq('is_demo', true);
    console.log(`  removed ${demoUsers.length} demo accounts and all demo properties`);
  }
  process.exit(0);
}

/* ---------------------------------------------------------------- seed -- */

const seed = generateSeed();
console.log(
  `${DRY_RUN ? 'Would seed' : 'Seeding'} ${seed.properties.length} properties, ` +
    `${seed.reviews.length} reviews, ${seed.users.length} accounts`,
);

/* --- accounts --- */

if (!DRY_RUN) {
  const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const have = new Set((existing?.users ?? []).map((u) => u.email));

  let created = 0;
  for (const user of seed.users) {
    if (have.has(user.email)) continue;
    const { error } = await supabase.auth.admin.createUser({
      email: user.email,
      email_confirm: true,
      user_metadata: { livd_demo: true },
    });
    if (error && !/already/i.test(error.message)) {
      throw new Error(`auth user ${user.email}: ${error.message}`);
    }
    created += 1;
    process.stdout.write(`\r  accounts: ${created}`);
  }
  if (created > 0) process.stdout.write('\n');
}

// Re-read so ids match whatever the auth service assigned. The database's own
// `livd_demo_uuid` is used when accounts are created in SQL, but accounts made
// through the admin API get server-generated ids, so the mapping is looked up
// by email rather than assumed.
const { data: allUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
const idByEmail = new Map((allUsers?.users ?? []).map((u) => [u.email, u.id]));

function authorIdFor(seedUserId) {
  const seedUser = seed.users.find((u) => u.id === seedUserId);
  const resolved = seedUser ? idByEmail.get(seedUser.email) : undefined;
  return resolved ?? uuidFor(seedUserId);
}

/* --- properties --- */

await upsertAll(
  'properties',
  seed.properties.map((p) => ({
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
  })),
  'id',
);

/* --- reviews --- */

await upsertAll(
  'reviews',
  seed.reviews.map((r) => ({
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
    is_demo: true,
    created_at: r.createdAt,
  })),
  'id',
);

/* --- review child rows --- */

const categoryRatings = [];
const departureReasons = [];
const tags = [];

for (const r of seed.reviews) {
  const reviewId = uuidFor(r.id);

  for (const c of r.categoryRatings) {
    categoryRatings.push({ review_id: reviewId, category_key: c.categoryKey, rating: c.rating });
  }

  if (r.primaryDepartureReason) {
    departureReasons.push({
      review_id: reviewId,
      reason_key: r.primaryDepartureReason,
      is_primary: true,
    });
  }
  for (const key of r.secondaryDepartureReasons) {
    if (key === r.primaryDepartureReason) continue;
    departureReasons.push({ review_id: reviewId, reason_key: key, is_primary: false });
  }

  for (const key of new Set([...r.positiveTags, ...r.problemTags])) {
    tags.push({ review_id: reviewId, tag_key: key });
  }
}

await upsertAll('review_category_ratings', categoryRatings, 'review_id,category_key');
await upsertAll('review_departure_reasons', departureReasons, 'review_id,reason_key');
await upsertAll('review_tags', tags, 'review_id,tag_key');

/* --- rollups --- */

if (!DRY_RUN) {
  // The triggers fired per row during insert; this recomputes each property
  // once against the finished dataset.
  for (const p of seed.properties) {
    const { error } = await supabase.rpc('livd_refresh_property_stats', {
      target_property_id: uuidFor(p.id),
    });
    if (error) throw new Error(`refresh stats: ${error.message}`);
  }
}

console.log(
  DRY_RUN
    ? '\nDry run complete. Nothing was written.'
    : `\nSeeded. ${categoryRatings.length} category ratings, ` +
        `${departureReasons.length} departure reasons, ${tags.length} tags.`,
);
