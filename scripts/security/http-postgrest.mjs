/**
 * Phase 13, part 8 — the part that could not be run before.
 *
 * Every earlier authorisation test set `role` and `request.jwt.claims` inside
 * the database, which is the path a request takes *after* PostgREST has routed
 * it. This one goes over HTTP, as an anonymous visitor holding nothing but the
 * publishable key that ships in the browser bundle.
 */

import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1).trim().replace(/^"|"$/g, '')];
    }),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

let pass = 0;
let fail = 0;

function report(label, ok, detail) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(62)} ${detail}`);
}

async function get(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

console.log('\n=== 1 · Anonymous table reads over HTTP ===\n');

const TABLES = [
  'profiles', 'reviews', 'properties', 'review_reports', 'property_claims',
  'verification_records', 'property_verifications', 'moderation_actions',
  'admin_audit_log', 'ts_cases', 'case_events', 'case_notes', 'case_evidence',
  'review_snapshots', 'user_sanctions', 'authority_requests',
  'disclosure_records', 'account_signals', 'property_flags',
  'rate_limit_events', 'owner_responses', 'saved_properties',
  'identity_access_reasons', 'sanction_reason_defs', 'case_category_defs',
];

const PUBLIC_BY_DESIGN = new Set(['reviews', 'properties']);

for (const table of TABLES) {
  const { status, body } = await get(`${table}?select=id&limit=3`);
  const rows = Array.isArray(body) ? body.length : null;
  const leaked = rows !== null && rows > 0;

  if (PUBLIC_BY_DESIGN.has(table)) {
    report(`${table} (public by design)`, leaked, `${status}, ${rows} rows`);
  } else {
    report(
      table,
      !leaked,
      `${status}, ${rows === null ? (body.message ?? 'no rows') : `${rows} rows`}`,
    );
  }
}

console.log('\n=== 2 · The author pseudonym, over HTTP ===\n');

{
  const r = await get('reviews?select=author_id&limit=5');
  report(
    'GET reviews?select=author_id',
    r.status === 403 || r.status === 401,
    `${r.status} ${r.body?.message ?? ''}`,
  );
}
{
  const r = await get('reviews?select=*&limit=1');
  report(
    'GET reviews?select=*',
    r.status === 403 || r.status === 401,
    `${r.status} ${r.body?.message ?? ''}`,
  );
}
{
  const r = await get(
    'reviews?select=id,body,overall_rating,verification_level,tenure_months&limit=3',
  );
  report(
    'GET reviews, the public columns (must still work)',
    r.status === 200 && Array.isArray(r.body) && r.body.length === 3,
    `${r.status}, ${Array.isArray(r.body) ? r.body.length : 0} rows`,
  );
}
{
  // The embedded side-tables the property page needs, through the API.
  const r = await get(
    'reviews?select=id,review_category_ratings(category_key,rating),review_tags(tag_key)&limit=2',
  );
  const embedded =
    Array.isArray(r.body) && r.body[0] && Array.isArray(r.body[0].review_category_ratings);
  report('GET reviews with embedded side-tables', r.status === 200 && embedded, `${r.status}`);
}
{
  // Ordering by a column you cannot read is another way to ask for it.
  const r = await get('reviews?select=id&order=author_id.asc&limit=1');
  report(
    'ORDER BY author_id (reading it sideways)',
    r.status !== 200,
    `${r.status} ${r.body?.message ?? ''}`,
  );
}
{
  // So is filtering on it: a binary search over `author_id=eq.<uuid>` would
  // recover the value one comparison at a time if it were permitted.
  const r = await get('reviews?select=id&author_id=eq.00000000-0000-0000-0000-000000000000');
  report(
    'FILTER on author_id (binary-search recovery)',
    r.status !== 200,
    `${r.status} ${r.body?.message ?? ''}`,
  );
}

console.log('\n=== 3 · Privileged RPCs, called anonymously ===\n');

const RPCS = [
  ['livd_set_user_role', { target_user_id: '00000000-0000-0000-0000-000000000000', new_role: 'admin', change_reason: 'x' }],
  ['livd_set_user_status', { target_user_id: '00000000-0000-0000-0000-000000000000', new_status: 'active', change_reason: 'x' }],
  ['livd_reveal_user_identity', { target_user_id: '00000000-0000-0000-0000-000000000000', reason_key: 'serious_abuse' }],
  ['livd_admin_user_directory', { page_size: 5, page_offset: 0 }],
  ['livd_admin_find_user_by_email', { lookup_email: 'someone@example.test' }],
  ['livd_admin_audit_feed', { page_size: 5 }],
  ['livd_admin_audit_log', { page_size: 5 }],
  ['livd_admin_attention', {}],
  ['livd_list_cases', { page_size: 5 }],
  ['livd_list_account_signals', { filter_status: 'open' }],
  ['livd_list_authority_requests', {}],
  ['livd_list_disclosures', {}],
  ['livd_list_sanctions', {}],
  ['livd_my_sanctions', {}],
  ['livd_record_admin_audit', { audit_action: 'forged', subject_type: 'user' }],
  ['livd_open_case', { case_category: 'spam', case_summary: 'forged' }],
  ['livd_apply_sanction', { target_user_id: '00000000-0000-0000-0000-000000000000', sanction_action: 'banned', reason_key: 'spam', sanction_reason: 'x' }],
  ['livd_set_review_status', { target_review: '00000000-0000-0000-0000-000000000000', new_status: 'removed', why: 'forged' }],
  ['livd_detect_property_flags', {}],
  ['livd_detect_account_signals', {}],
  ['livd_raise_account_signal', {}],
  ['livd_mask_email', { email: 'someone@example.test' }],
  ['livd_guard_self_report', {}],
];

for (const [name, args] of RPCS) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  // 200 is the only failing outcome: anything else is a refusal of some kind.
  report(
    `POST rpc/${name}`,
    res.status !== 200,
    `${res.status} ${(body?.message ?? String(body)).slice(0, 66)}`,
  );
}

console.log('\n=== 4 · Anonymous writes ===\n');

const WRITES = [
  ['POST', 'profiles', { role: 'admin' }],
  ['POST', 'reviews', { property_id: '00000000-0000-0000-0000-000000000000', overall_rating: 5 }],
  ['POST', 'admin_audit_log', { action: 'forged', subject_type: 'user' }],
  ['POST', 'moderation_actions', { action: 'forged', subject_type: 'user', subject_id: '00000000-0000-0000-0000-000000000000' }],
  ['POST', 'account_signals', { user_id: '00000000-0000-0000-0000-000000000000', kind: 'author_spread', severity: 1, window_start: 'now()', window_end: 'now()', detail: 'x' }],
];

for (const [method, table, payload] of WRITES) {
  const res = await fetch(`${URL_}/rest/v1/${table}`, {
    method,
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  report(`${method} ${table}`, res.status >= 400, `${res.status} ${text.slice(0, 60)}`);
}

{
  const res = await fetch(`${URL_}/rest/v1/profiles?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'PATCH',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ role: 'admin' }),
  });
  const text = await res.text();
  const changed = text !== '[]' && !text.startsWith('{"code');
  report('PATCH profiles set role=admin (the P0 attack, over HTTP)', !changed, `${res.status} ${text.slice(0, 60)}`);
}

