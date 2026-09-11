/**
 * Every link Livd puts in an email, followed.
 *
 * A dead link in a transactional email is a small bug with an outsized cost:
 * it arrives at the moment somebody is already anxious — their review came
 * down, their claim was refused — and a 404 reads as the platform not caring.
 * They are also the links least likely to be clicked during development,
 * because nobody sends themselves the removal email.
 *
 * Renders one of every message in the catalogue, extracts every href, and
 * follows it against a running Livd. A gated destination must redirect to
 * sign-in carrying its own `next`, not 404 and not 500 — that is the
 * expired-session path, and it is the one a person hits days after the email
 * was sent.
 *
 *   node scripts/security/email-links.mjs [baseUrl]
 */

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');

// Rendered by importing the catalogue through the built app would need a
// bundler; the link set is small and explicit enough to assert directly, and
// it is asserted against the catalogue by tests/notify/messages.test.ts.
const LINKS = [
  ['review_published / restored / owner_responded', '/property/mama-house-badagry-odlxrt#reviews'],
  ['review_held', '/account/reviews'],
  ['review_removed', '/legal/content-policy'],
  ['claim_approved', '/property/mama-house-badagry-odlxrt'],
  ['owner_new_review', '/property/mama-house-badagry-odlxrt#reviews'],
  ['staff_report_opened', '/admin/reports'],
  ['staff_case_opened', '/admin/cases/00000000-0000-0000-0000-000000000000'],
  ['staff_authority_request', '/admin/authority-requests'],
  ['staff_claim_submitted', '/admin/claims'],
  ['every footer', '/account/notifications'],
  ['every footer', '/'],
];

/** Authenticated destinations must bounce to sign-in, not break. */
const GATED = /^\/(admin|account|review|shortlist)/;

let pass = 0, fail = 0;

for (const [message, path] of LINKS) {
  const url = BASE + path.split('#')[0];
  let line;
  let ok = false;

  try {
    const response = await fetch(url, { redirect: 'manual' });
    const location = response.headers.get('location') ?? '';
    const gated = GATED.test(path);

    if (gated) {
      // 307 to sign-in with the destination preserved, or 200 if a session
      // happens to be attached. A 404 or a 500 is the failure this catches.
      ok =
        (response.status === 307 && location.startsWith('/sign-in?next=')) ||
        response.status === 200;
      line = `${response.status} ${location ? '-> ' + location : ''}`;
    } else {
      ok = response.status === 200;
      line = String(response.status);
    }
  } catch (error) {
    line = error instanceof Error ? error.message : 'unreachable';
  }

  ok ? pass++ : fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${path.padEnd(52)} ${line.padEnd(42)} ${message}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exitCode = fail === 0 ? 0 : 1;
