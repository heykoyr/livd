import type { Metadata, Viewport } from 'next';
import { Inter, Newsreader } from 'next/font/google';

import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { ToastProvider } from '@/components/ui/toast';
import { SITE } from '@/config/site';
import { copy } from '@/content/copy';
import { getCurrentUser } from '@/server/auth/session';

import './globals.css';

/**
 * Fonts are self-hosted by `next/font` — no request leaves the user's browser
 * for a third-party font service, which is both a performance and a privacy
 * decision, and is why the CSP can forbid every external origin.
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
  style: ['normal', 'italic'],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    url: SITE.url,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  formatDetection: {
    // Addresses on property pages must not become tap-to-call links.
    telephone: false,
    address: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf8' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0e0d' },
  ],
  colorScheme: 'light dark',
};

/**
 * Applies the stored theme before first paint.
 *
 * Without this the page renders light and then flips, which is the single most
 * visible quality tell in a dark-mode-capable site.
 */
const themeScript = `
(function(){
  try {
    var stored = localStorage.getItem('livd-theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  } catch (e) {}
})();
`.trim();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang={SITE.locale} suppressHydrationWarning className={`${inter.variable} ${newsreader.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        <ToastProvider>
          <a
            href="#main"
            className="sr-only rounded-md bg-brand px-4 py-2 text-canvas focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
          >
            {copy.nav.skipToContent}
          </a>

          <div className="flex min-h-dvh flex-col">
            <SiteHeader user={user} />
            <main id="main" className="flex-1">
              {children}
            </main>
            <SiteFooter />
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
