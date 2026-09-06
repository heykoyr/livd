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
 */

const BASE = process.argv[2] ?? 'http://localhost:3000';

const PAGES = [
  ['Landing', '/'],
  ['Search results', '/search?q=lagos'],
  ['Search, no results', '/search?q=zzzznotathing'],
  ['Property profile', '/property/admiralty-heights-lagos'],
  ['Property, unreviewed', '/property/ballard-yard-seattle'],
  ['Places index', '/places'],
  ['Locality', '/places/ng/lagos'],
  ['Sign in', '/sign-in'],
  ['How it works', '/how-it-works'],
  ['Trust & safety', '/trust'],
  ['For owners', '/for-owners'],
  ['Privacy', '/legal/privacy'],
  ['Not found', '/property/does-not-exist'],
];

const axeSource = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

let totalViolations = 0;
const failures = [];

for (const [name, path] of PAGES) {
  const response = await fetch(`${BASE}${path}`);
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
if (totalViolations === 0) {
  console.log(`No axe violations across ${PAGES.length} pages.`);
} else {
  console.log(`${totalViolations} violation type(s) across ${PAGES.length} pages.`);
  process.exitCode = 1;
}
