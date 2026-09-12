import Link from 'next/link';

import { NearbyProperties } from '@/components/search/nearby-properties';
import { SearchCombobox } from '@/components/search/search-combobox';
import { Card } from '@/components/ui/primitives';
import { getMarket } from '@/config/markets';
import { copy } from '@/content/copy';
import { getCachedLocalities } from '@/server/data/cache';

/**
 * Search, before it has been asked anything.
 *
 * The page this replaces ran a query regardless, and an empty query matched
 * everything — so arriving at `/search` produced the entire database ordered by
 * review count. This runs no property query at all. What it offers instead is
 * the three things that are genuinely useful before a question exists: the
 * field itself, the visitor's own recent searches (already kept in their
 * browser by the combobox, never on a server), and a way into local context.
 *
 * The city links are the one read it does make, and it is the hour-cached
 * locality rollup the rest of the product already uses rather than a query of
 * its own. They are scoped to the visitor's country when one resolved, because
 * a starting state is exactly where a local default belongs — and every one of
 * them is an ordinary search URL, so following one lands on real results.
 */
export async function SearchStart({
  preferCountryCode,
}: {
  preferCountryCode: string | null;
}) {
  // Scoped when we know the country, global otherwise. Both are cached at the
  // data layer against a shared key, so this costs one query an hour.
  const localities = await getCachedLocalities(preferCountryCode);
  const place = preferCountryCode ? getMarket(preferCountryCode).name : null;
  const suggestions = localities.slice(0, 8);

  return (
    <div className="container-shell py-12 md:py-16">
      <div className="max-w-2xl">
        <h1 className="font-display text-display-md tracking-display text-ink">
          {copy.search.startTitle}
        </h1>
        <p className="mt-4 text-body-lg text-ink-muted">{copy.search.startLead}</p>
      </div>

      <div className="mt-8 max-w-2xl">
        <SearchCombobox size="lg" autoFocus />
        <p className="mt-3 text-label text-ink-subtle">{copy.search.startHint}</p>
      </div>

      {suggestions.length > 0 && (
        <section className="mt-12" aria-labelledby="search-start-places">
          <h2
            id="search-start-places"
            className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
          >
            {place
              ? `${copy.search.startExamplesLabel} — ${place}`
              : copy.search.startExamplesLabel}
          </h2>

          {/* Search URLs, not place pages: this is a starting state for
              searching, so following one should demonstrate what search does. */}
          <ul className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((locality) => (
              <li key={locality.href}>
                <Link
                  href={`/search?q=${encodeURIComponent(locality.locality)}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-label text-ink transition-colors duration-fast hover:border-border-strong hover:bg-surface-sunken"
                >
                  {locality.locality}
                  <span className="tabular text-ink-subtle">
                    <span aria-hidden="true">{locality.propertyCount}</span>
                    <span className="sr-only">
                      {copy.explore.propertyCount(locality.propertyCount)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Inert until pressed. Search needs no location to work, and this must
          not suggest otherwise. */}
      <div className="mt-12">
        <NearbyProperties />
      </div>

      <Card className="mt-12 p-6 md:p-8">
        <h2 className="font-display text-title-lg tracking-tightish text-ink">
          {copy.search.startExploreTitle}
        </h2>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          {copy.search.startExploreLead}
        </p>
        <Link
          href="/places"
          className="mt-4 inline-block rounded-sm text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
        >
          {copy.search.startExploreCta}
        </Link>
      </Card>
    </div>
  );
}
