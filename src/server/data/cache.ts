import 'server-only';

import { unstable_cache, updateTag } from 'next/cache';

import type { PropertyIntelligence, PropertySummary } from '@/types/domain';
import { getRepository } from './index';

/**
 * Read caching.
 *
 * The application shell reads the session cookie, which makes every route
 * dynamic. That is the right trade — a header that flickers between signed-out
 * and signed-in is a worse defect than a slightly slower first byte — but it
 * means the expensive work must be cached at the data layer instead of the
 * route.
 *
 * Aggregating a property's whole review history on every request is that
 * expensive work, so it is cached against a tag that is invalidated the moment
 * a review is published, edited or moderated. A reader therefore never sees a
 * stale score, and a popular property is aggregated once rather than once per
 * visitor.
 */

export const propertyTag = (propertyId: string): string => `property:${propertyId}`;
export const DISCOVERY_TAG = 'discovery';

/**
 * Called from a Server Action after any write that changes what a property's
 * page should say.
 *
 * `updateTag` rather than `revalidateTag` because it expires immediately with
 * read-your-own-writes semantics — someone who has just published a review must
 * see it on the property page they are redirected to, not a cached page that
 * still says nobody has reviewed it.
 *
 * The discovery lists are invalidated too: "recently reviewed" is wrong the
 * instant a review lands, and a homepage that lags behind the property page
 * undermines the record.
 */
export async function invalidateProperty(propertyId: string): Promise<void> {
  updateTag(propertyTag(propertyId));
  updateTag(DISCOVERY_TAG);
}

export const getCachedIntelligence = (propertyId: string): Promise<PropertyIntelligence> =>
  unstable_cache(
    async () => {
      const repository = await getRepository();
      return repository.getPropertyIntelligence(propertyId);
    },
    ['property-intelligence', propertyId],
    { tags: [propertyTag(propertyId)], revalidate: 300 },
  )();

export const getCachedRecentlyReviewed = (limit: number): Promise<PropertySummary[]> =>
  unstable_cache(
    async () => {
      const repository = await getRepository();
      return repository.recentlyReviewed({ limit });
    },
    ['recently-reviewed', String(limit)],
    { tags: [DISCOVERY_TAG], revalidate: 600 },
  )();

export const getCachedMostReviewed = (limit: number): Promise<PropertySummary[]> =>
  unstable_cache(
    async () => {
      const repository = await getRepository();
      return repository.mostReviewed({ limit });
    },
    ['most-reviewed', String(limit)],
    { tags: [DISCOVERY_TAG], revalidate: 600 },
  )();

export const getCachedHighestRated = (limit: number): Promise<PropertySummary[]> =>
  unstable_cache(
    async () => {
      const repository = await getRepository();
      return repository.highestRated({ limit });
    },
    ['highest-rated', String(limit)],
    { tags: [DISCOVERY_TAG], revalidate: 600 },
  )();

export const getCachedLocalities = (countryCode?: string | null) =>
  unstable_cache(
    async () => {
      const repository = await getRepository();
      return repository.listLocalities(countryCode);
    },
    ['localities', countryCode ?? 'all'],
    { tags: [DISCOVERY_TAG], revalidate: 3600 },
  )();
