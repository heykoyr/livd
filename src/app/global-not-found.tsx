import type { Metadata } from 'next';
import { Inter, Newsreader } from 'next/font/google';

import { Logo } from '@/components/brand/logo';
import { SearchCombobox } from '@/components/search/search-combobox';
import { ButtonLink } from '@/components/ui/button';
import { SITE } from '@/config/site';
import { copy } from '@/content/copy';

import './globals.css';

/**
 * The 404 page — every 404, whether from an unmatched URL or a `notFound()`
 * call inside a route.
 *
 * This file owns its own `<html>` and `<body>`, which is the point of it.
 * Next renders a not-found boundary *outside* the root layout, in a bare
 * document with no `lang` attribute and none of the site's styling. That is a
 * genuine WCAG 3.1.1 failure — a screen reader has no idea what language to
 * read the page in — and taking ownership of the document is the only way to
 * put the attribute back.
 *
 * The trade is that a 404 cannot be property-specific. That is a fair price:
 * almost every 404 here is a mistyped or stale property URL from someone
 * looking for a real property, so the search box is what they need either way.
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

export default function GlobalNotFound() {
  return (
    <html
      lang={SITE.locale}
      suppressHydrationWarning
      className={`${inter.variable} ${newsreader.variable}`}
    >
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        <div className="container-shell flex min-h-dvh flex-col">
          <header className="border-b border-border py-5">
            <a
              href="/"
              className="inline-flex items-center rounded-sm"
              aria-label={`${SITE.name} — home`}
            >
              <Logo />
            </a>
          </header>

          <main className="flex flex-1 items-center py-16">
            <div className="w-full max-w-xl">
              <p className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                404
              </p>
              <h1 className="mt-4 font-display text-display-lg tracking-display text-ink">
                {copy.errors.notFoundTitle}
              </h1>
              <p className="mt-4 text-body-lg text-ink-muted">
                The link may be wrong, or the property may have been merged with a duplicate.
                Searching for the address is usually the fastest way back.
              </p>

              <div className="mt-8">
                <SearchCombobox size="lg" />
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <ButtonLink href="/places" variant="secondary">
                  {copy.home.exploreLocations}
                </ButtonLink>
                <ButtonLink href="/" variant="secondary">
                  Go to the homepage
                </ButtonLink>
              </div>
            </div>
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
