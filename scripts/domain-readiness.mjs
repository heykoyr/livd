#!/usr/bin/env node
/**
 * Is livd.site actually finished?
 *
 * A domain migration is not one change, it is eight, spread across four
 * services that cannot see each other — Namecheap holds the DNS, Vercel holds
 * the certificate and the redirect, Supabase holds the redirect allow-list,
 * and Resend holds the sending identity. Each reports only its own half, and
 * the failure mode when two of them disagree is silent: Supabase does not
 * error on a redirect it will not honour, it substitutes its own Site URL, and
 * the person signing in lands on the wrong host with no error anywhere.
 *
 * So this asks all four, from outside, and prints one table.
 *
 *   node scripts/domain-readiness.mjs
 *   node scripts/domain-readiness.mjs --json
 *
 * It changes nothing. It reads `.env.local` for the Supabase anon key (a
 * public value) and, if `RESEND_API_KEY` is present, asks Resend whether the
 * sending domain is verified. Everything else is public DNS and plain HTTP.
 *
 * Exit code 0 when every REQUIRED check passes, 1 otherwise, so it can gate a
 * deploy. Checks marked "advisory" never fail the run: DMARC reporting and a
 * configured mail provider are good practice, not preconditions for the site
 * being correct.
 */

import { readFileSync } from 'node:fs';
import { Resolver } from 'node:dns/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const APEX = 'livd.site';
const CANONICAL = `https://${APEX}`;
const WWW = `www.${APEX}`;

/**
 * What Vercel asked for, for this project, on 16 September 2026.
 *
 * Read out of `vercel domains verify livd.site` rather than from Vercel's
 * documentation: the generic `76.76.21.21` the docs give is Vercel's rank-2
 * answer, and the project-specific pair below is rank 1. Either resolves, so
 * the check accepts both rather than insisting on the one this was written
 * against — a future re-issue should not read as a broken domain.
 */
const VERCEL_APEX_IPS = [
  ['216.198.79.1', '64.29.17.1'],
  ['76.76.21.21'],
];
const VERCEL_CNAME_SUFFIXES = ['.vercel-dns.com', '.vercel-dns-017.com'];

/**
 * Namecheap's free email forwarding, which is what makes `support@livd.site`
 * reach a person. It predates this migration and must survive it — replacing
 * the apex A record is the moment it is easiest to delete by accident.
 */
const FORWARDER_MX = 'registrar-servers.com';

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

const resolver = new Resolver();
// A public resolver rather than the machine's own, so a stale local cache
// cannot report a record that the rest of the world does not see yet.
resolver.setServers(['8.8.8.8', '1.1.1.1']);

const results = [];

function record(name, status, detail, { advisory = false } = {}) {
  results.push({ name, status, detail, advisory });
}

const pass = (name, detail) => record(name, 'pass', detail);
const fail = (name, detail, opts) => record(name, 'fail', detail, opts);
const warn = (name, detail) => record(name, 'fail', detail, { advisory: true });

async function tryResolve(fn) {
  try {
    return await fn();
  } catch (error) {
    return { error: error.code ?? error.message };
  }
}

function env(key) {
  try {
    const file = readFileSync(join(ROOT, '.env.local'), 'utf8').replace(/^\uFEFF/, '');
    const line = file.split('\n').find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim().replace(/^"|"$/g, '') : process.env[key];
  } catch {
    return process.env[key];
  }
}

/* ------------------------------------------------------------------ *
 * 1. DNS — does the domain point at Vercel, without losing the mail?
 * ------------------------------------------------------------------ */

async function checkDns() {
  const a = await tryResolve(() => resolver.resolve4(APEX));

  if (a.error) {
    fail('DNS · apex A record', `${APEX} does not resolve (${a.error})`);
  } else {
    const got = [...a].sort();
    const matches = VERCEL_APEX_IPS.some(
      (set) => set.length === got.length && [...set].sort().every((ip, i) => ip === got[i]),
    );
    if (matches) pass('DNS · apex A record', `${APEX} → ${got.join(', ')}`);
    else fail('DNS · apex A record', `${APEX} → ${got.join(', ')} — not a Vercel address`);
  }

  const cname = await tryResolve(() => resolver.resolveCname(WWW));
  if (cname.error) {
    fail('DNS · www CNAME', `${WWW} has no CNAME (${cname.error})`);
  } else if (VERCEL_CNAME_SUFFIXES.some((suffix) => cname.some((v) => v.endsWith(suffix)))) {
    pass('DNS · www CNAME', `${WWW} → ${cname.join(', ')}`);
  } else {
    fail('DNS · www CNAME', `${WWW} → ${cname.join(', ')} — not a Vercel target`);
  }

  // The one that gets deleted by accident.
  const mx = await tryResolve(() => resolver.resolveMx(APEX));
  if (mx.error) {
    fail('DNS · MX preserved', `no MX on ${APEX} — email forwarding is gone (${mx.error})`);
  } else if (mx.some((entry) => entry.exchange.includes(FORWARDER_MX))) {
    pass('DNS · MX preserved', `${mx.length} forwarder records intact`);
  } else {
    fail('DNS · MX preserved', `MX present but not Namecheap's: ${mx.map((m) => m.exchange).join(', ')}`);
  }
}

