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
import { request as httpRequest } from 'node:http';
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

/**
 * Who is answering on an address that should have been Vercel's.
 *
 * Written after a full day was lost to a DNS record that looked, in the
 * Namecheap UI, exactly as it was supposed to. `www` had published correctly;
 * the apex had not, and the reason was invisible from the DNS layer — a URL
 * Redirect service that had been deleted in the interface but never torn down
 * behind it, still holding the apex and still answering on it.
 *
 * Two signals name the holder, and neither is in DNS:
 *
 *   - the `Server` header. Vercel says `Vercel`. Namecheap's redirect gateway
 *     says `APISIX`, and an `openresty`/`APISIX` pair on a domain that is
 *     supposed to be on Vercel is that service and nothing else.
 *   - a redirect whose `Location` is the request's own URL. Nothing
 *     legitimate does that. It is the fingerprint of a redirect record whose
 *     destination has been cleared while the record itself still exists, and
 *     it is why the domain served an infinite loop rather than an obvious
 *     parking page that somebody would have recognised on sight.
 *
 * Best effort. A holder that refuses to answer is reported as unreachable
 * rather than guessed at, and this never throws — a diagnosis that crashes
 * is worse than one that says "could not tell".
 */
async function identifyHolder(ip) {
  try {
    // `node:http` rather than `fetch`, because the address has to be chosen
    // rather than resolved: the point is to interrogate the specific host DNS
    // just named, not whatever the name resolves to on a second lookup. fetch
    // has no way to express that — `Host` is a forbidden header there, and
    // undici ignores a `lookup` option — so this opens the socket at the IP
    // and sets the header by hand, which is the only honest way to ask "who
    // is answering at *this* address for this domain".
    const { headers, server } = await new Promise((resolve, reject) => {
      const request = httpRequest(
        { host: ip, port: 80, path: '/', method: 'GET', headers: { Host: APEX }, timeout: 10_000 },
        (res) => {
          res.resume(); // drain, so the socket closes
          resolve({ headers: res.headers, server: res.headers.server ?? 'unknown' });
        },
      );
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', reject);
      request.end();
    });

    const location = headers.location ?? '';

    const selfReferential =
      location === `https://${APEX}/` || location === `http://${APEX}/`;

    if (/apisix|openresty/i.test(server)) {
      return selfReferential
        ? `held by Namecheap's URL Redirect service (Server: ${server}), redirecting to itself — the record was deleted in the UI but never deprovisioned`
        : `held by Namecheap's URL Redirect service (Server: ${server} → ${location || 'no redirect'})`;
    }

    if (selfReferential) {
      return `redirecting to itself (Server: ${server}) — a redirect record with no destination still owns this name`;
    }

    return `answered by "${server}"${location ? ` → ${location}` : ''}, not Vercel`;
  } catch {
    return 'not a Vercel address, and it did not answer HTTP';
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
    if (matches) {
      pass('DNS · apex A record', `${APEX} → ${got.join(', ')}`);
    } else {
      // "Not a Vercel address" is true and useless. Whoever is holding the
      // apex will answer an HTTP request and name themselves, so ask them —
      // the difference between a parking page, a stale redirect service and
      // somebody else's server is the whole of the diagnosis.
      const holder = await identifyHolder(got[0]);
      fail('DNS · apex A record', `${APEX} → ${got.join(', ')} — ${holder}`);
    }
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

/**
 * The zone's own nameservers, as a resolver.
 *
 * Whether a record *exists* is a question for the servers that publish it, not
 * for a cache. Learned the expensive way: Google Public DNS is anycast, and
 * some of its nodes went on answering NXDOMAIN for `send.livd.site` long after
 * the record was published — a negative answer cached from a lookup made
 * before it existed. Asked through `8.8.8.8`, this check flapped between pass
 * and fail on consecutive runs and called a correctly configured domain
 * "not verified yet".
 *
 * So existence is judged here, and what public resolvers still believe is
 * reported separately, as the propagation fact it is.
 */
async function authoritativeResolver() {
  const ns = await resolver.resolveNs(APEX);
  const addresses = (
    await Promise.all(ns.map((host) => resolver.resolve4(host).catch(() => [])))
  ).flat();

  if (addresses.length === 0) throw new Error(`no address for ${ns.join(', ')}`);

  const authoritative = new Resolver();
  authoritative.setServers(addresses);
  return authoritative;
}

const PUBLIC_RESOLVERS = ['1.1.1.1', '9.9.9.9', '8.8.8.8'];

/**
 * The first answer any one of several resolvers gives, each asked on its own.
 *
 * A `Resolver` given several servers does not try the next one after a
 * negative answer — NXDOMAIN is an answer, not a failure — so one stale cache
 * in the list is enough to fail a lookup every other server would satisfy.
 */
async function firstAnswer(query) {
  let lastError;
  for (const server of PUBLIC_RESOLVERS) {
    const single = new Resolver();
    single.setServers([server]);
    try {
      return await query(single);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Which public resolvers still cannot see a record the zone publishes. */
async function stalePublicCaches(query) {
  const stale = [];
  for (const server of PUBLIC_RESOLVERS) {
    const single = new Resolver();
    single.setServers([server]);
    // Three tries: an anycast address is many caches behind one IP, and one
    // lucky answer would hide the ones that are still wrong.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await query(single);
      } catch {
        stale.push(server);
        break;
      }
    }
  }
  return stale;
}

async function checkEmailDns() {
  let auth;
  try {
    auth = await authoritativeResolver();
  } catch (error) {
    fail('Email · authoritative DNS', `could not reach the zone's nameservers (${error.message})`);
    return;
  }

  const soa = await tryResolve(() => auth.resolveSoa(APEX));
  const negativeTtl = soa.error ? null : soa.minttl;

  /* ---- The apex SPF belongs to the forwarder, and must stay single ---- */

  const txt = await tryResolve(() => auth.resolveTxt(APEX));
  const flat = txt.error ? [] : txt.map((chunks) => chunks.join(''));
  const spf = flat.filter((value) => value.startsWith('v=spf1'));

  // More than one SPF record on a name is not "belt and braces" — receivers
  // are entitled to treat it as a permanent error and fail every message.
  if (spf.length === 0) warn('Email · apex SPF', 'no SPF record on the apex');
  else if (spf.length > 1) fail('Email · apex SPF', `${spf.length} SPF records — must be merged into one`);
  else pass('Email · apex SPF', spf[0]);

  /* ---- Return-path ----------------------------------------------------
   * Whatever shape the provider asks for. Resend issued `send` as a CNAME to a
   * host of its own that carries the MX and the SPF — not the MX-and-TXT pair
   * on `send` itself that an earlier version of this check, and of
   * docs/email.md, assumed without asking. The requirement is the same in
   * either shape: bounces need somewhere to go, and the envelope sender must
   * pass SPF. So check for exactly that, following the delegation to wherever
   * it is published.
   *
   * There are two, and the second is the one in use. Resend published `rsend`
   * as well as `send`, and a real sign-in email sent through Resend's SMTP on
   * 17 September 2026 carried `Return-Path: …@rsend.livd.site` and passed SPF
   * there. `rsend` looks like a duplicate of `send` in a DNS panel, which is
   * exactly why it is the one somebody would tidy away — so its absence
   * blocks, where `send`'s only advises. */

  const RETURN_PATHS = [
    { host: `rsend.${APEX}`, required: true },
    { host: `send.${APEX}`, required: false },
  ];

  for (const { host, required } of RETURN_PATHS) {
    const label = `Email · return-path ${host.split('.')[0]}`;
    const delegated = await tryResolve(() => auth.resolveCname(host));
    const target = delegated.error ? null : delegated[0];

    // A delegated name lives in somebody else's zone, which our nameservers
    // cannot answer for; an undelegated one is ours to ask directly.
    const ask = (fn) =>
      tryResolve(() => (target ? firstAnswer((r) => fn(r, target)) : fn(auth, host)));

    const mx = await ask((r, name) => r.resolveMx(name));
    const txt = await ask((r, name) => r.resolveTxt(name));
    const spfRecord = txt.error
      ? null
      : txt.map((chunks) => chunks.join('')).find((value) => value.startsWith('v=spf1'));

    const via = target ? `${host} → ${target}` : host;

    if (mx.error && !spfRecord) {
      const message = `nothing published at ${via} — add the records Resend gives you`;
      if (required) fail(label, `${message}; live mail uses this envelope sender`);
      else warn(label, message);
    } else if (mx.error) {
      fail(label, `${via} has SPF but no MX — bounces have nowhere to go`);
    } else if (!spfRecord) {
      fail(label, `${via} has an MX but no SPF — the envelope sender will not authenticate`);
    } else {
      pass(label, `${via} · MX ${mx.map((m) => m.exchange).join(', ')} · SPF present`);

      const stale = await stalePublicCaches((r) => r.resolveTxt(host));
      if (stale.length > 0) {
        warn(
          `${label} propagation`,
          `published, but ${stale.join(', ')} still answer${stale.length === 1 ? 's' : ''} from a cache made before it existed` +
            (negativeTtl ? ` — clears within ${negativeTtl}s` : ''),
        );
      }
    }
  }

  /* ---- DKIM ----------------------------------------------------------- */

  const dkim = await tryResolve(() => auth.resolveTxt(`resend._domainkey.${APEX}`));
  if (dkim.error) {
    warn('Email · DKIM', `no key at resend._domainkey.${APEX}`);
  } else {
    const value = dkim.map((chunks) => chunks.join('')).join('');
    const key = value.match(/(?:^|;\s*)p=([A-Za-z0-9+/=]+)/)?.[1];
    // A pasted value that lost characters publishes happily and fails every
    // signature, so the length is worth a look and not just the presence.
    if (!key) fail('Email · DKIM', `resend._domainkey.${APEX} has no p= public key`);
    else if (key.length < 200) fail('Email · DKIM', `public key is ${key.length} chars — likely truncated`);
    else pass('Email · DKIM', `public key published (${key.length} chars)`);
  }

  /* ---- DMARC ---------------------------------------------------------- */

  const dmarc = await tryResolve(() => auth.resolveTxt(`_dmarc.${APEX}`));
  if (dmarc.error) {
    warn('Email · DMARC', `no policy at _dmarc.${APEX}`);
  } else {
    const records = dmarc.map((chunks) => chunks.join('')).filter((v) => v.startsWith('v=DMARC1'));
    const policy = records[0] ?? '';
    const p = policy.match(/(?:^|;\s*)p=(none|quarantine|reject)/)?.[1];

    if (records.length > 1) {
      fail('Email · DMARC', `${records.length} DMARC records — receivers ignore all of them`);
    } else if (!p) {
      fail('Email · DMARC', `"${policy}" has no valid p= tag`);
    } else {
      pass('Email · DMARC', policy);
      // Not wrong, and harmless. But p=none exists to gather evidence before
      // enforcing, and without rua the evidence goes nowhere — so there is
      // never a basis on which to move off p=none.
      if (!/(?:^|;\s*)rua=mailto:/.test(policy)) {
        warn('Email · DMARC reports', `p=${p} with no rua= — monitoring that reports to nobody`);
      }
    }
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
    warn(
      'Resend · domain verified',
      'no RESEND_API_KEY here — pass one inline to ask Resend, or see resend.com/domains',
    );
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));

    // A sending-only key cannot list domains, and a sending-only key is the
    // right kind to deploy. Refusing here is the key doing its job.
    if (response.status === 401 || response.status === 403) {
      warn(
        'Resend · domain verified',
        `this key cannot read domains (${body.name ?? response.status}) — expected of a sending-only key`,
      );
      return;
    }

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
