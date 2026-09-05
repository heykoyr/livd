import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PropertyCard } from '@/components/property/property-card';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, Stat } from '@/components/ui/primitives';
import { getMarket } from '@/config/markets';
import { SITE } from '@/config/site';
import { copy } from '@/content/copy';
import { formatPercent } from '@/lib/format';
import { getRepository } from '@/server/data';
import type { PropertySummary } from '@/types/domain';

/**
 * A location page.
 *
 * Server-rendered and indexable — this is the parent a property page hangs off,
 * and the page a search engine is most likely to surface for "reviews in
 * <neighbourhood>".
 */

interface Params {
  country: string;
  locality: string;
}

async function load(params: Params) {
  const countryCode = params.country.toUpperCase();
  const locality = decodeURIComponent(params.locality);

  const repository = await getRepository();
  const properties = await repository.propertiesInLocality(countryCode, locality);

  return { countryCode, locality, properties };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const resolved = await params;
  const { countryCode, locality, properties } = await load(resolved);

  if (properties.length === 0) {
    return { title: 'Place not found', robots: { index: false, follow: false } };
  }

  const market = getMarket(countryCode);
  // Use the stored spelling rather than the URL's, so the title reads properly.
  const name = properties[0]!.property.address.locality;
  const reviewCount = properties.reduce((sum, s) => sum + s.intelligence.reviewCount, 0);

  return {
    title: `Renting in ${name}, ${market.name}`,
    description: `${properties.length} ${
      properties.length === 1 ? 'property' : 'properties'
    } in ${name} with ${reviewCount} resident ${
      reviewCount === 1 ? 'review' : 'reviews'
    } on Livd. Read what people who lived there say before you commit.`,
    alternates: {
      canonical: `${SITE.url}/places/${countryCode.toLowerCase()}/${encodeURIComponent(
        locality.toLowerCase(),
      )}`,
    },
  };
}

export default async function LocalityPage({ params }: { params: Promise<Params> }) {
  const resolved = await params;
  const { countryCode, properties } = await load(resolved);

  if (properties.length === 0) notFound();

  const market = getMarket(countryCode);
  const name = properties[0]!.property.address.locality;

  const reviewCount = properties.reduce((sum, s) => sum + s.intelligence.reviewCount, 0);
  const scored = properties.filter((s) => s.intelligence.overallScore !== null);
  const medianScore = medianOf(scored.map((s) => s.intelligence.overallScore!));

  // Only properties with enough evidence contribute to a locality-level claim.
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

  const neighbourhoods = [
    ...new Set(
      properties
        .map((s) => s.property.address.neighbourhood)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();

  return (
    <div className="container-shell py-12 md:py-16">
      <nav aria-label="Breadcrumb" className="mb-5">
        <ol className="flex flex-wrap items-center gap-1.5 text-label text-ink-muted">
          <li>
            <Link href="/places" className="rounded-sm hover:text-ink">
              {copy.nav.places}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink">
            {name}, {market.name}
          </li>
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

      {neighbourhoods.length > 0 && (
        <div className="mt-8">
          <h2 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            Neighbourhoods
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {neighbourhoods.map((neighbourhood) => (
              <li key={neighbourhood}>
                <Link
                  href={`/search?q=${encodeURIComponent(neighbourhood)}`}
                  className="inline-block rounded-full border border-border bg-surface px-3.5 py-1.5 text-label text-ink-muted transition-colors duration-fast hover:border-border-strong hover:text-ink"
                >
                  {neighbourhood}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="mt-12 font-display text-title-lg tracking-tightish text-ink">
        Properties in {name}
      </h2>

      <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {properties.map((summary) => (
          <li key={summary.property.id}>
            <PropertyCard summary={summary} />
          </li>
        ))}
      </ul>

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

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Helper for the summary card list. */
export type { PropertySummary };
