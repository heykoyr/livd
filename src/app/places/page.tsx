import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/primitives';
import { getMarket } from '@/config/markets';
import { SITE } from '@/config/site';
import { copy } from '@/content/copy';
import { getCachedLocalities } from '@/server/data/cache';
import { groupBy } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Places',
  description:
    'Browse every city and town where residents have reviewed a property on Livd.',
  alternates: { canonical: `${SITE.url}/places` },
};

/**
 * The location index.
 *
 * An SEO surface as much as a browsing one: someone searching for a
 * neighbourhood by name should land somewhere real, and these pages are what
 * gives a property page an internal link from a stable parent.
 */
export default async function PlacesPage() {
  const localities = await getCachedLocalities();
  const byCountry = groupBy(localities, (locality) => locality.countryCode);

  return (
    <div className="container-shell py-12 md:py-16">
      <div className="max-w-2xl">
        <h1 className="font-display text-display-lg tracking-display text-ink">
          Every place on Livd
        </h1>
        <p className="mt-4 text-body-lg text-ink-muted">
          Livd grows city by city, from whoever writes first. If somewhere you know is missing,
          it is missing because nobody has written about it yet.
        </p>
      </div>

      {localities.length === 0 ? (
        <EmptyState
          className="mt-12"
          title="No places yet"
          description="Once residents start writing, the cities they wrote about will appear here."
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
                  <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
                    <h2 className="font-display text-title-lg tracking-tightish text-ink">
                      {market.name}
                    </h2>
                    <p className="text-label text-ink-subtle">
                      {entries.length} {entries.length === 1 ? market.localityLabel.toLowerCase() : 'places'}
                      {' · '}
                      {copy.property.reviewCount(reviewTotal)}
                    </p>
                  </div>

                  <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {entries
                      .sort((a, b) => b.reviewCount - a.reviewCount)
                      .map((entry) => (
                        <li key={entry.href}>
                          <Link
                            href={entry.href}
                            className="flex items-baseline justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 transition-colors duration-fast hover:border-border-strong hover:bg-surface-sunken/50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-body font-medium text-ink">
                                {entry.locality}
                              </span>
                              {entry.adminArea && (
                                <span className="block truncate text-label text-ink-muted">
                                  {entry.adminArea}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-label tabular text-ink-subtle">
                              {entry.propertyCount}
                            </span>
                          </Link>
                        </li>
                      ))}
                  </ul>
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}
