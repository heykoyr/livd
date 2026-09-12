import type { Metadata } from 'next';
import Link from 'next/link';

import { PlaceGrid, PlaceTile } from '@/components/places/place-tile';
import { EmptyState } from '@/components/ui/primitives';
import { ButtonLink } from '@/components/ui/button';
import { getMarket } from '@/config/markets';
import { SITE } from '@/config/site';
import { copy } from '@/content/copy';
import { countryHref } from '@/lib/places';
import { groupBy } from '@/lib/utils';
import { getCachedLocalities } from '@/server/data/cache';

/**
 * The full index.
 *
 * This is what `/places` used to be, and it is genuinely useful — as an SEO
 * surface, as the thing that gives every city page a stable parent, and as a
 * browse for somebody who wants to see the whole of Livd. What it is not is
 * the front door: an alphabetical list of countries is a description of the
 * database rather than help with a housing decision, so `/places` now leads
 * with search and discovery and links here.
 *
 * Nothing about the old page's URLs changed. Every city link it emitted is
 * the same link, produced by the same helper.
 */
export const metadata: Metadata = {
  title: copy.explore.directoryTitle,
  description:
    'Every city and neighbourhood where residents have reviewed a property on Livd, country by country.',
  alternates: { canonical: `${SITE.url}/places/all` },
};

export default async function PlacesDirectoryPage() {
  const localities = await getCachedLocalities();
  const byCountry = groupBy(localities, (locality) => locality.countryCode);

  return (
    <div className="container-shell py-12 md:py-16">
      <nav aria-label="Breadcrumb" className="mb-5">
        <ol className="flex flex-wrap items-center gap-1.5 text-label text-ink-muted">
          <li>
            <Link href="/places" className="rounded-sm hover:text-ink">
              {copy.nav.explore}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink">{copy.explore.directoryTitle}</li>
        </ol>
      </nav>

      <div className="max-w-2xl">
        <h1 className="font-display text-display-lg tracking-display text-ink">
          {copy.explore.directoryTitle}
        </h1>
        <p className="mt-4 text-body-lg text-ink-muted">{copy.explore.directoryLead}</p>
      </div>

      {localities.length === 0 ? (
        <EmptyState
          className="mt-12"
          title={copy.explore.emptyTitle}
          description={copy.explore.emptyBody}
          action={
            <ButtonLink href="/review" size="lg">
              {copy.nav.writeReview}
            </ButtonLink>
          }
        />
      ) : (
        <div className="mt-12 flex flex-col gap-12">
          {[...byCountry.entries()]
            .sort(([a], [b]) => getMarket(a).name.localeCompare(getMarket(b).name))
            .map(([countryCode, entries]) => {
              const market = getMarket(countryCode);
              const reviewTotal = entries.reduce((sum, entry) => sum + entry.reviewCount, 0);

              return (
                <section key={countryCode}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-border pb-3">
                    <h2 className="min-w-0 font-display text-title-lg tracking-tightish text-ink">
                      <Link
                        href={countryHref(countryCode)}
                        className="rounded-sm underline decoration-transparent underline-offset-4 transition-colors duration-fast hover:decoration-border-strong"
                      >
                        {market.name}
                      </Link>
                    </h2>
                    <p className="text-label text-ink-subtle">
                      {copy.explore.cityCount(entries.length)}
                      {' · '}
                      {copy.property.reviewCount(reviewTotal)}
                    </p>
                  </div>

                  <PlaceGrid className="mt-5">
                    {entries
                      .slice()
                      .sort((a, b) => b.reviewCount - a.reviewCount)
                      .map((entry) => (
                        <li key={entry.href}>
                          <PlaceTile
                            href={entry.href}
                            name={entry.locality}
                            context={entry.adminArea}
                            propertyCount={entry.propertyCount}
                            reviewCount={entry.reviewCount}
                          />
                        </li>
                      ))}
                  </PlaceGrid>
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}
