import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PropertyGrid } from '@/components/places/place-tile';
import { PropertyCard } from '@/components/property/property-card';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, Stat } from '@/components/ui/primitives';
import { getMarket } from '@/config/markets';
import { SITE } from '@/config/site';
import { copy } from '@/content/copy';
import { formatPercent } from '@/lib/format';
import { countryHref, decodePlaceSegment, localityHref, neighbourhoodHref } from '@/lib/places';
import { getRepository } from '@/server/data';
import { getCachedNeighbourhoods } from '@/server/data/cache';

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

async function load(params: Params) {
  const countryCode = params.country.toUpperCase();
  const locality = decodePlaceSegment(params.locality);
  const neighbourhood = decodePlaceSegment(params.neighbourhood);

  const repository = await getRepository();
  const properties = await repository.propertiesInNeighbourhood(
    countryCode,
    locality,
    neighbourhood,
  );

  return { countryCode, locality, neighbourhood, properties };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const resolved = await params;
  const { countryCode, properties } = await load(resolved);

  if (properties.length === 0) {
    return { title: 'Place not found', robots: { index: false, follow: false } };
  }

  // The stored spelling, not the URL's, so the title reads properly.
  const { address } = properties[0]!.property;
  const name = address.neighbourhood ?? decodePlaceSegment(resolved.neighbourhood);
  const reviewCount = properties.reduce((sum, s) => sum + s.intelligence.reviewCount, 0);

  return {
    title: `Living in ${name}, ${address.locality}`,
    description: `${properties.length} ${
      properties.length === 1 ? 'property' : 'properties'
    } in ${name}, ${address.locality} with ${reviewCount} resident ${
      reviewCount === 1 ? 'review' : 'reviews'
    } on Livd. Read what people who lived there say about the area before you commit.`,
    alternates: {
      canonical: `${SITE.url}${neighbourhoodHref(countryCode, address.locality, name)}`,
    },
  };
}

export default async function NeighbourhoodPage({ params }: { params: Promise<Params> }) {
  const resolved = await params;
  const { countryCode, properties } = await load(resolved);

  if (properties.length === 0) notFound();

  const { address } = properties[0]!.property;
  const name = address.neighbourhood ?? decodePlaceSegment(resolved.neighbourhood);
  const locality = address.locality;
  const market = getMarket(countryCode);

  const reviewCount = properties.reduce((sum, s) => sum + s.intelligence.reviewCount, 0);
  const scored = properties.filter((s) => s.intelligence.overallScore !== null);
  const medianScore = medianOf(scored.map((s) => s.intelligence.overallScore!));

  // Only properties with enough evidence contribute to an area-level claim.
  const evidenced = properties.filter(
    (s) => s.intelligence.confidence === 'moderate' || s.intelligence.confidence === 'strong',
  );
  const recommendRates = evidenced
    .map((s) => s.intelligence.recommendRate)
    .filter((rate): rate is number => rate !== null);
  const recommendRate =
    recommendRates.length > 0
      ? recommendRates.reduce((sum, rate) => sum + rate, 0) / recommendRates.length
      : null;

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
          {address.adminArea ? `, ${address.adminArea}` : ''} · {market.name}
        </p>
        <p className="mt-4 text-body text-ink-muted">{copy.explore.neighbourhoodLead}</p>
      </div>

      <dl className="mt-9 grid grid-cols-2 gap-6 border-y border-border py-6 sm:grid-cols-4">
        <Stat label="Properties" value={properties.length} />
        <Stat label="Resident reviews" value={reviewCount} />
        <Stat
          label="Median score"
          value={medianScore ?? '—'}
          hint={
            medianScore === null
              ? 'not enough scored properties'
              : `across ${scored.length} scored ${scored.length === 1 ? 'property' : 'properties'}`
          }
        />
        <Stat
          label="Would return"
          value={recommendRate === null ? '—' : formatPercent(recommendRate, countryCode)}
          hint={
            recommendRate === null
              ? 'not enough evidence yet'
              : `across ${evidenced.length} well-reviewed ${
                  evidenced.length === 1 ? 'property' : 'properties'
                }`
          }
        />
      </dl>

      <h2 className="mt-12 font-display text-title-lg tracking-tightish text-ink">
        {copy.explore.propertiesIn(name)}
      </h2>

      <PropertyGrid className="mt-5">
        {properties.map((summary) => (
          <li key={summary.property.id}>
            <PropertyCard summary={summary} />
          </li>
        ))}
      </PropertyGrid>

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

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
