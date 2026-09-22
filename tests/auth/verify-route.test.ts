import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setRateLimitStore, type RateLimitStore } from '@/lib/safety/rate-limit';

/**
 * `/auth/verify` — where a tap on "Sign in to Livd" redeems the link.
 *
 * Supabase is the one thing replaced here, because it is a network service.
 * Everything Livd decides — whether to accept the post at all, what to ask
 * Supabase, where to send the person, what to record — runs for real, and the
 * assertions are on the HTTP response a browser would receive.
 */

const verifyOtp = vi.fn();
const rpc = vi.fn();

vi.mock('@/server/auth/supabase-client', () => ({
  createServerSupabaseClient: async () => ({ auth: { verifyOtp } }),
  createServiceRoleClient: () => ({ rpc }),
}));

const HASH = `pkce_${'0123456789abcdef'.repeat(3)}01234567`;

function post(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request('https://livd.site/auth/verify', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://livd.site',
      'x-forwarded-for': '203.0.113.7',
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

const valid = { token_hash: HASH, type: 'email', next: '/review' };

async function load() {
  return import('@/app/auth/verify/route');
}

/** Counts nothing, so no test is refused by another's requests. */
const unlimited: RateLimitStore = {
  async increment() {
    return { count: 1, resetAt: Date.now() + 1000 };
  },
};

beforeEach(() => {
  vi.stubEnv('LIVD_DATA_BACKEND', 'supabase');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  setRateLimitStore(unlimited);
  verifyOtp.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  setRateLimitStore(null);
});

describe('a genuine tap', () => {
  it('redeems the token and lands on the page the person was going to', async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    const { POST } = await load();

    const response = await POST(post(valid));

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: 'email' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://livd.site/review');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('records the redemption, so a second tap can be told it was used', async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    const { POST } = await load();

    await POST(post(valid));

    expect(rpc).toHaveBeenCalledWith('livd_record_sign_in_link_redemption', {
      p_token_hashes: [HASH],
    });
  });

  it('puts no part of the token in the address it redirects to', async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    const { POST } = await load();

    const response = await POST(post(valid));

    expect(response.headers.get('location')).not.toContain(HASH);
    expect(response.headers.get('location')).not.toContain('token');
  });

  it('accepts a same-origin post whose Origin the browser withheld', async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    const { POST } = await load();

    const response = await POST(post(valid, { origin: 'null', 'sec-fetch-site': 'same-origin' }));

    expect(response.status).toBe(303);
    expect(verifyOtp).toHaveBeenCalled();
  });
});

describe('what it refuses', () => {
  it('refuses a post from another site — login CSRF', async () => {
    const { POST } = await load();

    const response = await POST(post(valid, { origin: 'https://evil.example' }));

    expect(response.status).toBe(403);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('refuses a post that says nothing about where it came from', async () => {
    const { POST } = await load();
    const request = post(valid);
    const headers = new Headers(request.headers);
    headers.delete('origin');

    const response = await POST(new Request(request.url, { method: 'POST', headers, body: new URLSearchParams(valid).toString() }));

    expect(response.status).toBe(403);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('does nothing on GET — opening a link must never be enough', async () => {
    const { GET } = await load();
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('sends a malformed link to the sign-in page without asking Supabase', async () => {
    const { POST } = await load();

    const response = await POST(post({ ...valid, token_hash: 'x' }));

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(
      'https://livd.site/sign-in?error=invalid&next=%2Freview',
    );
  });

  it('never lands anywhere but a Livd path, whatever next says', async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    const { POST } = await load();

    for (const next of ['https://evil.example/x', '//evil.example', '/\\evil.example']) {
      const response = await POST(post({ ...valid, next }));
      expect(response.headers.get('location')).toBe('https://livd.site/');
    }
  });
});

describe('a link that no longer works', () => {
  const spent = {
    data: {},
    error: { status: 403, code: 'otp_expired', message: 'Email link is invalid or has expired' },
  };

  it.each([
    ['still held by Supabase', 'present', 'expired'],
    ['already redeemed by Livd', 'used', 'used'],
    ['neither', 'unknown', 'superseded'],
  ])('says so specifically when the token is %s', async (_label, evidence, failure) => {
    verifyOtp.mockResolvedValue(spent);
    rpc.mockResolvedValue({ data: evidence, error: null });
    const { POST } = await load();

    const response = await POST(post(valid));

    expect(rpc).toHaveBeenCalledWith('livd_sign_in_link_status', { p_token_hash: HASH });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `https://livd.site/sign-in?error=${failure}&next=%2Freview`,
    );
  });

  it('still answers, less specifically, when the lookup itself fails', async () => {
    verifyOtp.mockResolvedValue(spent);
    rpc.mockRejectedValue(new Error('database unavailable'));
    const { POST } = await load();

    const response = await POST(post(valid));

    expect(response.headers.get('location')).toContain('error=superseded');
  });

  it('logs the category and the provider code, never the token', async () => {
    verifyOtp.mockResolvedValue(spent);
    rpc.mockResolvedValue({ data: 'present', error: null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await load();

    await POST(post(valid));

    const logged = warn.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('"outcome":"expired"');
    expect(logged).toContain('"providerCode":"otp_expired"');
    expect(logged).not.toContain(HASH);
    expect(logged).not.toContain(HASH.slice(5));
  });
});
