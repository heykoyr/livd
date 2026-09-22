import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copy } from '@/content/copy';
import { initialAuthState, initialSignInCodeState } from '@/server/actions/action-state';
import { setRateLimitStore, type RateLimitStore } from '@/lib/safety/rate-limit';

/**
 * Asking for a sign-in email, and signing in with its code.
 *
 * Supabase is replaced, because it sends real email; the action runs for
 * real. The refusals are Supabase's own words, from the production log.
 */

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const rpc = vi.fn();

vi.mock('@/server/auth/supabase-client', () => ({
  createServerSupabaseClient: async () => ({ auth: { signInWithOtp, verifyOtp } }),
  createServiceRoleClient: () => ({ rpc }),
}));

vi.mock('@/server/actions/reports', () => ({
  originIdentifier: async () => '203.0.113.7',
}));

const unlimited: RateLimitStore = {
  async increment() {
    return { count: 1, resetAt: Date.now() + 1000 };
  },
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function actions() {
  return import('@/server/actions/auth');
}

beforeEach(() => {
  vi.stubEnv('LIVD_DATA_BACKEND', 'supabase');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  setRateLimitStore(unlimited);
  signInWithOtp.mockReset();
  verifyOtp.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  setRateLimitStore(null);
});

describe('requesting a link', () => {
  it('reports where it went, and waits out Supabase’s interval before offering another', async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    const { requestSignIn } = await actions();

    const state = await requestSignIn(
      initialAuthState,
      form({ email: ' Someone@Example.com ', next: '/review' }),
    );

    expect(state).toMatchObject({
      error: null,
      sentTo: 'someone@example.com',
      cooldownSeconds: 60,
      sentCount: 1,
    });
  });

  it('asks Supabase to return to the callback on this site, carrying the destination', async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    const { requestSignIn } = await actions();

    await requestSignIn(initialAuthState, form({ email: 'someone@example.com', next: '/review' }));

    const redirect = signInWithOtp.mock.calls[0]?.[0]?.options?.emailRedirectTo as string;
    expect(new URL(redirect).pathname).toBe('/auth/callback');
    expect(new URL(redirect).searchParams.get('next')).toBe('/review');
  });

  it('counts a resend, so the screen can say earlier links stopped working', async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    const { requestSignIn } = await actions();

    const first = await requestSignIn(initialAuthState, form({ email: 'someone@example.com' }));
    const second = await requestSignIn(first, form({ email: 'someone@example.com' }));

    expect(second.sentCount).toBe(2);
  });

  it('turns the per-address cooldown into the server’s own wait — the error that met the iPhone', async () => {
    signInWithOtp.mockResolvedValue({
      data: {},
      error: {
        status: 429,
        code: 'over_email_send_rate_limit',
        message: 'For security purposes, you can only request this after 10 seconds.',
      },
    });
    const { requestSignIn } = await actions();

    const state = await requestSignIn(initialAuthState, form({ email: 'someone@example.com' }));

    expect(state.error).toBe(copy.auth.cooldown);
    expect(state.cooldownSeconds).toBe(10);
    // Nothing blames the email provider, and nothing suggests the account.
    expect(state.error).not.toMatch(/provider|account/i);
  });

  it('keeps the check-your-email screen when a resend is refused', async () => {
    signInWithOtp.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValueOnce({
      data: {},
      error: {
        status: 429,
        code: 'over_email_send_rate_limit',
        message: 'For security purposes, you can only request this after 42 seconds.',
      },
    });
    const { requestSignIn } = await actions();

    const sent = await requestSignIn(initialAuthState, form({ email: 'someone@example.com' }));
    const refused = await requestSignIn(sent, form({ email: 'someone@example.com' }));

    expect(refused.sentTo).toBe('someone@example.com');
    expect(refused.cooldownSeconds).toBe(42);
  });

  it('describes the hourly cap without inventing a countdown for it', async () => {
    signInWithOtp.mockResolvedValue({
      data: {},
      error: { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' },
    });
    const { requestSignIn } = await actions();

    const state = await requestSignIn(initialAuthState, form({ email: 'someone@example.com' }));

    expect(state.error).toBe(copy.auth.tooManyLinks);
    expect(state.cooldownSeconds ?? null).toBeNull();
  });

  it('says the email could not be sent when the provider fails', async () => {
    signInWithOtp.mockResolvedValue({
      data: {},
      error: { status: 500, message: 'Error sending magic link email' },
    });
    const { requestSignIn } = await actions();

    const state = await requestSignIn(initialAuthState, form({ email: 'someone@example.com' }));

    expect(state.error).toBe(copy.auth.deliveryFailed);
  });

  it('logs no address', async () => {
    signInWithOtp.mockResolvedValue({
      data: {},
      error: { status: 500, message: 'Error sending magic link email' },
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { requestSignIn } = await actions();

    await requestSignIn(initialAuthState, form({ email: 'private.person@example.com' }));

    const logged = error.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('delivery_failed');
    expect(logged).not.toContain('private.person');
  });

  it('refuses a request its own limit has stopped, without calling Supabase', async () => {
    setRateLimitStore({
      async increment() {
        return { count: 99, resetAt: Date.now() + 120_000 };
      },
    });
    const { requestSignIn } = await actions();

    const state = await requestSignIn(initialAuthState, form({ email: 'someone@example.com' }));

    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(state.error).toBe(copy.auth.tooManyLinksWait);
    expect(state.cooldownSeconds).toBeGreaterThan(100);
  });
});

describe('signing in with the code', () => {
  it('verifies the code for that address and returns the destination', async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    const { verifySignInCode } = await actions();

    const state = await verifySignInCode(
      initialSignInCodeState,
      form({ email: 'someone@example.com', code: '1234 5678', next: '/review' }),
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'someone@example.com',
      token: '12345678',
      type: 'email',
    });
    expect(state).toEqual({ status: 'signed-in', error: null, redirectTo: '/review' });
  });

  it('records the code as the token hash Supabase stored — computed independently here', async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    const { verifySignInCode } = await actions();

    await verifySignInCode(
      initialSignInCodeState,
      form({ email: 'someone@example.com', code: '12345678' }),
    );

    // SHA-224("someone@example.com12345678"), from Python's hashlib.
    const expected = 'b4ba91e18f39f4b108b02a2afc254445a84a0db175202270a7ddc241';
    expect(rpc).toHaveBeenCalledWith('livd_record_sign_in_link_redemption', {
      p_token_hashes: [expected, `pkce_${expected}`],
    });
  });

  it.each([
    ['still held by Supabase', 'present', copy.auth.codeExpired],
    ['already redeemed', 'used', copy.auth.codeUsed],
    ['not held at all — a mistyped code', null, copy.auth.codeWrong],
  ])('tells a code %s apart', async (_label, evidence, message) => {
    verifyOtp.mockResolvedValue({
      data: {},
      error: { status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' },
    });
    rpc.mockResolvedValue({ data: evidence, error: null });
    const { verifySignInCode } = await actions();

    const state = await verifySignInCode(
      initialSignInCodeState,
      form({ email: 'someone@example.com', code: '12345678' }),
    );

    expect(state).toEqual({ status: 'error', error: message, redirectTo: null });
  });

  it('refuses something that is not a code without asking Supabase', async () => {
    const { verifySignInCode } = await actions();

    const state = await verifySignInCode(
      initialSignInCodeState,
      form({ email: 'someone@example.com', code: 'abc' }),
    );

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(state.error).toBe(copy.auth.codeMalformed);
  });

  it('never returns a destination off the site', async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    const { verifySignInCode } = await actions();

    const state = await verifySignInCode(
      initialSignInCodeState,
      form({ email: 'someone@example.com', code: '12345678', next: 'https://evil.example' }),
    );

    expect(state.redirectTo).toBe('/');
  });
});
