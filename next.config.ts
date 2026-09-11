import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * The CSP is intentionally strict. Livd renders user-submitted text but never
 * user-submitted markup, so no inline script execution is required beyond the
 * framework's own hydration payload (which Next emits as inline <script> tags —
 * hence 'unsafe-inline' for script-src in development only; production relies on
 * Next's nonce-free static payload plus 'strict-dynamic' being unnecessary here
 * because we ship no third-party scripts at all).
 */
const isDev = process.env.NODE_ENV === 'development';

/**
 * Cloudflare Turnstile, and only when it is configured.
 *
 * This is the first third-party script origin Livd has ever allowed, so it is
 * gated on the site key rather than written in permanently: a deployment with
 * no bot protection configured keeps the CSP it had before, with no external
 * script, frame or connect origin at all.
 *
 * Three directives, because the widget needs all three — the api.js loader,
 * the iframe the challenge renders in, and the calls it makes back to
 * Cloudflare to solve it. Granting script-src alone produces a widget that
 * silently never issues a token, which then reads as a bot-protection outage
 * rather than as a CSP problem.
 */
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const turnstile = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? ` ${TURNSTILE_ORIGIN}` : '';

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts. The only third-party origin ever
  // permitted here is Turnstile, and only when a site key is set.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}${turnstile}`,
  // Tailwind emits a static stylesheet; inline styles are used only for CSS custom
  // properties on data-visualisation elements (bar widths etc.).
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Supabase is the only permitted network destination when configured.
  `connect-src 'self'${process.env.NEXT_PUBLIC_SUPABASE_URL ? ` ${process.env.NEXT_PUBLIC_SUPABASE_URL}` : ''}${turnstile}${isDev ? ' ws: http://localhost:*' : ''}`,
  // The challenge renders in an iframe from Cloudflare. Nothing else may be
  // framed, and `frame-ancestors 'none'` still forbids framing Livd.
  `frame-src 'self'${turnstile}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // A stray package-lock.json in a parent directory would otherwise be treated
  // as the workspace root. This pins it to the project.
  turbopack: {
    root: __dirname,
  },

  // Never leak stack traces or source paths to the client in production.
  productionBrowserSourceMaps: false,

  poweredByHeader: false,

  experimental: {
    // Server Actions are the write path for every mutation in the app.
    serverActions: {
      bodySizeLimit: '1mb',
    },

    // Lets app/global-not-found.tsx own the entire 404 document.
    //
    // Without it, Next renders a not-found boundary *outside* the root layout,
    // in a shell with no lang attribute and none of the site's chrome — a real
    // WCAG 3.1.1 failure on any mistyped property URL. Owning the document is
    // the only way to put the lang attribute back.
    globalNotFound: true,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self), interest-cohort=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
