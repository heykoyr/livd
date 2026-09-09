/**
 * Identity masking.
 *
 * Livd's promise is that a reviewer is anonymous to the public and accountable
 * to Livd. The second half of that means somebody at Livd can, in the right
 * circumstances and with a record of it, find out who wrote something. It does
 * not mean everybody who can open the admin area reads 124 email addresses on
 * the way to triaging a report.
 *
 * So a moderator sees a mask. It is enough to recognise the same person across
 * two cases, enough to notice ten signups sharing a throwaway domain, and not
 * enough to identify anyone.
 *
 * THE REAL CONTROL IS NOT HERE.
 *
 * `livd_mask_email` in migration 0022 applies this same rule inside Postgres,
 * and the admin directory is built there — so the raw address is never selected
 * into this process at all. A mask applied in TypeScript is a promise about
 * what code does with a value it holds; a mask applied before the value crosses
 * the boundary means there is no value to hold. This module exists for the
 * local development adapter, which has no database to do it in, and for the
 * parity test that keeps the two rules identical.
 */

/**
 * `feranmiadekoya@gmail.com` → `fer***@gmail.com`
 *
 * At most the first three characters of the local part, and never more than
 * half of it — otherwise a rule tuned for a long address reveals a short one
 * completely: `ab@example.com` would mask to itself.
 *
 * The domain survives. It identifies nobody on its own, and a moderator
 * looking at a wave of signups needs to see that forty of them share one.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '—';

  const at = email.indexOf('@');

  // `< 1` rather than `=== -1`: an address beginning with @ has no local part
  // to mask, and returning `***@domain` for it would imply there was one.
  if (at < 1) return '—';

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain) return '—';

  const visible = Math.min(3, Math.floor(local.length / 2));
  return `${local.slice(0, visible)}***@${domain}`;
}
