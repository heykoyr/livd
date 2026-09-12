import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UserProfile } from '@/types/domain';

/**
 * Which country a visitor is shown first.
 *
 * The product requirement this guards is the one easiest to break by
 * accident: local by default must never become local only. So what is
 * asserted here is not just the precedence but the refusals — a country code
 * Livd has no market for, a forged or malformed header, and a request with no
 * header at all all resolve to the global view rather than to a wrong country
 * or an exception.
 *
 * Nothing this resolves is ever used for authorisation. See
 * `src/server/geo/viewer-country.ts`.
 */

function profile(countryCode: UserProfile['countryCode']): UserProfile {
  return {
    id: 'user-1',
    email: 'someone@example.test',
    role: 'resident',
    status: 'active',
    countryCode,
    preferredLocale: 'en',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

/** Loads the module with `headers()` returning exactly this header set. */
async function withHeaders(headers: Record<string, string>) {
  vi.resetModules();
  vi.doMock('next/headers', () => ({
    headers: async () => ({
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    }),
  }));
  return import('@/server/geo/viewer-country');
}

/** Loads the module with no request scope at all, as a build-time render has. */
async function withoutRequestScope() {
  vi.resetModules();
  vi.doMock('next/headers', () => ({
    headers: async () => {
      throw new Error('`headers` was called outside a request scope');
    },
  }));
  return import('@/server/geo/viewer-country');
}

afterEach(() => {
  vi.doUnmock('next/headers');
  vi.resetModules();
});

describe('edgeCountry', () => {
  it('reads the platform header', async () => {
    const { edgeCountry } = await withHeaders({ 'x-vercel-ip-country': 'NG' });
    expect(await edgeCountry()).toBe('NG');
  });

  it('reads Cloudflare’s header too', async () => {
    const { edgeCountry } = await withHeaders({ 'cf-ipcountry': 'gb' });
    expect(await edgeCountry()).toBe('GB');
  });

  it('prefers the platform header when both are present', async () => {
    const { edgeCountry } = await withHeaders({
      'x-vercel-ip-country': 'CA',
      'cf-ipcountry': 'AU',
    });
    expect(await edgeCountry()).toBe('CA');
  });

  it('is null when no header carries a country', async () => {
    const { edgeCountry } = await withHeaders({});
    expect(await edgeCountry()).toBeNull();
  });

  it('refuses a country Livd has no market for', async () => {
    // A market Livd cannot format an address for would produce a country page
    // with a neutral label and nothing in it. The global view is the honest
    // answer instead.
    const { edgeCountry } = await withHeaders({ 'x-vercel-ip-country': 'JP' });
    expect(await edgeCountry()).toBeNull();
  });

  it('refuses anything that is not two letters', async () => {
    for (const value of ['', ' ', 'XX1', 'N', 'NGA', '??', 'NG,GB', '<script>']) {
      const { edgeCountry } = await withHeaders({ 'x-vercel-ip-country': value });
      expect(await edgeCountry(), value).toBeNull();
    }
  });

  it('tolerates whitespace and case, which proxies add', async () => {
    const { edgeCountry } = await withHeaders({ 'x-vercel-ip-country': ' ng ' });
    expect(await edgeCountry()).toBe('NG');
  });

  it('is null rather than an exception with no request scope', async () => {
    const { edgeCountry } = await withoutRequestScope();
    await expect(edgeCountry()).resolves.toBeNull();
  });
});

describe('viewerCountry', () => {
  it('prefers what the account says over where the request came from', async () => {
    // The only signal somebody actually typed, and the only one that survives
    // them being abroad for a fortnight.
    const { viewerCountry } = await withHeaders({ 'x-vercel-ip-country': 'GB' });
    expect(await viewerCountry(profile('NG'))).toBe('NG');
  });

  it('falls back to the request when the account names no country', async () => {
    const { viewerCountry } = await withHeaders({ 'x-vercel-ip-country': 'GB' });
    expect(await viewerCountry(profile(null))).toBe('GB');
  });

  it('falls back to the request for a signed-out visitor', async () => {
    const { viewerCountry } = await withHeaders({ 'x-vercel-ip-country': 'AU' });
    expect(await viewerCountry(null)).toBe('AU');
  });

  it('ignores an account country Livd has no market for', async () => {
    const { viewerCountry } = await withHeaders({ 'x-vercel-ip-country': 'GB' });
    expect(await viewerCountry(profile('JP' as UserProfile['countryCode']))).toBe('GB');
  });

  it('is null when nothing resolves, which is the global view', async () => {
    const { viewerCountry } = await withHeaders({});
    expect(await viewerCountry(null)).toBeNull();
  });
});
