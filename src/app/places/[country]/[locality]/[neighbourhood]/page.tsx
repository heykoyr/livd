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
import { countryHref, decodePlaceSegment, localityHref, neighbourhoodHref } from '@/lib/places';
import {
  getCachedNeighbourhoods,
  getCachedPlaceOverview,
  getCachedPlaceProperties,
} from '@/server/data/cache';

/**
 * A neighbourhood.
 *
 * The middle level of the three Livd claims — "what is it like living around
 * here", between a building and a city. It existed as data on every address
 * and as a chip on the city page that linked to a noindex search result, which
 * meant the product asserted a level of intelligence it had no page for.
 *
 * What it shows is aggregated from the properties in it and nothing more. There
 * is no neighbourhood score: averaging property scores would produce a figure
 * that looks like a finding and is really a property mix. The median is stated
 * as a median, with the number of scored properties beside it, and the
 * would-return rate only counts properties with enough evidence to have one.
 */

interface Params {
  country: string;
  locality: string;
  neighbourhood: string;
}

type SearchParams = Record<string, string | string[] | undefined>;

/** `?page=` as a positive integer; anything else is the first page. */
function pageFrom(searchParams: SearchParams): number {
  const raw = Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page;
  const page = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1;
}

/** Figures from the rollup, cards for one page — as on the city page. */
async function load(params: Params, page: number) {
  const countryCode = params.country.toUpperCase();
  const locality = decodePlaceSegment(params.locality);
  const neighbourhood = decodePlaceSegment(params.neighbourhood);
  const scope = { countryCode, locality, neighbourhood };

  const [overview, properties] = await Promise.all([
    getCachedPlaceOverview(scope),
    getCachedPlaceProperties(scope, page),
  ]);

  return { countryCode, locality, neighbourhood, overview, properties };
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

  // The stored spelling, not the URL's, so the title reads properly.
  const name = overview.neighbourhood ?? decodePlaceSegment(resolved.neighbourhood);
  const { propertyCount, reviewCount } = overview;
  const canonical = neighbourhoodHref(countryCode, overview.locality, name);

  return {
    title: `Living in ${name}, ${overview.locality}`,
    description: `${propertyCount} ${
      propertyCount === 1 ? 'property' : 'properties'
    } in ${name}, ${overview.locality} with ${reviewCount} resident ${
      reviewCount === 1 ? 'review' : 'reviews'
    } on Livd. Read what people who lived there say about the area before you commit.`,
    alternates: {
      canonical: absoluteUrl(page > 1 ? `${canonical}?page=${page}` : canonical),
    },
    // Sample-only areas are never indexed, like the sample properties in them.
    ...(overview.demoPropertyCount === propertyCount
      ? { robots: { index: false, follow: true } }
      : {}),
  };
}

export default async function NeighbourhoodPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await params;
  const page = pageFrom(await searchParams);
  const { countryCode, overview, properties } = await load(resolved, page);

  // Nothing here at all, or a page number past the end of what is.
  if (!overview || properties.items.length === 0) notFound();

  const name = overview.neighbourhood ?? decodePlaceSegment(resolved.neighbourhood);
  const locality = overview.locality;
  const adminArea = overview.adminArea;
  const market = getMarket(countryCode);

  const { reviewCount, medianScore, recommendRate, scoredCount, evidencedCount } = overview;

  // Somewhere to go next when this area is not the one. Same city, so the
  // query is scoped rather than a walk of the country.
  const siblings = (
    await getCachedNeighbourhoods({ countryCode, locality, limit: 12 })
  ).filter((entry) => entry.neighbourhood.toLowerCase() !== name.toLowerCase());

  return (
    <div className="container-shell py-12 md:py-16">
      <nav aria-label="Breadcrumb" className="mb-5">
        <ol className="flex flex-wrap items-center gap-1.5 text-label text-ink-muted">
          <li>
            <Link href={countryHref(countryCode)} className="rounded-sm hover:text-ink">
              {market.name}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href={localityHref(countryCode, locality)}
              className="rounded-sm hover:text-ink"
            >
              {locality}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink">{name}</li>
        </ol>
      </nav>

      <div className="max-w-2xl">
        <h1 className="font-display text-display-lg tracking-display text-ink">
          {copy.explore.neighbourhoodHeading(name)}
        </h1>
        <p className="mt-2 text-body-lg text-ink-muted">
          {locality}
          {adminArea ? `, ${adminArea}` : ''} · {market.name}
        </p>
        <p className="mt-4 text-body text-ink-muted">{copy.explore.neighbourhoodLead}</p>
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
          const href = neighbourhoodHref(countryCode, locality, name);
          return target > 1 ? `${href}?page=${target}` : href;
        }}
      />

      {siblings.length > 0 && (
        <section className="mt-14">
          <h2 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            {copy.explore.neighbourhoodElsewhereIn(locality)}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {siblings.map((sibling) => (
              <li key={sibling.href}>
                <Link
                  href={sibling.href}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-label text-ink transition-colors duration-fast hover:border-border-strong hover:bg-surface-sunken"
                >
                  {sibling.neighbourhood}
                  <span className="tabular text-ink-subtle">
                    <span aria-hidden="true">{sibling.reviewCount}</span>
                    <span className="sr-only">
                      {copy.property.reviewCount(sibling.reviewCount)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-14">
        <EmptyState
          title={`Lived in ${name}?`}
          description="Every property on this page is here because somebody took four minutes to write about it. The next person deciding whether to move here is relying on that."
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
