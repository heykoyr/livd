import type { MetadataRoute } from 'next';

import { SITE } from '@/config/site';
import { countryHref } from '@/lib/places';
import { getRepository } from '@/server/data';

/**
 * Sitemap.
 *
 * Includes only what should be indexed: the marketing surface, the three
 * levels of place page and real property pages. Deliberately excluded are
 * every authenticated route, search result pages (they would compete with the
 * property pages they link to) and demo properties, which are fabricated and
 * must never reach an index.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE.url}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE.url}/places`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE.url}/places/all`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE.url}/why-livd`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE.url}/how-it-works`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE.url}/trust`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE.url}/for-owners`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE.url}/legal/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE.url}/legal/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE.url}/legal/content-policy`, changeFrequency: 'yearly', priority: 0.3 },
  ];

  try {
    const repository = await getRepository();
    const [localities, neighbourhoods, properties] = await Promise.all([
      repository.listLocalities(),
      repository.listNeighbourhoods(),
      repository.searchProperties({
        query: '',
        countryCode: null,
        locality: null,
        propertyTypes: [],
        minScore: null,
        minReviews: null,
        verifiedOnly: false,
        sort: 'reviews_desc',
        // Sitemaps cap at 50,000 URLs; pagination arrives with the volume.
        page: 1,
      }),
    ]);

    // Places made only of sample properties are left out, for the reason the
    // sample properties themselves are: fabricated content must never reach an
    // index. They stay reachable by link; they are simply not advertised.
    const realLocalities = localities.filter(
      (locality) => locality.propertyCount > locality.demoPropertyCount,
    );
    const realNeighbourhoods = neighbourhoods.filter(
      (neighbourhood) => neighbourhood.propertyCount > neighbourhood.demoPropertyCount,
    );

    const localityRoutes: MetadataRoute.Sitemap = realLocalities.map((locality) => ({
      url: `${SITE.url}${locality.href}`,
      changeFrequency: 'weekly',
      priority: 0.7,
    }));

    // One entry per country that actually has a city in it, so no country page
    // in the sitemap resolves to an empty state.
    const countryRoutes: MetadataRoute.Sitemap = [
      ...new Set(realLocalities.map((locality) => locality.countryCode)),
    ].map((countryCode) => ({
      url: `${SITE.url}${countryHref(countryCode)}`,
      changeFrequency: 'weekly',
      priority: 0.6,
    }));

    const neighbourhoodRoutes: MetadataRoute.Sitemap = realNeighbourhoods.map((neighbourhood) => ({
      url: `${SITE.url}${neighbourhood.href}`,
      changeFrequency: 'weekly',
      priority: 0.7,
    }));

    const propertyRoutes: MetadataRoute.Sitemap = properties.items
      .filter((summary) => !summary.property.isDemo)
      .map((summary) => ({
        url: `${SITE.url}/property/${summary.property.slug}`,
        lastModified: summary.intelligence.lastReviewAt
          ? new Date(summary.intelligence.lastReviewAt)
          : undefined,
        changeFrequency: 'weekly',
        priority: 0.9,
      }));

    return [
      ...staticRoutes,
      ...countryRoutes,
      ...localityRoutes,
      ...neighbourhoodRoutes,
      ...propertyRoutes,
    ];
  } catch {
    // A sitemap that fails to build must not take the site down with it.
    return staticRoutes;
  }
}
