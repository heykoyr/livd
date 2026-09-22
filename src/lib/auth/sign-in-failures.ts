/**
 * What went wrong with a sign-in, in terms a person can act on.
 *
 * Two different moments fail in different ways, so there are two vocabularies:
 *
 *   A **request** for a link can be refused before any email exists — a
 *   cooldown on that address, a cap on the whole project, an address that is
 *   not an address, or a provider that would not take the message.
 *
 *   A **link** can fail when it is used — it expired, it was already used, a
 *   newer email replaced it, it was opened somewhere that cannot finish it, or
 *   it was never a real link.
 *
 * Before this module every failure in either group reached the person as one
 * of two sentences. "That link did not work" was shown for a link opened in
 * the wrong browser, where it was simply untrue that the link had expired; and
 * a sixty-second cooldown on one address was described as a limit "on our
 * email provider", which sent people off to wait for minutes instead of
 * seconds. The classification is pure so it can be tested against the
 * provider's real messages, which are quoted in the tests.
 *
 * Nothing here reveals whether an address has an account. Every kind below can
 * happen to a registered and an unregistered address alike.
 */

/* -------------------------------------------------------------------------
 * The provider's error, as much of it as Livd reads
 * ---------------------------------------------------------------------- */

/** The fields of a Supabase `AuthError` this module looks at. */
export interface ProviderAuthError {
  status?: number;
  code?: string;
  message?: string;
}

/* -------------------------------------------------------------------------
 * Requesting a link
 * ---------------------------------------------------------------------- */

export type LinkRequestFailure =
  /**
   * This address was sent a link moments ago. Supabase says exactly how long
   * is left — "you can only request this after 42 seconds" — so the wait shown
   * is the server's own number, not a guess.
   */
  | { kind: 'cooldown'; retryAfterSeconds: number }
  /** The project-wide cap on sign-in emails per hour has been reached. */
  | { kind: 'rate_limited' }
  | { kind: 'invalid_email' }
  /** The provider accepted the request and then failed to send the message. */
  | { kind: 'delivery_failed' }
  | { kind: 'unknown' };

/**
 * Supabase's per-address cooldown message. Worded identically for the magic
 * link, the signup confirmation and every other email it sends.
 */
const COOLDOWN_MESSAGE = /after\s+(\d+)\s+seconds?/i;

export function classifyLinkRequestFailure(error: ProviderAuthError): LinkRequestFailure {
  const code = error.code ?? '';
  const message = error.message ?? '';

  if (code === 'over_email_send_rate_limit' || error.status === 429) {
    // The same error code covers two unrelated limits. Only the per-address
    // one names a number of seconds, and it is the one people hit in practice:
    // request, tap, come back, request again inside a minute.
    const seconds = COOLDOWN_MESSAGE.exec(message);
    if (seconds) {
      return { kind: 'cooldown', retryAfterSeconds: clampSeconds(Number(seconds[1])) };
    }
    return { kind: 'rate_limited' };
  }

  if (code === 'over_request_rate_limit') return { kind: 'rate_limited' };

  if (code === 'email_address_invalid') return { kind: 'invalid_email' };

  // GoTrue answers a failed SMTP hand-off with a 500 and "Error sending magic
  // link email" (or "confirmation email" for a first sign-in). No code.
  if ((error.status ?? 0) >= 500 || /error sending .*email/i.test(message)) {
    return { kind: 'delivery_failed' };
  }

  return { kind: 'unknown' };
}

/** A countdown should never read "0 seconds" or run for an hour on bad input. */
function clampSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 60;
  return Math.min(Math.max(Math.ceil(seconds), 1), 3600);
}

/* -------------------------------------------------------------------------
 * Using a link
 * ---------------------------------------------------------------------- */

/**
 * Every way a sign-in link, code or Google return can fail, as carried in the
 * `?error=` parameter of `/sign-in`. The value is a category, never the
 * provider's message and never anything from the link itself.
 */
