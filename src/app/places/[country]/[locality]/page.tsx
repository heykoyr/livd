import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PropertyGrid } from '@/components/places/place-tile';
import { PropertyCard } from '@/components/property/property-card';
import { ButtonLink } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, Stat } from '@/components/ui/primitives';
import { getMarket } from '@/config/markets';
import { absoluteUrl } from '@/config/site';
import { copy } from '@/content/copy';
import { formatPercent } from '@/lib/format';
import {
  countryHref,
  decodePlaceSegment,
  localityHref,
  neighbourhoodHref,
} from '@/lib/places';
import {
  getCachedNeighbourhoods,
  getCachedPlaceOverview,
  getCachedPlaceProperties,
} from '@/server/data/cache';
import type { PropertySummary } from '@/types/domain';

/**
 * A city.
 *
 * Server-rendered and indexable — this is the parent a property page hangs off,
 * and the page a search engine is most likely to surface for "reviews in
 * <city>". It is also the middle of the walk down: Explore or a country page
 * leads here, and the neighbourhood chips below lead on to a real area page
 * rather than, as they used to, a noindex search result.
 */

interface Params {
  country: string;
  locality: string;
}

type SearchParams = Record<string, string | string[] | undefined>;

/** `?page=` as a positive integer; anything else is the first page. */
function pageFrom(searchParams: SearchParams): number {
  const raw = Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page;
  const page = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1;
}

/**
 * The page's figures and one page of its properties.
 *
 * This used to load every property in the city and every review of every one
 * of them, then count on the server. That was fine at a handful of properties
 * and is not at two hundred: the figures now come from the database's rollup
 * (`livd_place_overview`) and only the twenty-four cards on screen load their
 * reviews.
 */
async function load(params: Params, page: number) {
  const countryCode = params.country.toUpperCase();
  const locality = decodePlaceSegment(params.locality);
  const scope = { countryCode, locality };

  const [overview, properties] = await Promise.all([
    getCachedPlaceOverview(scope),
    getCachedPlaceProperties(scope, page),
  ]);

  return { countryCode, locality, overview, properties };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const resolved = await params;
  const page = pageFrom(await searchParams);
  const { countryCode, overview } = await load(resolved, page);

  if (!overview) {
    return { title: 'Place not found', robots: { index: false, follow: false } };
  }

  const market = getMarket(countryCode);
  // Use the stored spelling rather than the URL's, so the title reads properly.
  const name = overview.locality;
  const { propertyCount, reviewCount } = overview;
  const canonical = localityHref(countryCode, name);

  return {
    title: `Renting in ${name}, ${market.name}`,
    description: `${propertyCount} ${
      propertyCount === 1 ? 'property' : 'properties'
    } in ${name} with ${reviewCount} resident ${
      reviewCount === 1 ? 'review' : 'reviews'
    } on Livd. Read what people who lived there say before you commit.`,
    alternates: {
      canonical: absoluteUrl(page > 1 ? `${canonical}?page=${page}` : canonical),
    },
    // A city made only of sample properties is fabricated content, and follows
    // the rule their own pages do: readable, linked, never indexed.
    ...(overview.demoPropertyCount === propertyCount
      ? { robots: { index: false, follow: true } }
      : {}),
  };
}

export default async function LocalityPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await params;
  const page = pageFrom(await searchParams);
  const { countryCode, locality, overview, properties } = await load(resolved, page);

  // Nothing here at all, or a page number past the end of what is.
  if (!overview || properties.items.length === 0) notFound();

  const market = getMarket(countryCode);
  const name = overview.locality;

  const { reviewCount, medianScore, recommendRate, scoredCount, evidencedCount } = overview;

  /**
   * The neighbourhoods this city's properties sit in, from the same aggregate
   * the Explore page ranks by — every one of them, not just those on the page
   * of properties below.
   */
  const neighbourhoods = (await getCachedNeighbourhoods({ countryCode, locality })).map(
    (entry) => ({ name: entry.neighbourhood, reviewCount: entry.reviewCount }),
  );

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
          <li>
            <Link href={countryHref(countryCode)} className="rounded-sm hover:text-ink">
              {market.name}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink">{name}</li>
        </ol>
      </nav>

      <div className="max-w-2xl">
        <h1 className="font-display text-display-lg tracking-display text-ink">
          Renting in {name}
        </h1>
        <p className="mt-4 text-body-lg text-ink-muted">
          What residents say about living here, from the people who did.
        </p>
      </div>

      <dl className="mt-9 grid grid-cols-2 gap-6 border-y border-border py-6 sm:grid-cols-4">
        <Stat label="Properties" value={overview.propertyCount} />
        <Stat label="Resident reviews" value={reviewCount} />
        <Stat
          label="Median score"
          value={medianScore ?? '—'}
          hint={
            medianScore === null
              ? 'not enough scored properties'
              : `across ${scoredCount} scored ${scoredCount === 1 ? 'property' : 'properties'}`
          }
        />
        <Stat
          label="Would return"
          value={recommendRate === null ? '—' : formatPercent(recommendRate, countryCode)}
          hint={
            recommendRate === null
              ? 'not enough evidence yet'
              : `across ${evidencedCount} well-reviewed ${
                  evidencedCount === 1 ? 'property' : 'properties'
                }`
          }
        />
      </dl>

      {neighbourhoods.length > 0 && (
        <section className="mt-8">
          <h2 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            {copy.explore.neighbourhoodsTitle}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {neighbourhoods.map((neighbourhood) => (
              <li key={neighbourhood.name}>
                <Link
                  href={neighbourhoodHref(countryCode, name, neighbourhood.name)}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-label text-ink transition-colors duration-fast hover:border-border-strong hover:bg-surface-sunken"
                >
                  {neighbourhood.name}
                  <span className="tabular text-ink-subtle">
                    <span aria-hidden="true">{neighbourhood.reviewCount}</span>
                    <span className="sr-only">
                      {copy.property.reviewCount(neighbourhood.reviewCount)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="mt-12 font-display text-title-lg tracking-tightish text-ink">
        {copy.explore.propertiesIn(name)}
      </h2>

      <PropertyGrid className="mt-5">
        {properties.items.map((summary) => (
          <li key={summary.property.id}>
            <PropertyCard summary={summary} />
          </li>
        ))}
      </PropertyGrid>

      <Pagination
        className="mt-8"
        page={properties.page}
        pageSize={properties.pageSize}
        total={properties.total}
        buildHref={(target) => {
          const href = localityHref(countryCode, name);
          return target > 1 ? `${href}?page=${target}` : href;
        }}
      />

      <div className="mt-14">
        <EmptyState
          title={`Lived somewhere in ${name}?`}
          description="Every property on this page is here because someone took four minutes to write about it. The next person deciding where to live in this city is relying on that."
          action={
            <ButtonLink href="/review" size="lg">
              {copy.nav.writeReview}
            </ButtonLink>
          }
        />
      </div>
    </div>
  );
}

/** Helper for the summary card list. */
export type { PropertySummary };
