import type { MetadataRoute } from 'next';

import { SITE } from '@/config/site';

/**
 * robots.txt
 *
 * Property and location pages are the point of the product being indexable.
 * Everything that is authenticated, personal or a duplicate of indexable
 * content is excluded — a crawler following a shortlist or an admin queue would
 * be a privacy failure, and search result pages would compete with the property
 * pages they link to.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/admin/',
          '/account',
          '/account/',
          '/shortlist',
          '/review',
          '/review/',
          '/sign-in',
          '/search',
        ],
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
