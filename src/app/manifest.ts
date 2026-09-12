import type { MetadataRoute } from 'next';

import { SITE } from '@/config/site';

/**
 * The web app manifest, served at `/manifest.webmanifest`.
 *
 * Livd is not a native application and does not pretend to be one. This exists
 * so that a visitor who adds the site to a home screen gets the brand mark and
 * the site's own colours rather than a screenshot of the page in a generic
 * browser chrome — the same reason the Apple touch icon exists.
 *
 * `display: 'browser'` rather than `'standalone'` is deliberate. A property
 * record is a document: people arrive at one from search, share the URL, and
 * expect the back button and the address bar to work. Taking those away to
 * make a website feel like an app would cost more than it buys.
 *
 * The icons are built from `public/brand/livd-mark.svg` by
 * `scripts/build-brand-assets.mjs`. The maskable one is drawn smaller because
 * Android crops adaptive icons to whatever shape the launcher prefers, and a
 * square mark's corners reach a good deal further out than its sides.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — ${SITE.tagline}`,
    short_name: SITE.name,
    description: SITE.description,
    start_url: '/',
    display: 'browser',
    background_color: '#fbfaf8',
    theme_color: '#fbfaf8',
    icons: [
      { src: '/brand/livd-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/livd-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/brand/livd-icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
