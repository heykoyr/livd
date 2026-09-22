import { describe, expect, it } from 'vitest';

import {
  classifyCodeExchangeFailure,
  classifyLinkRequestFailure,
  classifyReturnedError,
  classifyVerifyFailure,
  parseLinkFailure,
  resolveSpentLink,
} from '@/lib/auth/sign-in-failures';

/**
 * Reading Supabase's refusals.
 *
 * The messages below are Supabase's own, copied from the production auth log
 * of 21 September 2026 — the morning a sign-in failed on an iPhone. Each of
 * them used to reach the person as one of two sentences, and one of those
 * sentences was wrong for every case it covered.
 */

describe('asking for a link', () => {
  it('reads the per-address cooldown, with the wait Supabase names', () => {
    // POST /otp, 01:39:49 UTC: a second request forty seconds after the first.
    const failure = classifyLinkRequestFailure({
      status: 429,
      code: 'over_email_send_rate_limit',
      message: 'For security purposes, you can only request this after 10 seconds.',
    });

    expect(failure).toEqual({ kind: 'cooldown', retryAfterSeconds: 10 });
  });

  it('tells the hourly project cap apart from the cooldown, and invents no wait for it', () => {
    // The same code, from 7 September, when the built-in sender's cap was hit.
    expect(
      classifyLinkRequestFailure({
        status: 429,
        code: 'over_email_send_rate_limit',
        message: 'email rate limit exceeded',
      }),
    ).toEqual({ kind: 'rate_limited' });
  });

  it('keeps an absurd wait inside what a person can be asked to watch', () => {
    const failure = classifyLinkRequestFailure({
      status: 429,
      code: 'over_email_send_rate_limit',
      message: 'you can only request this after 99999 seconds',
    });
    expect(failure).toEqual({ kind: 'cooldown', retryAfterSeconds: 3600 });
  });

  it('calls a failed SMTP hand-off a delivery failure, not a mystery', () => {
    expect(
      classifyLinkRequestFailure({ status: 500, message: 'Error sending magic link email' }),
    ).toEqual({ kind: 'delivery_failed' });
    expect(
      classifyLinkRequestFailure({ status: 500, message: 'Error sending confirmation email' }),
    ).toEqual({ kind: 'delivery_failed' });
  });

  it('names an address Supabase will not accept', () => {
    expect(
      classifyLinkRequestFailure({ status: 400, code: 'email_address_invalid', message: 'x' }),
    ).toEqual({ kind: 'invalid_email' });
  });

  it('leaves anything else generic', () => {
    expect(classifyLinkRequestFailure({ status: 400, code: 'something_new' })).toEqual({
      kind: 'unknown',
    });
  });
});

describe('using a link', () => {
  it('holds back on "expired" until the token has been looked up', () => {
    // GET /verify, 01:39:30 UTC — the link tapped a second time. Supabase says
    // "invalid or has expired" for both, so the classifier does not choose.
    expect(
      classifyVerifyFailure({
        status: 403,
        code: 'otp_expired',
        message: 'Email link is invalid or has expired',
      }),
    ).toBe('spent');
  });

  it.each([
    ['present', 'expired'],
    ['used', 'used'],
    ['unknown', 'superseded'],
  ] as const)('a spent token found %s reads as %s', (evidence, failure) => {
    expect(resolveSpentLink(evidence)).toBe(failure);
  });

  it('treats a malformed request as an invalid link', () => {
    expect(classifyVerifyFailure({ status: 400, code: 'validation_failed' })).toBe('invalid');
  });

  it('treats a verify rate limit as a rate limit', () => {
    expect(classifyVerifyFailure({ status: 429, code: 'over_request_rate_limit' })).toBe(
      'rate_limited',
    );
  });
});

describe('finishing a PKCE return', () => {
  it('blames the browser when it holds no verifier — the iPhone case', () => {
    // POST /token, 01:29:39 UTC, from the link opened in iOS Chrome:
    // "invalid request: both auth code and code verifier should be non-empty".
    expect(
      classifyCodeExchangeFailure({ status: 400, code: 'validation_failed' }, false),
    ).toBe('browser');
  });

  it('blames the browser when its verifier belongs to a different sign-in', () => {
    // POST /token, 01:39:14 UTC: "code challenge does not match previously
    // saved code verifier".
    expect(classifyCodeExchangeFailure({ status: 400, code: 'bad_code_verifier' }, true)).toBe(
      'browser',
    );
  });

  it('reads a stale flow as expired', () => {
    expect(classifyCodeExchangeFailure({ status: 400, code: 'flow_state_expired' }, true)).toBe(
      'expired',
    );
  });

  it('reads the errors Supabase puts on the return URL', () => {
    expect(
      classifyReturnedError(
        new URLSearchParams(
          'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
        ),
      ),
    ).toBe('superseded');
    expect(
      classifyReturnedError(new URLSearchParams('error=access_denied&error_description=denied')),
    ).toBe('cancelled');
  });
});

describe('the ?error= parameter', () => {
  it('reads every category back', () => {
    for (const value of ['expired', 'used', 'superseded', 'invalid', 'browser', 'cancelled']) {
      expect(parseLinkFailure(value)).toBe(value);
    }
  });

  it('maps the old catch-all to the generic message', () => {
    expect(parseLinkFailure('link')).toBe('unknown');
  });

  it('ignores anything it did not write', () => {
    expect(parseLinkFailure('<script>')).toBeNull();
    expect(parseLinkFailure('Email link is invalid or has expired')).toBeNull();
    expect(parseLinkFailure(undefined)).toBeNull();
  });
});
