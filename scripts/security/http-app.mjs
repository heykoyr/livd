/**
 * The deployed application over HTTP.
 *
 * Same question as the PostgREST suite, one layer up: what does an anonymous
 * visitor get from the origin the public actually types in.
 */

const BASE = process.env.LIVD_BASE_URL ?? 'https://livd-psi.vercel.app';

let pass = 0;
let fail = 0;

function report(label, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`);
}

console.log('\n=== 1 · Security headers ===\n');

const res = await fetch(BASE + '/', { redirect: 'manual' });
const h = res.headers;

const EXPECTED = [
  ['content-security-policy', /default-src|script-src/],
  ['strict-transport-security', /max-age=\d{7,}/],
  ['x-frame-options', /DENY|SAMEORIGIN/i],
  ['referrer-policy', /strict-origin/],
  ['permissions-policy', /.+/],
  ['x-content-type-options', /nosniff/],
];

for (const [name, pattern] of EXPECTED) {
  const value = h.get(name);
  report(name, Boolean(value) && pattern.test(value), (value ?? 'ABSENT').slice(0, 74));
}

{
  const csp = h.get('content-security-policy') ?? '';
  report(
    "CSP has no 'unsafe-eval'",
    !/unsafe-eval/.test(csp),
    /unsafe-eval/.test(csp) ? 'present' : 'absent',
  );
  report(
    'CSP restricts frame-ancestors',
    /frame-ancestors/.test(csp),
    (csp.match(/frame-ancestors[^;]*/) ?? ['absent'])[0],
  );
}

console.log('\n=== 2 · Is the new code live? ===\n');

{
  // 0040 removed author_id from REVIEW_SELECT. If the deployment predates that
  // change, the anon query now fails and the page degrades.
  const page = await fetch(BASE + '/');
  const home = await page.text();
  const slug = (home.match(/\/property\/([a-z0-9-]+)/) ?? [])[1];

  const r = await fetch(`${BASE}/property/${slug}`);
  const body = await r.text();

  report('property page renders', r.status === 200 && body.length > 50_000, `${r.status}, ${body.length} bytes`);
  report('no permission-denied in the HTML', !/permission denied/i.test(body));
  report('no author_id anywhere in the HTML', !/author_?id/i.test(body));

  // Every uuid on the page should be a review or the property, never an account.
  const ids = [...new Set(body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])];
  console.log(`     ${ids.length} distinct uuids on /property/${slug}`);
  globalThis.__ids = ids;

  report('reviews actually rendered', /resident experiences|Lived here|Livd Score/i.test(body));
}

console.log('\n=== 3 · Gated routes, anonymously ===\n');

for (const path of ['/admin', '/admin/audit', '/admin/users', '/admin/cases', '/admin/authority-requests', '/account', '/review', '/shortlist']) {
  const r = await fetch(BASE + path, { redirect: 'manual' });
  const location = r.headers.get('location') ?? '';
  const redirected = r.status >= 300 && r.status < 400;
  const body = redirected ? '' : await r.text();

  const leaks = /Trust & Safety|Audit trail|Authority requests|moderation queue/i.test(body);

  report(
    path,
    redirected && !leaks,
    redirected ? `${r.status} → ${location.replace(BASE, '')}` : `${r.status} SERVED CONTENT`,
  );
}

console.log('\n=== 4 · Public API route ===\n');

{
  const r = await fetch(BASE + '/api/suggest?q=lon');
  const j = await r.json();
  const text = JSON.stringify(j);
  report('/api/suggest responds', r.status === 200, `${r.status}`);
  report('suggest carries no account id', !/author|user_?id|email/i.test(text));

  // A search term that would be a problem if it reached SQL unescaped.
  const hostile = await fetch(BASE + "/api/suggest?q=" + encodeURIComponent("') or 1=1--"));
  report('hostile search term handled', hostile.status < 500, `${hostile.status}`);
}

console.log('\n=== 5 · Server Actions, unauthenticated ===\n');

{
  // Next.js Server Actions are POSTs to a route carrying a Next-Action id.
  // Without a valid id this should be refused rather than executed.
  const r = await fetch(BASE + '/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Next-Action': 'deadbeef' },
    body: '[]',
    redirect: 'manual',
  });
  report('POST with a forged Next-Action id', r.status >= 300, `${r.status}`);
}

console.log('\n=== 6 · Miscellany ===\n');

for (const [path, expect] of [['/robots.txt', 200], ['/sitemap.xml', 200], ['/not-found', 200]]) {
  const r = await fetch(BASE + path, { redirect: 'manual' });
  report(path, r.status === expect || r.status === 404, `${r.status}`);
}

{
  const r = await fetch(BASE + '/admin/../admin/users', { redirect: 'manual' });
  report('path traversal normalised', r.status >= 300, `${r.status}`);
}

{
  const r = await fetch(BASE + '/.env', { redirect: 'manual' });
  report('/.env not served', r.status === 404, `${r.status}`);
}

console.log(`\n---\n${pass} passed, ${fail} failed\n`);
console.log('UUIDS_ON_PAGE=' + JSON.stringify(globalThis.__ids ?? []));
