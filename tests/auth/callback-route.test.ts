import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/auth/callback` — where Google returns, and where an email link of the old
 * format would.
 *
 * The case this was written for: a PKCE return that lands in a browser holding
 * no verifier. That is what an iPhone did on 21 September 2026 — link asked
 * for in Safari, opened by iOS in Chrome — and the page said the link had
 * expired, which it had not.
 */

const exchangeCodeForSession = vi.fn();
let cookieJar: { name: string; value: string }[] = [];

vi.mock('@/server/auth/supabase-client', () => ({
  createServerSupabaseClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => cookieJar }),
}));

const VERIFIER = { name: 'sb-project-auth-token-code-verifier', value: 'base64-verifier' };

async function get(query: string): Promise<Response> {
  const { GET } = await import('@/app/auth/callback/route');
  return GET(new Request(`https://livd.site/auth/callback?${query}`));
}

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  cookieJar = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a return that completes', () => {
  it('exchanges the code and lands on the destination', async () => {
    cookieJar = [VERIFIER];
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });

    const response = await get('code=abc&next=%2Freview');

    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(response.headers.get('location')).toBe('https://livd.site/review');
  });
});

describe('a return that cannot', () => {
  it('names the browser, without spending a request, when there is no verifier', async () => {
    const response = await get('code=abc&next=%2Freview');

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(
      'https://livd.site/sign-in?error=browser&next=%2Freview',
    );
  });

  it('names the browser when its verifier belongs to another sign-in', async () => {
    cookieJar = [VERIFIER];
    exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { status: 400, code: 'bad_code_verifier', message: 'code challenge does not match' },
    });

    const response = await get('code=abc');

    expect(response.headers.get('location')).toContain('error=browser');
  });

  it('reads a link Supabase refused before any code was issued', async () => {
    const response = await get(
      'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toContain('error=superseded');
  });

  it('acknowledges a cancelled Google consent screen', async () => {
    const response = await get('error=access_denied&error_description=The+user+denied');
    expect(response.headers.get('location')).toContain('error=cancelled');
  });

  it('treats a return with nothing on it as an invalid link', async () => {
    const response = await get('next=%2F');
    expect(response.headers.get('location')).toContain('error=invalid');
  });

  it('never passes a foreign destination through', async () => {
    cookieJar = [VERIFIER];
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });

    const response = await get(`code=abc&next=${encodeURIComponent('//evil.example')}`);

    expect(response.headers.get('location')).toBe('https://livd.site/');
  });
});
