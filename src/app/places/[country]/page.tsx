import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NeighbourhoodGroups } from '@/components/places/neighbourhood-groups';
import { PlaceGrid, PlaceTile, PropertyGrid } from '@/components/places/place-tile';
import { PropertyCard } from '@/components/property/property-card';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, Section, Stat } from '@/components/ui/primitives';
import { SearchCombobox } from '@/components/search/search-combobox';
import { MARKETS, getMarket } from '@/config/markets';
import { SITE } from '@/config/site';
import { copy } from '@/content/copy';
import { countryHref } from '@/lib/places';
import {
  getCachedLocalities,
  getCachedNeighbourhoods,
  getCachedRecentlyReviewed,
} from '@/server/data/cache';

/**
 * A country.
 *
 * The level the old information architecture was missing. `/places/gb/london`
 * existed and `/places/gb` did not, so truncating a city URL — which readers
 * and crawlers both do — reached a 404, and "search another country" had
 * nowhere to point.
 *
 * It is a browse rather than an intelligence page: Livd scores properties, and
 * a country-level score would be an average of averages dressed up as a
 * finding. So this page counts what it has and hands the reader down to a city
 * or a neighbourhood, which is where the resident record actually lives.
 */

interface Params {
  country: string;
}

/** Only configured markets resolve. An arbitrary two letters is a 404, not an empty page. */
function resolveCountry(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return code in MARKETS ? code : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { country } = await params;
  const countryCode = resolveCountry(country);

  if (!countryCode) {
    return { title: 'Place not found', robots: { index: false, follow: false } };
  }

  const market = getMarket(countryCode);
  const localities = await getCachedLocalities(countryCode);

  if (localities.length === 0) {
    // Real route, nothing to index yet. Followed so the links out still count.
    return {
      title: copy.explore.countryHeading(market.name),
      description: copy.explore.countryEmptyBody,
      robots: { index: false, follow: true },
    };
  }

  const reviewCount = localities.reduce((sum, locality) => sum + locality.reviewCount, 0);
  const propertyCount = localities.reduce((sum, locality) => sum + locality.propertyCount, 0);

  return {
    title: copy.explore.countryHeading(market.name),
    description: `${propertyCount} ${
      propertyCount === 1 ? 'property' : 'properties'
    } across ${localities.length} ${
      localities.length === 1 ? 'city' : 'cities'
    } in ${market.name}, with ${reviewCount} resident ${
      reviewCount === 1 ? 'review' : 'reviews'
    } on Livd. Read what people who lived there say before you commit.`,
    alternates: { canonical: `${SITE.url}${countryHref(countryCode)}` },
  };
}

export default async function CountryPage({ params }: { params: Promise<Params> }) {
  const { country } = await params;
  const countryCode = resolveCountry(country);
  if (!countryCode) notFound();

  const market = getMarket(countryCode);

  const [localities, allNeighbourhoods, recentlyReviewed] = await Promise.all([
    getCachedLocalities(countryCode),
    getCachedNeighbourhoods({ countryCode, limit: 18 }),
    getCachedRecentlyReviewed(3, countryCode),
  ]);

  // An area with a property and no reviews has nothing to say under a heading
  // about what it is like to live there. The cities section above still counts
  // it, because that is a count rather than a claim.
  const neighbourhoods = allNeighbourhoods.filter(
    (neighbourhood) => neighbourhood.reviewCount > 0,
  );

  const reviewCount = localities.reduce((sum, locality) => sum + locality.reviewCount, 0);
  const propertyCount = localities.reduce((sum, locality) => sum + locality.propertyCount, 0);

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
          <li className="text-ink">{market.name}</li>
        </ol>
      </nav>

      <div className="max-w-2xl">
        <h1 className="font-display text-display-lg tracking-display text-ink">
          {copy.explore.countryHeading(market.name)}
        </h1>
        <p className="mt-4 text-body-lg text-ink-muted">{copy.explore.countryLead}</p>
      </div>

      <div className="mt-8 max-w-2xl">
        <SearchCombobox placeholder={copy.home.searchPlaceholder} />
      </div>

      {localities.length === 0 ? (
        <EmptyState
          className="mt-12"
          title={copy.explore.countryEmptyTitle(market.name)}
          description={copy.explore.countryEmptyBody}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <ButtonLink href="/review">{copy.explore.beFirst}</ButtonLink>
              <ButtonLink href="/places/all" variant="secondary">
                {copy.explore.everywhere}
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <>
          <dl className="mt-9 grid grid-cols-2 gap-6 border-y border-border py-6 sm:grid-cols-3">
            <Stat label={market.localityLabel === 'Suburb' ? 'Suburbs' : 'Cities'} value={localities.length} />
            <Stat label="Properties" value={propertyCount} />
            <Stat label="Resident reviews" value={reviewCount} />
          </dl>

          <div className="mt-14 flex flex-col gap-14">
            {recentlyReviewed.length > 0 && (
              <Section
                title={copy.explore.recentTitleIn(market.name)}
                description={copy.explore.recentLead}
              >
                <PropertyGrid>
                  {recentlyReviewed.map((summary) => (
                    <li key={summary.property.id}>
                      <PropertyCard summary={summary} />
                    </li>
                  ))}
                </PropertyGrid>
              </Section>
            )}

            <Section
              title={copy.explore.citiesIn(market.name)}
              description={copy.explore.citiesLead}
            >
              <PlaceGrid>
                {localities.map((locality) => (
                  <li key={locality.href}>
                    <PlaceTile
                      href={locality.href}
                      name={locality.locality}
                      context={locality.adminArea}
                      propertyCount={locality.propertyCount}
                      reviewCount={locality.reviewCount}
                    />
                  </li>
                ))}
              </PlaceGrid>
            </Section>

            {neighbourhoods.length > 0 && (
              <Section
                title={copy.explore.neighbourhoodsTitle}
                description={copy.explore.neighbourhoodsLead}
              >
                <NeighbourhoodGroups neighbourhoods={neighbourhoods} />
              </Section>
            )}
          </div>

          <div className="mt-14">
            <EmptyState
              title={`Lived somewhere in ${market.name}?`}
              description="Every property on this page is here because somebody took four minutes to write about it. The next person deciding where to live is relying on that."
              action={
                <ButtonLink href="/review" size="lg">
                  {copy.nav.writeReview}
                </ButtonLink>
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
