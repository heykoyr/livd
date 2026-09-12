import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

/**
 * Accessibility audit against the real server-rendered pages.
 *
 * Runs axe-core over the HTML the application actually serves, rather than over
 * components in isolation — most real violations come from how pages compose,
 * not from a primitive in a test harness.
 *
 * Colour-contrast rules are skipped, and this is a real limit rather than a
 * preference: jsdom computes no layout and resolves no CSS custom properties,
 * so every colour reads as a keyword axe cannot compare. Trusting this script
 * for contrast is how six tokens stayed below 4.5:1 from the day the palette
 * was written until someone ran axe in a browser.
 *
 * What covers it now: `tests/design/contrast.test.ts` asserts every token pair
 * the design uses, reading the values straight out of `globals.css`. For a
 * whole-page check, serve `node_modules/axe-core/axe.min.js` from `public/`
 * (the CSP allows `script-src 'self'` and nothing else), load a page with the
 * theme already set so nothing is mid-transition, and run `axe.run(document)`
 * in the console.
 *
 * Usage: node scripts/audit-a11y.mjs [baseUrl]
 *
 * AUTHENTICATED PAGES
 *
 * The admin console and the account area are behind a guard, so an
 * unauthenticated fetch gets a 307 and the audit silently passes an empty
 * page. That is how the console went unaudited until Phase 20 — it is the
 * part of the product a moderator uses all day, and it had never been run
 * through axe once.
 *
 * Set `LIVD_AUDIT_COOKIE` to a session cookie and the gated pages are
 * included. Against the local adapter the cookie is `<user id>.<hmac>`; the
 * signing secret is `LIVD_SESSION_SECRET`:
 *
 *   node -e "const{createHmac}=require('crypto');const id='user-xxxx';
 *     console.log('livd_session='+id+'.'+createHmac('sha256',
 *     process.env.LIVD_SESSION_SECRET).update(id).digest('base64url'))"
 *
 * Without it, those pages are skipped and said to be skipped rather than
 * reported as passing.
 */

const BASE = process.argv[2] ?? 'http://localhost:3000';
const COOKIE = process.env.LIVD_AUDIT_COOKIE ?? null;

const PAGES = [
  ['Landing', '/'],
  ['Search results', '/search?q=lagos'],
  ['Search, no results', '/search?q=zzzznotathing'],
  ['Property profile', '/property/admiralty-heights-lagos'],
  ['Property, unreviewed', '/property/ballard-yard-seattle'],
  ['Explore', '/places'],
  ['Places index', '/places/all'],
  ['Country', '/places/ng'],
  ['Locality', '/places/ng/lagos'],
  ['Neighbourhood', '/places/ng/lagos/lekki%20phase%201'],
  ['Sign in', '/sign-in'],
  ['How it works', '/how-it-works'],
  ['Trust & safety', '/trust'],
  ['For owners', '/for-owners'],
  ['Privacy', '/legal/privacy'],
  ['Not found', '/property/does-not-exist'],
];

/** Everything behind `requireUserPage` or `requireRolePage`. */
const GATED_PAGES = [
  ['Account', '/account'],
  ['My reviews', '/account/reviews'],
  ['Email preferences', '/account/notifications'],
  ['Shortlist', '/shortlist'],
  ['Review wizard', '/review'],
  ['Admin dashboard', '/admin'],
  ['Admin cases', '/admin/cases'],
  ['Admin moderation queue', '/admin/queue'],
  ['Admin reports', '/admin/reports'],
  ['Admin signals', '/admin/flags'],
  ['Admin residency proof', '/admin/verification'],
  ['Admin location checks', '/admin/verification-attempts'],
  ['Admin property claims', '/admin/claims'],
  ['Admin audit trail', '/admin/audit'],
  ['Admin authority requests', '/admin/authority-requests'],
  ['Admin users', '/admin/users'],
  ['Admin sanctions', '/admin/sanctions'],
];

// Public pages are audited as a signed-out visitor actually sees them —
// passing the cookie to /sign-in only gets a redirect, and the landing page
// renders different chrome when somebody is logged in.
const ALL = [
  ...PAGES.map(([name, path]) => [name, path, false]),
  ...(COOKIE ? GATED_PAGES.map(([name, path]) => [name, path, true]) : []),
];

const axeSource = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

let totalViolations = 0;
let skipped = 0;
const failures = [];

for (const [name, path, authenticated] of ALL) {
  const response = await fetch(`${BASE}${path}`, {
    headers: authenticated && COOKIE ? { cookie: COOKIE } : {},
    redirect: 'manual',
  });

  // A redirect means the guard turned us away. Reporting that as "ok" is
  // what made the console look audited when nothing had been read.
  if (response.status >= 300 && response.status < 400) {
    console.log(`  SKIP  ${name}  (redirected — not signed in?)`);
    skipped += 1;
    continue;
  }

  const html = await response.text();

  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: `${BASE}${path}`,
    virtualConsole,
  });

  dom.window.eval(axeSource);

  const results = await dom.window.axe.run(dom.window.document, {
    resultTypes: ['violations'],
    rules: {
      // Not evaluable without layout and computed CSS variables.
      'color-contrast': { enabled: false },
      // Next injects its own inert markup into the document shell.
      'aria-allowed-role': { enabled: true },
    },
  });

  const violations = results.violations.filter((v) => v.impact !== 'minor' || v.nodes.length > 0);

  if (violations.length === 0) {
    console.log(`  ok    ${name}`);
  } else {
    totalViolations += violations.length;
    console.log(`  FAIL  ${name}  (${violations.length})`);
    for (const violation of violations) {
      console.log(`          [${violation.impact}] ${violation.id}: ${violation.help}`);
      for (const node of violation.nodes.slice(0, 3)) {
        console.log(`            ${node.html.slice(0, 140)}`);
      }
      failures.push(`${name}: ${violation.id}`);
    }
  }

  dom.window.close();
}

console.log('');

if (!COOKIE) {
  console.log(
    `${GATED_PAGES.length} authenticated pages were not audited. Set LIVD_AUDIT_COOKIE to include them.`,
  );
}

if (totalViolations === 0) {
  console.log(`No axe violations across ${ALL.length - skipped} pages.`);
} else {
  console.log(`${totalViolations} violation type(s) across ${ALL.length - skipped} pages.`);
  process.exitCode = 1;
}
