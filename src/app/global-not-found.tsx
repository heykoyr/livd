import type { Metadata, Viewport } from 'next';
import { Inter, Newsreader } from 'next/font/google';

import { Logo } from '@/components/brand/logo';
import { PageNotFound } from '@/components/layout/page-not-found';
import { ThemeScript } from '@/components/layout/theme-script';
import { SITE } from '@/config/site';
import { copy } from '@/content/copy';
import { THEME_VIEWPORT } from '@/lib/theme';

import './globals.css';

/**
 * The 404 for a URL that matches no route at all.
 *
 * Only that. A `notFound()` call inside a route never reaches here — it has
 * matched a route already — and is answered by `app/not-found.tsx`, inside the
 * site's own chrome. This file used to claim it served both, which was never
 * true and left those routes showing the framework's built-in 404 between
 * Livd's header and footer.
 *
 * It owns its own `<html>` and `<body>`, which is the point of it. Next
 * answers an unmatched URL without rendering the root layout, so without this
 * the document would have no `lang` attribute and none of the site's styling —
 * a genuine WCAG 3.1.1 failure, since a screen reader would not know what
 * language to read the page in.
 *
 * The trade is that this 404 cannot be property-specific, and the chrome is a
 * logo and a footer line rather than the site's real header: there is no
 * router here to hand a client navigation to. Both are a fair price for a
 * document that is correct on its own.
 */

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});

const newsreader = Newsreader({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-newsreader',
  display: 'swap',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: `${copy.errors.notFoundTitle} · ${SITE.name}`,
  robots: { index: false, follow: false },
};

// Bypassing the root layout bypasses its theme too, so this document carries
// the same viewport and the same pre-paint script. A visitor who chose dark
// should not land on a light 404.
export const viewport: Viewport = THEME_VIEWPORT;

export default function GlobalNotFound() {
  return (
    <html
      lang={SITE.locale}
      suppressHydrationWarning
      className={`${inter.variable} ${newsreader.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        <div className="container-shell flex min-h-dvh flex-col">
          <header className="border-b border-border py-5">
            {/* A real <a>, not next/link. This file renders its own <html>
                and <body> outside the application shell, so there is no router
                to hand a client navigation to — the way back is a fresh
                document load. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex items-center rounded-sm"
              aria-label={`${SITE.name} — home`}
            >
              <Logo />
            </a>
          </header>

          <main className="flex flex-1 items-center py-16">
            <PageNotFound />
          </main>

          <footer className="border-t border-border py-6">
            <p className="text-micro text-ink-subtle">
              {copy.footer.rights(new Date().getFullYear())}
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
