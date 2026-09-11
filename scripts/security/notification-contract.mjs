/**
 * Does the SQL still answer what the adapter asks?
 *
 * The Supabase adapter reaches migration 0044's functions by RPC, which means
 * argument names and column names in strings — the compiler checks none of
 * it, and the test suite runs against the local adapter, which has no
 * Postgres at all. A renamed parameter, a reordered return column or a
 * revoked grant would typecheck, pass 707 tests, build, deploy, and fail on
 * the first review anybody published.
 *
 * That is exactly how the owner right of reply came to be broken: a PostgREST
 * embed for a foreign key that does not exist, discarded because the error
 * was never read. The last section here re-runs that query and the one it
 * replaced, so the fix has evidence rather than a claim.
 *
 * Read-only apart from one ledger row it writes and then deletes, so it is
 * safe against production.
 *
 *   node --env-file=.env.local scripts/security/notification-contract.mjs
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const report = (label, ok, detail = '') => {
  (ok ? pass++ : fail++);
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`);
};

const KEY = `selftest:${Date.now()}`;

console.log('\n=== The RPC contract the Supabase adapter depends on ===\n');

// Exactly the argument names src/server/data/supabase/index.ts sends.
{
  const { data, error } = await admin.rpc('livd_claim_notification', {
    target_key: KEY,
    target_kind: 'review_published',
    target_user: null,
    target_channel: 'user',
    target_payload: { kind: 'review_published', propertySlug: 'selftest' },
  });
  report('livd_claim_notification accepts the adapter\'s arguments', !error, error?.message ?? '');
  report('  … and returns a row id on first claim', typeof data === 'string' && data.length > 0, String(data).slice(0, 8));
}

{
  const { data, error } = await admin.rpc('livd_claim_notification', {
    target_key: KEY,
    target_kind: 'review_published',
    target_user: null,
    target_channel: 'user',
    target_payload: {},
  });
  report('  … and null on the second, so one event is one email', !error && data === null, error?.message ?? String(data));
}

{
  const { error } = await admin.rpc('livd_settle_notification', {
    target_key: KEY, target_status: 'sent', target_detail: null,
  });
  const { data } = await admin.from('notification_events').select('status, sent_at').eq('dedupe_key', KEY).maybeSingle();
  report('livd_settle_notification records the outcome', !error && data?.status === 'sent' && Boolean(data?.sent_at), data?.status ?? '');
}

{
  // A real account, so the join to auth.users is exercised.
  const { data: someone } = await admin.from('profiles').select('id').limit(1).maybeSingle();
  const { data, error } = await admin.rpc('livd_notification_recipient', { target_user: someone.id });
  const row = Array.isArray(data) ? data[0] : data;
  const shaped = row
    && typeof row.user_id === 'string'
    && typeof row.email === 'string' && row.email.includes('@')
    && typeof row.email_review_updates === 'boolean'
    && typeof row.email_property_responses === 'boolean'
    && typeof row.email_trust_safety === 'boolean';
  report('livd_notification_recipient returns the shape the mapper reads', !error && shaped, error?.message ?? Object.keys(row ?? {}).join(','));
}

{
  const { data, error } = await admin.rpc('livd_notification_staff', { min_rank: 1 });
  const rows = data ?? [];
  const shaped = rows.length > 0 && rows.every((r) => r.user_id && r.email?.includes('@') && r.role);
  report('livd_notification_staff returns moderators and above', !error && shaped, `${rows.length} recipient(s): ${rows.map((r) => r.role).join(', ')}`);
}

{
  const { data } = await admin.rpc('livd_notification_staff', { min_rank: 3 });
  const { data: all } = await admin.rpc('livd_notification_staff', { min_rank: 1 });
  report('  … and fewer at a higher rank', (data ?? []).length <= (all ?? []).length, `${(data ?? []).length} admin vs ${(all ?? []).length} moderator+`);
}

console.log('\n=== The read that was returning 400 in production ===\n');

{
  // The exact select listPublicReviews now issues, as the anon key.
  const { data: review } = await anon.from('reviews').select('id').eq('status', 'published').limit(1).maybeSingle();
  const { data, error } = await anon
    .from('owner_responses')
    .select('id, review_id, body, is_resolution_notice, respondent_role, created_at')
    .in('review_id', [review.id])
    .eq('status', 'published');
  report('owner_responses select succeeds as anon', !error, error?.message ?? `${(data ?? []).length} row(s)`);
}

{
  // The shape it replaced, to show the failure was real and is gone.
  const { error } = await anon
    .from('owner_responses')
    .select('id, property_claims!inner(role_claimed)')
    .limit(1);
  report('  … and the old embed still fails, as it always did', Boolean(error), error?.code ?? 'no error');
}

{
  const { data, error } = await admin.from('owner_responses').select('respondent_role').limit(1);
  report('respondent_role column exists and is selectable', !error, error?.message ?? `${(data ?? []).length} row(s)`);
}

console.log('\n=== Cleanup ===\n');
{
  const { error } = await admin.from('notification_events').delete().eq('dedupe_key', KEY);
  const { count } = await admin.from('notification_events').select('*', { count: 'exact', head: true });
  report('self-test ledger row removed', !error, `${count} row(s) remain`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exitCode = fail === 0 ? 0 : 1;
