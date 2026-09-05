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

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts; no third-party script origins are allowed.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  // Tailwind emits a static stylesheet; inline styles are used only for CSS custom
  // properties on data-visualisation elements (bar widths etc.).
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Supabase is the only permitted network destination when configured.
  `connect-src 'self'${process.env.NEXT_PUBLIC_SUPABASE_URL ? ` ${process.env.NEXT_PUBLIC_SUPABASE_URL}` : ''}${isDev ? ' ws: http://localhost:*' : ''}`,
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