{
  const res = await fetch(`${URL_}/rest/v1/admin_audit_log?id=gt.0`, {
    method: 'DELETE',
    headers: { ...H, Prefer: 'return=representation' },
  });
  const text = await res.text();
  report('DELETE admin_audit_log', res.status >= 400 || text === '[]', `${res.status} ${text.slice(0, 60)}`);
}

console.log('\n=== 5 · What the API exposes at all ===\n');

{
  const res = await fetch(`${URL_}/rest/v1/`, { headers: H });
  const spec = await res.json();
  const paths = Object.keys(spec.paths ?? {}).filter((p) => p !== '/');
  const tables = paths.filter((p) => !p.startsWith('/rpc/'));
  const rpcs = paths.filter((p) => p.startsWith('/rpc/'));

  console.log(`     OpenAPI: ${tables.length} tables, ${rpcs.length} RPCs exposed`);

  // A table the spec does not name cannot be reached by name either.
  report(
    'auth schema is not exposed',
    !paths.some((p) => /users|identities|sessions/.test(p)),
    paths.filter((p) => /users|identities|sessions/.test(p)).join(',') || 'absent',
  );

  const r = await get('users?select=id&limit=1');
  report('GET auth users via REST', r.status !== 200, `${r.status} ${r.body?.message ?? ''}`);
}

{
  const res = await fetch(`${URL_}/rest/v1/reviews?select=id&limit=1`, {
    headers: { ...H, 'Accept-Profile': 'auth' },
  });
  const text = await res.text();
  report('Accept-Profile: auth (schema switch)', res.status !== 200, `${res.status} ${text.slice(0, 60)}`);
}

console.log('\n=== 6 · Without a key at all ===\n');

for (const path of ['reviews?select=id&limit=1', 'properties?select=id&limit=1']) {
  const res = await fetch(`${URL_}/rest/v1/${path}`);
  const text = await res.text();
  report(`no apikey: ${path.split('?')[0]}`, res.status >= 400, `${res.status} ${text.slice(0, 50)}`);
}

console.log(`\n---\n${pass} passed, ${fail} failed\n`);
