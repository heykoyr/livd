/**
 * Site-level configuration and runtime feature detection.
 *
 * Environment variables are read here and nowhere else, so the rest of the
 * application depends on typed values rather than on `process.env` lookups
 * scattered through it.
 */

export const SITE = {
  name: 'Livd',
  /** The product's one-line promise. Kept here so it is stated identically everywhere. */
  tagline: "Know what it's really like to live there.",
  description:
    'Livd is a property intelligence platform built on real resident experiences. Read what people who actually lived there say — before you commit.',
  url: resolveSiteUrl(),
  locale: 'en',
} as const;

/**
 * The origin this deployment is actually reachable at.
 *
 * `NEXT_PUBLIC_SITE_URL` wins wherever it is set: it is the only value that
 * survives a custom domain. A Vercel preview has no custom domain and gets a
 * generated hostname instead, so `VERCEL_URL` is how it learns its own — with
 * no fallback, every canonical link, the OpenGraph URL and the whole sitemap
 * on a preview would point somewhere else entirely. Only ever consumed on the
 * server, in metadata, `robots.txt` and `sitemap.xml`.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;

  return 'http://localhost:3000';
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
