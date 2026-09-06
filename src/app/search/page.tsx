import type { Metadata } from 'next';
import { createHash } from 'node:crypto';

import { PropertyCard } from '@/components/property/property-card';
import { SearchCombobox } from '@/components/search/search-combobox';
import { SearchFilters } from '@/components/search/search-filters';
import { ButtonLink } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { buildSearchHref, parseSearchFilters } from '@/lib/validation/search';
import { getRepository } from '@/server/data';

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
      : copy.search.heading,
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

  const repository = await getRepository();
  const results = await repository.searchProperties(filters);

  // Analytics: a hash and a count, never the raw query attached to a person.
  // What the product needs to know is which places it has no data for.
  if (filters.query.length > 0) {
    void repository
      .recordSearch({
        queryHash: createHash('sha256').update(filters.query.toLowerCase()).digest('hex').slice(0, 24),
        countryCode: filters.countryCode,
        locality: filters.locality,
        resultCount: results.total,
      })
      .catch(() => undefined);
  }

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

      {results.items.length === 0 ? (
        <EmptyState
          className="mt-10"
          title={copy.search.noResultsTitle}
          description={copy.search.noResultsBody}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <ButtonLink href="/review/property/new">{copy.search.addProperty}</ButtonLink>
              <ButtonLink href="/places" variant="secondary">
                {copy.home.exploreLocations}
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
    </div>
  );
}
