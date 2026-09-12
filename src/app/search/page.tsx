import type { Metadata } from 'next';
import Link from 'next/link';

import { PropertyCard } from '@/components/property/property-card';
import { SearchCombobox } from '@/components/search/search-combobox';
import { NearbyProperties } from '@/components/search/nearby-properties';
import { SearchFilters } from '@/components/search/search-filters';
import { SearchStart } from '@/components/search/search-start';
import { ButtonLink } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/primitives';
import { getMarket } from '@/config/markets';
import { copy } from '@/content/copy';
import {
  buildSearchHref,
  hasSearchIntent,
  parseSearchFilters,
} from '@/lib/validation/search';
import { saltedHash } from '@/lib/safety/rate-limit';
import { getCurrentUser } from '@/server/auth/session';
import { getRepository } from '@/server/data';
import { viewerCountry } from '@/server/geo/viewer-country';

/**
 * Search.
 *
 * Search answers "I know what I want to investigate". Explore answers "I am
 * working out where I might live". They share the data layer and share their
 * components, and they are not the same page: this one is query-driven and
 * utilitarian, and it renders nothing until it has been asked something.
 *
 * That last part is the fix for what this page used to do. An empty query
 * matched every property, so a bare `/search` returned the whole database
 * ordered by review count — a page headed "18 properties" listing buildings in
 * Brooklyn, Berlin, Sydney and Lagos, related to each other and to the visitor
 * by nothing at all. A filter is still intent, so a city link from Explore
 * keeps working; a bare visit gets a starting state instead.
 *
 * On reach: search is global, always. The visitor's country is passed as a
 * ranking preference and never as a filter — `SearchRanking` explains why that
 * distinction has a type rather than a comment, and
 * `tests/search/global-reach.test.ts` holds the adapters to it.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.slice(0, 80) : '';

  return {
    title: query ? `${query} — ${copy.search.title}` : copy.search.heading,
    description: query
      ? `Resident reviews and property intelligence for “${query}” on Livd.`
      : copy.search.startLead,
    // Result pages should not compete with property pages in an index.
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseSearchFilters(params);

  // Resolved for both branches: the starting state offers local context, and a
  // query uses it to order equally-relevant matches. Never to narrow either.
  const user = await getCurrentUser();
  const preferCountryCode = await viewerCountry(user);

  if (!hasSearchIntent(filters)) {
    return <SearchStart preferCountryCode={preferCountryCode} />;
  }

  const repository = await getRepository();
  const results = await repository.searchProperties(filters, { preferCountryCode });

  // Analytics: a hash and a count, never the raw query attached to a person.
  // What the product needs to know is which places it has no data for.
  //
  // Salted, because a search is a street name or a building — a space small
  // enough that an unsalted digest is reversible by anyone who can read the
  // column. Nothing here identifies who searched, and that is what actually
  // protects the person; the salt is what stops the row disclosing *what* was
  // searched to someone reading a backup.
  if (filters.query.length > 0) {
    void repository
      .recordSearch({
        queryHash: saltedHash(filters.query.toLowerCase()).slice(0, 24),
        countryCode: filters.countryCode,
        locality: filters.locality,
        resultCount: results.total,
      })
      .catch(() => undefined);
  }

  // Only worth saying when it could have changed the order: a preference the
  // searcher overrode with their own country filter changed nothing.
  const preferredPlace =
    preferCountryCode && !filters.countryCode && results.total > 1
      ? getMarket(preferCountryCode).name
      : null;

  return (
    <div className="container-shell py-10 md:py-14">
      <div className="max-w-2xl">
        <h1 className="font-display text-display-md tracking-display text-ink">
          {filters.query ? copy.search.resultsFor(filters.query) : copy.search.heading}
        </h1>
      </div>

      <div className="mt-6 max-w-2xl">
        <SearchCombobox initialQuery={filters.query} />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <p aria-live="polite" className="text-label text-ink-muted">
          {copy.search.resultCount(results.total)}
        </p>
        <SearchFilters filters={filters} />
      </div>

      {results.correctedFrom && (
        <p className="mt-4 rounded-md border border-info/25 bg-info-soft px-3.5 py-2.5 text-label text-info">
          {copy.search.correctedFrom(results.correctedFrom)}
        </p>
      )}

      {/* Said out loud, because a reordering nobody was told about looks like
          an arbitrary order. */}
      {preferredPlace && (
        <p className="mt-4 text-label text-ink-subtle">
          {copy.search.preferredNote(preferredPlace)}
        </p>
      )}

      {results.items.length === 0 ? (
        <EmptyState
          className="mt-10"
          title={copy.search.noResultsTitle}
          description={copy.search.noResultsBody}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <ButtonLink href="/review/new-property">{copy.search.addProperty}</ButtonLink>
              <ButtonLink href="/places" variant="secondary">
                {copy.nav.explore}
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <>
          {/* The results are a section, and each card's name is an <h3>. Without
              a heading here the document jumps h1 to h3 — the count above is a
              <p> because it is a live region, not a title. */}
          <h2 className="sr-only">{copy.search.resultCount(results.total)}</h2>

          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {results.items.map((summary) => (
              <li key={summary.property.id}>
                <PropertyCard summary={summary} />
              </li>
            ))}
          </ul>

          <Pagination
            className="mt-12"
            page={results.page}
            pageSize={results.pageSize}
            total={results.total}
            buildHref={(page) => buildSearchHref(filters, { page })}
          />
        </>
      )}

      {/* Below the results, never above them, and never triggered by arriving
          here. Search is the primary way to use Livd and must not look as
          though it needs a location to work — because it does not. */}
      <NearbyProperties />

      <p className="mt-8 text-micro text-ink-subtle">
        {copy.search.globalNote}{' '}
        <Link href="/places" className="rounded-sm underline underline-offset-2 hover:text-ink">
          {copy.nav.explore}
        </Link>
      </p>
    </div>
  );
}
