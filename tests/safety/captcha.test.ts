import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captchaMessage, captchaRequired, verifyCaptcha } from '@/server/safety/captcha';

/**
 * The bot check, and the one property that matters about it.
 *
 * A CAPTCHA is worth nothing if the server will take the client's word for
 * it. The failure everybody ships at least once is some version of
 *
 *     if (formData.get('captchaPassed') === 'true') { … }
 *
 * which stops a browser and stops nothing else. So what is asserted here is
 * not "a valid token passes" — it is that the *requirement* is decided from
 * the server's own environment, that a request with no token is refused when
 * one is configured, and that a token is always checked with Cloudflare
 * rather than trusted for looking plausible.
 */

const ORIGINAL = process.env.TURNSTILE_SECRET_KEY;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = ORIGINAL;
  vi.restoreAllMocks();
});

function cloudflareSays(body: unknown, status = 200) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe('whether a check is required', () => {
  it('is decided by the server, not by the request', () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(captchaRequired()).toBe(false);

    process.env.TURNSTILE_SECRET_KEY = 'secret';
    expect(captchaRequired()).toBe(true);
  });

  it('checks nothing, and says so, when unconfigured', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;

    const result = await verifyCaptcha('anything-at-all', '203.0.113.4');

    expect(result).toEqual({ ok: true, checked: false });
    // Not even a request. An unconfigured deployment has no protection and
    // does not pretend to.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a request that skipped the widget', () => {
  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
  });

  it('is refused when it carries no token', async () => {
    // This is the direct-API bypass: a script calling the Server Action with
    // the same body the form sends, minus the field it never rendered.
    const result = await verifyCaptcha(null, '203.0.113.4');

    expect(result).toEqual({ ok: false, reason: 'missing' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is refused when the token is obviously fabricated', async () => {
    expect(await verifyCaptcha('', null)).toEqual({ ok: false, reason: 'missing' });
    expect(await verifyCaptcha('yes', null)).toEqual({ ok: false, reason: 'missing' });
    expect(await verifyCaptcha('x'.repeat(9000), null)).toEqual({ ok: false, reason: 'missing' });
  });

  it('is refused when the token is plausible but not Cloudflare"s', async () => {
    cloudflareSays({ success: false, 'error-codes': ['invalid-input-response'] });

    expect(await verifyCaptcha('0.AAAA-plausible-looking-token', null)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('is refused when the token has been used before', async () => {
    // Replay. Cloudflare enforces single use; this asserts Livd surfaces it
    // rather than treating a reused token as a pass.
    cloudflareSays({ success: false, 'error-codes': ['timeout-or-duplicate'] });

    expect(await verifyCaptcha('0.AAAA-already-spent', null)).toEqual({
      ok: false,
      reason: 'duplicate',
    });
  });
});

describe('a genuine token', () => {
  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
  });

  it('passes, and is verified with the provider rather than assumed', async () => {
    cloudflareSays({ success: true });

    expect(await verifyCaptcha('0.AAAA-real', '203.0.113.4')).toEqual({ ok: true, checked: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: URLSearchParams }];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.body.get('secret')).toBe('secret');
    expect(init.body.get('response')).toBe('0.AAAA-real');
    expect(init.body.get('remoteip')).toBe('203.0.113.4');
  });

  it('does not send a placeholder address as if it were one', async () => {
    cloudflareSays({ success: true });

    await verifyCaptcha('0.AAAA-real', 'unknown');

    const [, init] = fetchMock.mock.calls[0] as [string, { body: URLSearchParams }];
    expect(init.body.get('remoteip')).toBeNull();
  });
});

describe('when Cloudflare is the thing that is broken', () => {
  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('lets a submission through on a transport failure', async () => {
    // Deliberate, and the reasoning is the rate limiter's: turning a
    // third-party outage into "nobody may write a review" is worse than the
    // thing this control prevents, and a caller cannot cause a network
    // failure between Livd and Cloudflare. Every other control still applies
    // to the same request.
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));

    expect(await verifyCaptcha('0.AAAA-real', null)).toEqual({ ok: true, checked: false });
  });

  it('lets a submission through on a 5xx from their edge', async () => {
    cloudflareSays({}, 502);

    expect(await verifyCaptcha('0.AAAA-real', null)).toEqual({ ok: true, checked: false });
  });

  it('does not punish visitors for a mistyped secret', async () => {
    cloudflareSays({ success: false, 'error-codes': ['invalid-input-secret'] });

    expect(await verifyCaptcha('0.AAAA-real', null)).toEqual({ ok: true, checked: false });
  });

  it('never tells anybody they look like a bot', async () => {
    for (const reason of ['missing', 'invalid', 'expired', 'duplicate'] as const) {
      const message = captchaMessage(reason).toLowerCase();
      expect(message).not.toContain('bot');
      expect(message).not.toContain('robot');
      expect(message).not.toContain('automated');
      // Every message ends in something the person can do.
      expect(message).toMatch(/reload|try again/);
    }
  });
});
