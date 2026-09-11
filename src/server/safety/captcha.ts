import 'server-only';

/**
 * Bot mitigation on the two endpoints that create content.
 *
 * Cloudflare Turnstile. Chosen over the alternatives on three grounds that
 * matter for this product specifically:
 *
 *   - **It usually asks nothing.** Running in `interaction-only` mode, almost
 *     every real person sees no widget at all. A review takes four minutes to
 *     write and the person writing it is doing Livd a favour; ending that with
 *     a grid of traffic lights is the wrong last impression.
 *   - **It is not an advertising product.** reCAPTCHA sends a visitor's
 *     browsing signal to an ad company on a page where Livd's whole promise is
 *     that nobody is watching. Turnstile sets no tracking cookie.
 *   - **It verifies over one HTTPS call.** No SDK, no dependency, the same
 *     shape as the mail transport.
 *
 * THE ONLY PROPERTY THAT ACTUALLY MATTERS
 *
 * Whether verification is required is decided **here, from the server's own
 * environment** — never from anything the request carries. There is no
 * `captchaPassed` flag, no header, no field a caller can set to opt out. With
 * `TURNSTILE_SECRET_KEY` present, a submission with no token or a bad token is
 * refused, and it makes no difference whether it arrived from the form, from
 * `curl` against the Server Action endpoint, or from a script driving a
 * headless browser that never rendered the widget.
 *
 * With the secret absent there is no protection, the widget is not rendered,
 * and this returns "not required". That is the honest state of an unconfigured
 * deployment rather than a false one, and it is the same gating `for-owners`
 * uses for Google sign-in: a control that half exists is worse than one that
 * is plainly off.
 *
 * FAILING OPEN, EXACTLY ONCE
 *
 * A verdict of "no" fails the submission. A failure to *reach* Cloudflare —
 * timeout, DNS, a 5xx from their edge — does not. The reasoning is the same
 * as the rate limiter's: turning a third-party outage into "nobody may write
 * a review" is a worse outcome than the one this control exists to prevent,
 * and the fallback is not attacker-controllable — a caller cannot cause a
 * network failure between Livd's server and Cloudflare's. Everything else
 * still applies to the same request: an account is required, the rate limit
 * is counted in Postgres, duplicates are refused by a unique index, and the
 * content linter has not run yet.
 */

const VERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare's own guidance is a few seconds; this is generous. */
const TIMEOUT_MS = 8_000;

export type CaptchaOutcome =
  /** Verified, or not required because nothing is configured. */
  | { ok: true; checked: boolean }
  /** A definite no from Cloudflare, or nothing presented at all. */
  | { ok: false; reason: 'missing' | 'invalid' | 'expired' | 'duplicate' };

/**
 * Whether a caller must present a token.
 *
 * Read at call time rather than at module scope, so a test can set the
 * variable and a missing key never fails a build.
 */
export function captchaRequired(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

/** Cloudflare's error codes, mapped to something a person can act on. */
function classify(codes: string[]): 'invalid' | 'expired' | 'duplicate' {
  if (codes.includes('timeout-or-duplicate')) return 'duplicate';
  if (codes.some((code) => code.includes('expired'))) return 'expired';
  return 'invalid';
}

/**
 * Verifies a token with Cloudflare.
 *
 * `remoteIp` is passed when known: Cloudflare uses it as a further signal, and
 * it never reaches Livd's own storage — the rate limiter hashes addresses with
 * a per-deployment salt precisely so none is kept, and this does not keep one
 * either.
 */
export async function verifyCaptcha(
  token: string | null,
  remoteIp: string | null,
): Promise<CaptchaOutcome> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // Not configured. Nothing to check, and nothing pretends otherwise.
  if (!secret) return { ok: true, checked: false };

  if (!token || token.length < 8 || token.length > 4096) {
    return { ok: false, reason: 'missing' };
  }

  const body = new URLSearchParams({ secret, response: token });
  // `unknown` is what the rate limiter falls back to as well; sending it is
  // worse than sending nothing, so it is omitted.
  if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp);

  try {
    const response = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // Cloudflare itself is unwell. See the note above on failing open.
      console.error(`[livd] Turnstile verification unavailable: HTTP ${response.status}`);
      return { ok: true, checked: false };
    }

    const result = (await response.json()) as {
      success?: boolean;
      'error-codes'?: string[];
    };

    if (result.success) return { ok: true, checked: true };

    const codes = result['error-codes'] ?? [];

    // A secret that is wrong or missing is a deployment fault, not a visitor
    // one, and refusing every submission over it would be the worst possible
    // way to discover the typo.
    if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
      console.error('[livd] TURNSTILE_SECRET_KEY is not accepted by Cloudflare. Bot protection is off.');
      return { ok: true, checked: false };
    }

    return { ok: false, reason: classify(codes) };
  } catch (error) {
    console.error(
      '[livd] Turnstile verification could not be reached',
      error instanceof Error ? error.message : error,
    );
    return { ok: true, checked: false };
  }
}

/** What to tell somebody whose check did not pass. Never "you look like a bot". */
export function captchaMessage(reason: 'missing' | 'invalid' | 'expired' | 'duplicate'): string {
  switch (reason) {
    case 'expired':
    case 'duplicate':
      return 'The security check on this page has expired. Reload the page and submit again — nothing you have written is lost.';
    case 'missing':
      return 'The security check did not finish. If you use an extension that blocks scripts, allow challenges.cloudflare.com and reload the page.';
    case 'invalid':
      return 'The security check did not pass. Reload the page and try again.';
  }
}
