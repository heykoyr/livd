import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which origin Livd believes it is served from.
 *
 * This is the value behind every canonical tag, the sitemap, `robots.txt`, the
 * link in every email and the `emailRedirectTo` on every magic link. It has
 * been wrong twice in this project's history, and both times the symptom
 * appeared somewhere else entirely: once as a production sign-in email that
 * pointed at `localhost:3000`, and once as a canonical URL naming a Vercel
 * deployment hostname rather than the domain people actually type.
 *
 * `SITE.url` is resolved once, at module load, from environment variables. So
 * every case here resets the module registry and re-imports — reading the
 * constant a second time in the same process would just hand back the first
 * answer.
 */

const ENV_KEYS = ['NEXT_PUBLIC_SITE_URL', 'VERCEL_ENV', 'VERCEL_URL'] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

async function siteUrl(): Promise<string> {
  const { SITE } = await import('@/config/site');
  return SITE.url;
}

describe('the canonical origin', () => {
  it('is livd.site, over HTTPS, with no trailing slash', async () => {
    const { CANONICAL_ORIGIN } = await import('@/config/site');

    expect(CANONICAL_ORIGIN).toBe('https://livd.site');
    expect(CANONICAL_ORIGIN.startsWith('https://')).toBe(true);
    expect(CANONICAL_ORIGIN.endsWith('/')).toBe(false);
  });

  it('is the apex, not www — one host is canonical and the other redirects', async () => {
    const { CANONICAL_ORIGIN } = await import('@/config/site');

    expect(new URL(CANONICAL_ORIGIN).hostname).toBe('livd.site');
  });
});

describe('resolving the origin this deployment is served from', () => {
  it('uses NEXT_PUBLIC_SITE_URL wherever it is set', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://livd.site';

    await expect(siteUrl()).resolves.toBe('https://livd.site');
  });

  it('trims a trailing slash, so no link is ever built with a double one', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://livd.site///';

    await expect(siteUrl()).resolves.toBe('https://livd.site');
  });

  /**
   * The regression this file was written for.
   *
   * `VERCEL_URL` on a production deployment is the *immutable* deployment
   * hostname, not the alias the domain resolves to. Falling back to it in
   * production put `livd-<hash>-koyrstudio.vercel.app` into canonical tags and
   * sign-in emails. Production is now canonical by construction.
   */
  it('falls back to the canonical domain in production, never to VERCEL_URL', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_URL = 'livd-ff8anczd3-koyrstudio.vercel.app';

    await expect(siteUrl()).resolves.toBe('https://livd.site');
  });

  it('still lets a preview name itself, so sign-in stays on the preview', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_URL = 'livd-git-a-branch-koyrstudio.vercel.app';

    await expect(siteUrl()).resolves.toBe('https://livd-git-a-branch-koyrstudio.vercel.app');
  });

  it('is localhost in development, which must keep working', async () => {
    await expect(siteUrl()).resolves.toBe('http://localhost:3000');
  });
});

describe('absoluteUrl', () => {
  it('builds a link on the configured origin', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://livd.site';
    const { absoluteUrl } = await import('@/config/site');

    expect(absoluteUrl('/property/the-franklin')).toBe('https://livd.site/property/the-franklin');
  });

  it('tolerates a path given without its leading slash', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://livd.site';
    const { absoluteUrl } = await import('@/config/site');

    expect(absoluteUrl('account/reviews')).toBe('https://livd.site/account/reviews');
  });

  it('defaults to the home page', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://livd.site';
    const { absoluteUrl } = await import('@/config/site');

    expect(absoluteUrl()).toBe('https://livd.site/');
  });
});