/* ------------------------------------------------------------------ *
 * 2. Email authentication
 * ------------------------------------------------------------------ */

async function checkEmailDns() {
  const txt = await tryResolve(() => resolver.resolveTxt(APEX));
  const flat = txt.error ? [] : txt.map((chunks) => chunks.join(''));
  const spf = flat.filter((value) => value.startsWith('v=spf1'));

  // More than one SPF record on a name is not "belt and braces" — receivers
  // are entitled to treat it as a permanent error and fail every message.
  if (spf.length === 0) warn('Email · apex SPF', 'no SPF record on the apex');
  else if (spf.length > 1) fail('Email · apex SPF', `${spf.length} SPF records — must be merged into one`);
  else pass('Email · apex SPF', spf[0]);

  // Resend signs with the sending subdomain's own SPF, so the apex record
  // above belongs to the forwarder and the two never collide.
  const sendSpf = await tryResolve(() => resolver.resolveTxt(`send.${APEX}`));
  if (sendSpf.error) warn('Email · Resend return-path', `no TXT on send.${APEX} — Resend domain not verified yet`);
  else pass('Email · Resend return-path', sendSpf.map((c) => c.join('')).join(' | '));

  const dkim = await tryResolve(() => resolver.resolveTxt(`resend._domainkey.${APEX}`));
  if (dkim.error) warn('Email · DKIM', `no key at resend._domainkey.${APEX}`);
  else pass('Email · DKIM', `published (${dkim.map((c) => c.join('')).join('').length} chars)`);

  const dmarc = await tryResolve(() => resolver.resolveTxt(`_dmarc.${APEX}`));
  if (dmarc.error) {
    warn('Email · DMARC', `no policy at _dmarc.${APEX}`);
  } else {
    const policy = dmarc.map((c) => c.join('')).join('');
    pass('Email · DMARC', policy);
  }
}

/* ------------------------------------------------------------------ *
 * 3. The site itself
 * ------------------------------------------------------------------ */

async function checkSite() {
  let home;
  try {
    home = await fetch(CANONICAL, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    fail('Site · HTTPS', `${CANONICAL} did not respond (${error.message})`);
    return;
  }

  if (home.status >= 200 && home.status < 300) {
    pass('Site · HTTPS', `${CANONICAL} → ${home.status}, valid certificate`);
  } else if (home.status >= 300 && home.status < 400) {
    fail('Site · HTTPS', `${CANONICAL} → ${home.status} to ${home.headers.get('location')} — the canonical host must not redirect`);
  } else {
    fail('Site · HTTPS', `${CANONICAL} → ${home.status}`);
  }

  // The canonical tag is what a crawler believes, and it is generated from
  // NEXT_PUBLIC_SITE_URL. If the environment variable was never flipped, this
  // is where it shows: the page serves from livd.site and claims to be
  // somewhere else.
  try {
    const body = await home.text();
    const canonical = body.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/)?.[1]
      ?? body.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/)?.[1];

    if (!canonical) warn('Site · canonical URL', 'no canonical or og:url on the home page');
    else if (canonical.startsWith(CANONICAL)) pass('Site · canonical URL', canonical);
    else fail('Site · canonical URL', `page claims ${canonical} — NEXT_PUBLIC_SITE_URL is still wrong`);
  } catch {
    warn('Site · canonical URL', 'could not read the home page body');
  }

  try {
    const www = await fetch(`https://${WWW}`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const location = www.headers.get('location') ?? '';

    if (www.status === 308 && location.startsWith(CANONICAL)) {
      pass('Site · www redirect', `308 → ${location}`);
    } else if (www.status >= 300 && www.status < 400 && location.startsWith(CANONICAL)) {
      pass('Site · www redirect', `${www.status} → ${location}`);
    } else {
      fail('Site · www redirect', `https://${WWW} → ${www.status} ${location || '(no Location)'} — must redirect to the apex`);
    }
  } catch (error) {
    fail('Site · www redirect', `https://${WWW} did not respond (${error.message})`);
  }

  try {
    const robots = await fetch(`${CANONICAL}/robots.txt`, { signal: AbortSignal.timeout(15_000) });
    const body = await robots.text();
    if (body.includes(`${CANONICAL}/sitemap.xml`)) pass('Site · robots.txt', 'sitemap on the canonical host');
    else fail('Site · robots.txt', `sitemap line does not name ${CANONICAL}`);
  } catch (error) {
    warn('Site · robots.txt', `could not be read (${error.message})`);
  }
}

