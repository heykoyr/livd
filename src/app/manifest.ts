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
 * The icons are the official Livd symbol on the paper field, rendered from
 * `public/brand/logo/livd-symbol.svg` by `scripts/build-brand-assets.mjs`.
 *
 * One file serves both purposes. A maskable icon is cropped to whatever shape
 * the launcher prefers, so everything that matters has to sit inside the
 * middle 80% — and the symbol, at the framing it is supplied with, already
 * does: its furthest corner reaches 35% out from the centre against the 40%
 * the safe zone allows. A second, smaller drawing would only be the same
 * artwork at a size nothing needs.
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
      { src: '/brand/icons/livd-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icons/livd-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/brand/icons/livd-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
