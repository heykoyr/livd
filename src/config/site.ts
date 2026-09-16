/**
 * Site-level configuration and runtime feature detection.
 *
 * Environment variables are read here and nowhere else, so the rest of the
 * application depends on typed values rather than on `process.env` lookups
 * scattered through it.
 */

/**
 * Livd's canonical production origin, written down exactly once.
 *
 * Everything public resolves against it: canonical tags, Open Graph, the
 * sitemap, `robots.txt`, every link inside an email, and the `emailRedirectTo`
 * on a magic link. Nowhere else in the codebase should contain the string.
 */
export const CANONICAL_ORIGIN = 'https://livd.site';

export const SITE = {
  name: 'Livd',
  /** The product's one-line promise. Kept here so it is stated identically everywhere. */
  tagline: "Know what it's really like to live there.",
  description:
    'Livd is a property intelligence platform built on real resident experiences. Read what people who actually lived there say — before you commit.',
  url: resolveSiteUrl(),
  locale: 'en',
} as const;

/** Trailing slashes are a difference that no consumer of an origin wants. */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * The origin this deployment is actually reachable at.
 *
 * Four rules, in the order a wrong answer would cost most:
 *
 *   1. `NEXT_PUBLIC_SITE_URL` wins wherever it is set. It is the override, and
 *      the only thing that can name an origin the platform does not know about.
 *   2. A Vercel *production* build is the canonical site, whatever else is set.
 *      This is the belt to the environment variable's braces: production is
 *      also the one place where the `VERCEL_URL` fallback below would be
 *      actively harmful, because that variable holds the immutable deployment
 *      hostname — `livd-ff8anczd3-koyrstudio.vercel.app` — not the alias the
 *      domain resolves to. A production deployment that lost its environment
 *      variable would otherwise put that hostname in every canonical tag and
 *      every sign-in email. It now cannot.
 *   3. A preview has no custom domain, so `VERCEL_URL` is how it learns its
 *      own hostname. Without it every canonical link and the whole sitemap on
 *      a preview would point at production, and sign-in would leave the
 *      preview entirely.
 *   4. Otherwise, local development.
 *
 * Consumed on the server only — metadata, `robots.txt`, `sitemap.xml` and the
 * email layer. `VERCEL_ENV` and `VERCEL_URL` are not `NEXT_PUBLIC_`, so they
 * are not inlined into a client bundle; no client component reads `SITE.url`.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return trimTrailingSlash(explicit);

  if (process.env.VERCEL_ENV === 'production') return CANONICAL_ORIGIN;

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${trimTrailingSlash(vercel)}`;

  return 'http://localhost:3000';
}

/**
 * An absolute URL for a path on this site.
 *
 * The one way to build a public link. Scattering `${SITE.url}${path}` is how a
 * domain migration comes to need a repository-wide search — and how one link
 * in one email template gets missed. Everything that has to survive leaving
 * the browser — an email, the sitemap, a canonical tag — goes through here.
 *
 * `path` is a path on this site, beginning with `/`. It is not a redirect
 * target and does no validation: user-supplied destinations go through
 * `safeNextPath` first, and nothing here should ever be given one.
 */
export function absoluteUrl(path = '/'): string {
  return `${SITE.url}${path.startsWith('/') ? path : `/${path}`}`;
}

export type DataBackend = 'local' | 'supabase';

/**
 * Which repository adapter is active.
 *
 * Supabase is used when it is both requested and configured; otherwise the
 * file-backed local store runs, so a fresh clone works without any external
 * service.
 */
export function resolveDataBackend(): DataBackend {
  const requested = process.env.LIVD_DATA_BACKEND;
  const supabaseConfigured =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (requested === 'supabase') {
    if (!supabaseConfigured) {
      throw new Error(
        'LIVD_DATA_BACKEND=supabase but NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. ' +
          'See .env.example.',
      );
    }
    return 'supabase';
  }

  if (requested === 'local') return 'local';

  return supabaseConfigured ? 'supabase' : 'local';
}

/**
 * Whether to offer "Continue with Google".
 *
 * A flag rather than an always-on button because the feature depends on
 * configuration the application cannot see: an OAuth client in Google Cloud and
 * a matching client ID and secret in Supabase. Livd has no way to ask whether
 * those are in place, and a sign-in button that leads to an error page is worse
 * than no button at all — it is the one control a new visitor is most likely to
 * press first.
 *
 * Off unless `NEXT_PUBLIC_GOOGLE_SIGN_IN=true`. Public because the sign-in form
 * is a client component and this decides whether it renders anything.
 */
export function googleSignInEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN === 'true';
}

/** Seeded sample data is shown, and labelled, only when this is on. */
export function showDemoData(): boolean {
  return process.env.LIVD_SHOW_DEMO_DATA !== 'false';
}

/** Pagination and disclosure constants used across the application. */
export const LIMITS = {
  searchPageSize: 12,
  reviewsPerPage: 8,
  suggestionCount: 7,
  maxShortlistCompare: 4,
  reviewBodyMax: 4000,
  reviewBodyMin: 40,
  /** A review may be corrected within this window, then becomes immutable. */
  reviewEditWindowHours: 24,
} as const;

/**
 * The primary navigation.
 *
 * `/places` keeps its route and changes its label. The route is indexed,
 * linked from property pages and present in the sitemap, so migrating it
 * would cost real traffic to rename a menu item — and "Explore" is what the
 * page now does.
 */
export const NAV_LINKS = [
  { href: '/search', label: 'Search' },
  { href: '/places', label: 'Explore' },
  { href: '/why-livd', label: 'Why Livd' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/trust', label: 'Trust & safety' },
] as const;