/* ------------------------------------------------------------------ *
 * 4. Supabase Auth — the one that fails silently
 * ------------------------------------------------------------------ */

async function checkAuth() {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const anon = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  if (!url || !anon) {
    warn('Auth · Supabase reachable', 'no Supabase URL/anon key in .env.local — skipped');
    return;
  }

  /**
   * GoTrue validates `redirect_to` against the allow list *before* it decides
   * the token is rubbish, so a throwaway token is enough to learn whether a
   * host is allowed. Whatever it falls back to is the configured Site URL.
   */
  async function probe(target) {
    const endpoint = `${url}/auth/v1/verify?token=probe&type=magiclink&redirect_to=${encodeURIComponent(target)}`;
    const response = await fetch(endpoint, {
      headers: { apikey: anon },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    return response.headers.get('location') ?? '';
  }

  try {
    const siteUrl = await probe('https://not-allowed.example/x');
    if (siteUrl.startsWith(CANONICAL)) pass('Auth · Supabase Site URL', CANONICAL);
    else fail('Auth · Supabase Site URL', `${siteUrl.split('#')[0] || '(none)'} — must be ${CANONICAL}`);

    const callback = `${CANONICAL}/auth/callback`;
    const honoured = await probe(callback);
    if (honoured.startsWith(callback)) pass('Auth · production callback allowed', callback);
    else fail('Auth · production callback allowed', `${callback} is not on the Redirect URLs list — Supabase substituted ${honoured.split('#')[0]}`);

    // Local development must keep working. Removing it to make production
    // work is a regression, not a cleanup.
    const local = 'http://localhost:3000/auth/callback';
    const localOk = await probe(local);
    if (localOk.startsWith(local)) pass('Auth · localhost still allowed', local);
    else warn('Auth · localhost still allowed', 'development sign-in against Supabase will not redirect back');
  } catch (error) {
    fail('Auth · Supabase reachable', error.message);
  }
}

/* ------------------------------------------------------------------ *
 * 5. Resend
 * ------------------------------------------------------------------ */

async function checkResend() {
  const key = env('RESEND_API_KEY');
  if (!key) {
    warn('Resend · domain verified', 'no RESEND_API_KEY here — cannot ask; check resend.com/domains');
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json();
    const domain = (body.data ?? []).find((entry) => entry.name === APEX);

    if (!domain) fail('Resend · domain verified', `${APEX} is not on the account`);
    else if (domain.status === 'verified') pass('Resend · domain verified', `${APEX} verified (${domain.region})`);
    else fail('Resend · domain verified', `${APEX} status is "${domain.status}"`);
  } catch (error) {
    warn('Resend · domain verified', `could not be checked (${error.message})`);
  }
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

await checkDns();
await checkEmailDns();
await checkSite();
await checkAuth();
await checkResend();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ domain: APEX, checks: results }, null, 2));
} else {
  const width = Math.max(...results.map((r) => r.name.length));
  console.log(`\n  livd.site — production readiness\n`);
  for (const { name, status, detail, advisory } of results) {
    const mark = status === 'pass' ? '✓' : advisory ? '–' : '✗';
    console.log(`  ${mark} ${name.padEnd(width)}  ${detail}`);
  }

  const blocking = results.filter((r) => r.status === 'fail' && !r.advisory);
  const advisories = results.filter((r) => r.status === 'fail' && r.advisory);

  console.log('');
  if (blocking.length === 0) console.log(`  Ready. ${advisories.length} advisory item(s).\n`);
  else console.log(`  ${blocking.length} blocking item(s), ${advisories.length} advisory.\n`);
}

process.exit(results.some((r) => r.status === 'fail' && !r.advisory) ? 1 : 0);
