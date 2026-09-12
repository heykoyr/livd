import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { CountryLinks } from '@/components/places/country-links';
import { NeighbourhoodGroups } from '@/components/places/neighbourhood-groups';
import { PlaceGrid, PlaceTile, PropertyGrid } from '@/components/places/place-tile';
import { PropertyCard, PropertyCardSkeleton } from '@/components/property/property-card';
import { NearbyProperties } from '@/components/search/nearby-properties';
import { SearchCombobox } from '@/components/search/search-combobox';
import { ButtonLink } from '@/components/ui/button';
import { Card, EmptyState, Eyebrow, Section } from '@/components/ui/primitives';
import { getMarket } from '@/config/markets';
import { SITE } from '@/config/site';
import { copy } from '@/content/copy';
import { getCurrentUser } from '@/server/auth/session';
import {
  getCachedLocalities,
  getCachedMostReviewed,
  getCachedNeighbourhoods,
  getCachedRecentlyReviewed,
} from '@/server/data/cache';
import { viewerCountry } from '@/server/geo/viewer-country';

/**
 * Explore.
 *
 * This route used to render the whole world alphabetically — Australia, then
 * Canada, then Germany — which described Livd's database accurately and its
 * purpose not at all. Nobody arrives at a property intelligence product
 * wanting to read a country index; they arrive because they are considering
 * somewhere to live.
 *
 * So search is the first thing on the page, and everything below it is there
 * to answer "what is worth looking at" for somebody who does not yet have an
 * address in mind: what residents wrote about most recently, where they have
 * written most, the neighbourhoods they wrote about, and the cities those sit
 * in. The full index still exists, at `/places/all`, one link away — it is a
 * genuine SEO surface and a genuine browse, just not the front door.
 *
 * The route itself is unchanged. It is indexed, linked from property pages and
 * in the sitemap; only the label in the navigation became "Explore".
 *
 * On locality: the page prefers the visitor's own country and is never limited
 * to it. See `viewerCountry` for what that resolution will and will not do.
 * Nothing on this page requires a location permission, and the one control
 * that uses a position is a button somebody has to press.
 */

/** How much of each section renders. Bounded here, and again in every query. */
const LIMITS = {
  recent: 6,
  evidenced: 6,
  cities: 12,
  neighbourhoods: 18,
} as const;

export const metadata: Metadata = {
  title: copy.explore.title,
  description: copy.explore.metaDescription,
  alternates: { canonical: `${SITE.url}/places` },
};