export const LINK_FAILURES = [
  /** The link was real and is past its lifetime. */
  'expired',
  /** The link was real and has been used already — possibly by this person, elsewhere. */
  'used',
  /**
   * The link is not one Supabase still holds, and Livd has no record of it
   * being used. Almost always because a newer email replaced it; otherwise
   * it was mistyped or tampered with. Both are said, because both are true.
   */
  'superseded',
  /** Malformed — not a link Supabase could have issued. */
  'invalid',
  /**
   * Opened somewhere that cannot finish this sign-in. Only the older link
   * format and Google sign-in can produce this: both prove the browser that
   * started them with a secret it kept, and a different browser has none.
   */
  'browser',
  /** The person backed out at Google. Not an error, but worth acknowledging. */
  'cancelled',
  /** Too many attempts from here in a short time. */
  'rate_limited',
  /** Anything else. Logged with its category; shown generically. */
  'unknown',
] as const;

export type LinkFailure = (typeof LINK_FAILURES)[number];

/** Reads `?error=` back. The pre-existing `link` value maps to `unknown`. */
export function parseLinkFailure(value: string | null | undefined): LinkFailure | null {
  if (!value) return null;
  if (value === 'link') return 'unknown';
  return (LINK_FAILURES as readonly string[]).includes(value) ? (value as LinkFailure) : null;
}

/**
 * What a verification failure means before Livd looks anything up.
 *
 * `otp_expired` is deliberately left undecided: GoTrue uses it both for a
 * token past its lifetime and for one it cannot find at all, and those need
 * different words. `resolveSpentLink` finishes the job once the token's fate
 * is known.
 */
export type VerifyOutcome = LinkFailure | 'spent';

export function classifyVerifyFailure(error: ProviderAuthError): VerifyOutcome {
  switch (error.code) {
    case 'otp_expired':
      return 'spent';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rate_limited';
    case 'validation_failed':
    case 'bad_json':
      return 'invalid';
    case 'otp_disabled':
    case 'user_banned':
    case 'user_not_found':
      return 'unknown';
  }

  if (error.status === 429) return 'rate_limited';
  if (error.status === 403 && /invalid or has expired/i.test(error.message ?? '')) return 'spent';

  return 'unknown';
}

/**
 * What Livd knows about a token that GoTrue would not accept.
 *
 *   present — Supabase still holds it, so the only reason to refuse it is age.
 *   used    — Livd recorded redeeming it.
 *   unknown — neither, or the lookup could not run.
 */
export type SpentLinkEvidence = 'present' | 'used' | 'unknown';

export function resolveSpentLink(evidence: SpentLinkEvidence): LinkFailure {
  if (evidence === 'present') return 'expired';
  if (evidence === 'used') return 'used';
  return 'superseded';
}

/**
 * Why a PKCE return (`?code=`) could not be exchanged.
 *
 * `verifierPresent` is whether this browser holds the secret that started the
 * flow. Checked by Livd before it asks Supabase anything, because the absence
 * is the answer: this is a different browser, or cookies were cleared.
 */
export function classifyCodeExchangeFailure(
  error: ProviderAuthError,
  verifierPresent: boolean,
): LinkFailure {
  if (!verifierPresent) return 'browser';

  switch (error.code) {
    // The browser holds *a* secret, but not the one for this link — it started
    // a second sign-in after this one, or the link came from somewhere else.
    case 'bad_code_verifier':
      return 'browser';
    case 'flow_state_expired':
      return 'expired';
    case 'flow_state_not_found':
      return 'used';
    case 'over_request_rate_limit':
      return 'rate_limited';
  }

  return 'unknown';
}

/**
 * The errors Supabase itself puts on the return URL, before Livd sees a code.
 * An expired or reused link lands here as `error_code=otp_expired`.
 */
export function classifyReturnedError(params: URLSearchParams): LinkFailure {
  const code = params.get('error_code');
  const error = params.get('error');

  if (error === 'access_denied' && code !== 'otp_expired') return 'cancelled';
  if (code === 'otp_expired') return 'superseded';
  if (code === 'flow_state_expired') return 'expired';
  if (code === 'over_request_rate_limit') return 'rate_limited';

  return 'unknown';
}
