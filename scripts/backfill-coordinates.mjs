/**
 * Fills in coordinates for properties that do not have one.
 *
 * Why this exists: geocoding runs when a property is created, so switching a
 * provider on — or switching to a better one — helps only the properties added
 * afterwards. Every property already on Livd without a coordinate stays
 * unverifiable until something goes back over them, and in the markets this
 * work is for, that is most of them.
 *
 * What it will not do:
 *
 *   - It never overwrites a coordinate that already exists. A property whose
 *     position was established once is not re-litigated by a later run against
 *     a different provider.
 *   - It never lowers the bar. Every address goes through the same precision
 *     gate as a live contribution, so a road-level answer is refused here
 *     exactly as it would be in the wizard. A backfill that quietly accepted
 *     weaker matches would put wrong coordinates on hundreds of properties at
 *     once, which is the worst version of the failure this whole layer is
 *     arranged against.
 *   - It never touches demonstration data. Seeded properties carry fabricated
 *     coordinates on purpose.
 *
 * Usage:
 *   node scripts/backfill-coordinates.mjs            # report only, writes nothing
 *   node scripts/backfill-coordinates.mjs --write    # apply
 *   node scripts/backfill-coordinates.mjs --write --limit 50
 *
 * Dry run is the default because this spends money on a commercial provider
 * and writes to the production database, and neither should happen because
 * somebody pressed up-arrow.
 */

import { createClient } from '@supabase/supabase-js';

import { getGeocoder } from '@/server/geo/geocoder';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 500;

/**
 * Requests per second.
 *
 * Nominatim's usage policy is one per second and this is the exact workload it
 * means by "bulk", so the slowest provider sets the pace for all of them.
 * Google and Mapbox permit far more, and going faster here would save minutes
 * on a job that runs once.
 */
const REQUESTS_PER_SECOND = 1;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. See .env.example.`);
    process.exit(1);
  }
  return value;
}

const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  // The service role, because this reads and writes across every contributor's
  // properties. It is the one credential that bypasses RLS and it is why this
  // is a script somebody runs deliberately rather than a route.
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const geocoder = getGeocoder();

if (geocoder.name === 'none') {
  console.error(
    'No geocoder is configured, so there is nothing to backfill with.\n' +
      'Set LIVD_GEOCODER (and the matching key) — see .env.example.',
  );
  process.exit(1);
}

console.log(`Geocoder: ${geocoder.name}`);
console.log(WRITE ? 'Mode:     writing\n' : 'Mode:     dry run (pass --write to apply)\n');

const { data, error } = await supabase
  .from('properties')
  .select(
    'id, slug, building_name, street_address, neighbourhood, locality, admin_area, postal_code, country_code, property_type',
  )
  .is('latitude', null)
  .eq('status', 'active')
  .eq('is_demo', false)
  .limit(LIMIT);

if (error) {
  console.error(`Could not read properties: ${error.message}`);
  process.exit(1);
}

const properties = data ?? [];

if (properties.length === 0) {
  console.log('Every active property already has a coordinate. Nothing to do.');
  process.exit(0);
}

console.log(`${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} without a coordinate.\n`);

let resolved = 0;
let refused = 0;
let failed = 0;
const byCountry = new Map();

for (const row of properties) {
  const input = {
    buildingName: row.building_name,
    streetAddress: row.street_address,
    neighbourhood: row.neighbourhood,
    locality: row.locality,
    adminArea: row.admin_area,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    propertyType: row.property_type,
  };

  const label = [row.building_name, row.street_address, row.locality]
    .filter(Boolean)
    .join(', ');

  let coordinates = null;
  try {
    coordinates = await geocoder.geocode(input);
  } catch (cause) {
    // `geocode` is contracted never to throw, so reaching here is a defect
    // rather than a bad address. Counted separately so it cannot hide inside
    // the refusals.
    failed += 1;
    console.log(`  error      ${label} — ${cause instanceof Error ? cause.message : cause}`);
    continue;
  }

  const stats = byCountry.get(row.country_code) ?? { resolved: 0, refused: 0 };

  if (!coordinates) {
    refused += 1;
    stats.refused += 1;
    byCountry.set(row.country_code, stats);
    console.log(`  no match   ${label}`);
  } else {
    resolved += 1;
    stats.resolved += 1;
    byCountry.set(row.country_code, stats);
    console.log(
      `  resolved   ${label} → ${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)}`,
    );

    if (WRITE) {
      // The database rounds to three decimal places on write, so what lands is
      // never unit-precise however precise the provider was.
      const { error: writeError } = await supabase
        .from('properties')
        .update({ latitude: coordinates.latitude, longitude: coordinates.longitude })
        .eq('id', row.id)
        // Belt and braces against a concurrent write between the read above and
        // this update: only fill a coordinate that is still absent.
        .is('latitude', null);

      if (writeError) {
        console.log(`             could not save: ${writeError.message}`);
      }
    }
  }

  await new Promise((r) => setTimeout(r, 1000 / REQUESTS_PER_SECOND));
}

console.log('\n---');
console.log(`resolved  ${resolved}`);
console.log(`no match  ${refused}`);
if (failed > 0) console.log(`errors    ${failed}`);

if (byCountry.size > 1) {
  console.log('\nBy market:');
  for (const [country, stats] of [...byCountry].sort((a, b) => b[1].resolved - a[1].resolved)) {
    console.log(
      `  ${country}  ${String(stats.resolved).padStart(4)} resolved, ${String(stats.refused).padStart(4)} no match`,
    );
  }
}

if (!WRITE && resolved > 0) {
  console.log('\nNothing was saved. Run again with --write to apply.');
}