export default async function ExplorePage() {
  const user = await getCurrentUser();
  const preferred = await viewerCountry(user);

  // Both lists are cached at the data layer — the global one against a single
  // key shared by every visitor, so this is one query an hour rather than one
  // a request. The global list is what tells the page which countries have
  // anything to read, and it is the fallback scope.
  const [preferredLocalities, allLocalities] = await Promise.all([
    preferred ? getCachedLocalities(preferred) : Promise.resolve([]),
    getCachedLocalities(),
  ]);

  /**
   * Only claim local discovery when there is something local to discover.
   *
   * A guessed country with no reviewed property in it would produce a page of
   * empty sections headed "Recently reviewed in Germany", which reads as Livd
   * being broken rather than as Livd being honest about what it has.
   */
  const country = preferredLocalities.length > 0 ? preferred : null;
  const countryName = country ? getMarket(country).name : null;
  const localities = country ? preferredLocalities : allLocalities;

  /** A guess that found nothing. Said once, rather than implied six times. */
  const guessedButEmpty =
    preferred !== null && preferredLocalities.length === 0 && allLocalities.length > 0;

  /**
   * Only areas residents have actually written about.
   *
   * A neighbourhood with a property and no reviews is a real place and a
   * correct row, and it has nothing to say under a heading promising what it
   * is like to live around there. It sorts last in the ranking, so filtering
   * after the limit still leaves the strongest areas.
   */
  const neighbourhoods = (
    await getCachedNeighbourhoods({ countryCode: country, limit: LIMITS.neighbourhoods })
  ).filter((neighbourhood) => neighbourhood.reviewCount > 0);

  const isEmpty = allLocalities.length === 0;

  return (
    <>
      <ExploreHeader countryName={countryName} isEmpty={isEmpty} />

      <div className="container-shell flex flex-col gap-16 py-12 md:gap-20 md:py-16">
        {isEmpty ? (
          <EmptyState
            title={copy.explore.emptyTitle}
            description={copy.explore.emptyBody}
            action={
              <ButtonLink href="/review" size="lg">
                {copy.nav.writeReview}
              </ButtonLink>
            }
          />
        ) : (
          <>
            {guessedButEmpty && preferred && (
              <LocalMissNotice countryName={getMarket(preferred).name} />
            )}

            {/* Inert until pressed: no permission prompt, no reading, nothing
                stored. Search above it is the primary interaction and needs
                none of this. */}
            <NearbyProperties />

            <Suspense fallback={<PropertyGridSkeleton count={3} />}>
              <RecentlyReviewedSection country={country} countryName={countryName} />
            </Suspense>

            <Suspense fallback={<PropertyGridSkeleton count={3} />}>
              <MostWrittenAboutSection country={country} countryName={countryName} />
            </Suspense>

            {neighbourhoods.length > 0 && (
              <Section
                id="neighbourhoods"
                title={copy.explore.neighbourhoodsTitle}
                description={copy.explore.neighbourhoodsLead}
              >
                <NeighbourhoodGroups neighbourhoods={neighbourhoods} />
              </Section>
            )}

            <Section
              id="cities"
              title={countryName ? copy.explore.citiesIn(countryName) : copy.explore.citiesTitle}
              description={copy.explore.citiesLead}
              action={
                <Link
                  href="/places/all"
                  className="rounded-sm text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
                >
                  {copy.explore.everywhere}
                </Link>
              }
            >
              <PlaceGrid>
                {localities.slice(0, LIMITS.cities).map((locality) => (
                  <li key={locality.href}>
                    <PlaceTile
                      href={locality.href}
                      name={locality.locality}
                      context={
                        [locality.adminArea, getMarket(locality.countryCode).name]
                          .filter(Boolean)
                          .join(', ') || null
                      }
                      propertyCount={locality.propertyCount}
                      reviewCount={locality.reviewCount}
                    />
                  </li>
                ))}
              </PlaceGrid>
            </Section>

            <ElsewhereSection localities={allLocalities} activeCountry={country} />
          </>
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Header
 * ---------------------------------------------------------------------- */

function ExploreHeader({
  countryName,
  isEmpty,
}: {
  countryName: string | null;
  isEmpty: boolean;
}) {
  return (
    <header className="border-b border-border bg-surface">
      <div className="container-shell py-12 md:py-16">
        <div className="max-w-3xl">
          <Eyebrow>{copy.explore.title}</Eyebrow>

          <h1 className="mt-4 font-display text-display-lg tracking-display text-ink">
            {copy.explore.heading}
          </h1>

          <p className="mt-4 max-w-xl text-body-lg text-ink-muted">{copy.explore.lead}</p>

          <div className="mt-8 max-w-2xl">
            <SearchCombobox size="lg" placeholder={copy.home.searchPlaceholder} />
          </div>

          {/* Said only where it needs saying. "Showing everywhere on Livd" is
              already the whole of the promise; repeating that search is
              worldwide underneath it is words for their own sake. */}
          {!isEmpty && (
            <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-label text-ink-subtle">
              <span className="text-ink-muted">
                {countryName ? copy.explore.scopeLocal(countryName) : copy.explore.scopeGlobal}
              </span>
              {countryName && <span>{copy.explore.scopeNote}</span>}
            </p>
          )}
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------
 * Sections
 * ---------------------------------------------------------------------- */

async function RecentlyReviewedSection({
  country,
  countryName,
}: {
  country: string | null;
  countryName: string | null;
}) {
  const summaries = await getCachedRecentlyReviewed(LIMITS.recent, country);
  if (summaries.length === 0) return null;

  return (
    <Section
      id="recently-reviewed"
      title={
        countryName ? copy.explore.recentTitleIn(countryName) : copy.explore.recentTitle
      }
      description={copy.explore.recentLead}
    >
      <PropertyGrid>
        {summaries.map((summary) => (
          <li key={summary.property.id}>
            <PropertyCard summary={summary} />
          </li>
        ))}
      </PropertyGrid>
    </Section>
  );
}

/**
 * Most written about, not "popular".
 *
 * Livd has no view counts, no click-through and no way to know what is in
 * demand — so "popular" would be a claim the data cannot support. What it can
 * say is where residents have written most, which is also the more useful
 * signal: a property with thirty reviews is one a reader can interrogate.
 */
async function MostWrittenAboutSection({
  country,
  countryName,
}: {
  country: string | null;
  countryName: string | null;
}) {
  // Over-fetched and then deduplicated against the section above it. The two
  // rankings overlap heavily at Livd's current size, and a page that shows a
  // reader the same six buildings twice has wasted half of itself. Both reads
  // hit the same cache entries the other section uses, so this costs nothing.
  const [recent, mostReviewed] = await Promise.all([
    getCachedRecentlyReviewed(LIMITS.recent, country),
    getCachedMostReviewed(LIMITS.recent + LIMITS.evidenced, country),
  ]);

  const alreadyShown = new Set(recent.map((summary) => summary.property.id));
  const summaries = mostReviewed
    .filter((summary) => !alreadyShown.has(summary.property.id))
    .slice(0, LIMITS.evidenced);

  if (summaries.length === 0) return null;

  return (
    <Section
      id="most-written-about"
      title={
        countryName ? copy.explore.evidencedTitleIn(countryName) : copy.explore.evidencedTitle
      }
      description={copy.explore.evidencedLead}
    >
      <PropertyGrid>
        {summaries.map((summary) => (
          <li key={summary.property.id}>
            <PropertyCard summary={summary} />
          </li>
        ))}
      </PropertyGrid>
    </Section>
  );
}

function ElsewhereSection({
  localities,
  activeCountry,
}: {
  localities: Awaited<ReturnType<typeof getCachedLocalities>>;
  activeCountry: string | null;
}) {
  return (
    <Section
      id="elsewhere"
      title={copy.explore.elsewhereTitle}
      description={copy.explore.elsewhereLead}
    >
      <CountryLinks localities={localities} activeCountry={activeCountry} />

      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/search" variant="secondary">
          {copy.explore.searchAnywhere}
        </ButtonLink>
        <ButtonLink href="/places/all" variant="secondary">
          {copy.explore.everywhere}
        </ButtonLink>
      </div>
    </Section>
  );
}

/**
 * Livd guessed a country and has nothing in it.
 *
 * Stated plainly and once, then the page carries on with the global lists —
 * rather than six sections headed with a country name and nothing under them.
 */
function LocalMissNotice({ countryName }: { countryName: string }) {
  return (
    <Card className="border-dashed p-5 md:p-6">
      <h2 className="font-display text-title-md tracking-tightish text-ink">
        {copy.explore.emptyLocalTitle(countryName)}
      </h2>
      <p className="mt-2 max-w-prose text-label text-ink-muted">
        {copy.explore.emptyLocalBody}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <ButtonLink href="/review" size="sm">
          {copy.explore.beFirst}
        </ButtonLink>
        <ButtonLink href="/search" variant="secondary" size="sm">
          {copy.explore.searchAnywhere}
        </ButtonLink>
      </div>
    </Card>
  );
}

function PropertyGridSkeleton({ count }: { count: number }) {
  return (
    <div>
      <div className="mb-5 h-7 w-56 max-w-full rounded-md bg-surface-sunken" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }, (_, index) => (
          <PropertyCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
