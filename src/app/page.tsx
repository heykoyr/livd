import Link from 'next/link';

import { PropertyCard } from '@/components/property/property-card';
import { SearchCombobox } from '@/components/search/search-combobox';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, Eyebrow } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { getCachedLocalities, getCachedRecentlyReviewed } from '@/server/data/cache';
import type { PropertySummary } from '@/types/domain';

export default async function HomePage() {
  // Cached at the data layer, tag-invalidated on every review write. The route
  // itself is dynamic because the header knows who you are.
  const [recentlyReviewed, localities] = await Promise.all([
    getCachedRecentlyReviewed(3),
    getCachedLocalities(),
  ]);

  return (
    <>
      <Hero />
      <ValueSection />
      {recentlyReviewed.length > 0 && <DiscoverSection summaries={recentlyReviewed} />}
      <HowItWorksSection />
      {localities.length > 0 && <PlacesSection localities={localities.slice(0, 12)} />}
      <ContributeSection />
    </>
  );
}

/* -------------------------------------------------------------------------
 * Hero
 * ---------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="border-b border-border bg-surface">
      <div className="container-shell py-20 md:py-28">
        <div className="max-w-3xl">
          <Eyebrow className="animate-fade">Property intelligence</Eyebrow>

          <h1 className="mt-5 font-display text-display-xl tracking-display text-ink">
            {copy.home.heroTitle}
          </h1>

          <p className="mt-6 max-w-xl text-body-lg text-ink-muted">{copy.home.heroLead}</p>

          <div className="mt-9 max-w-2xl">
            <SearchCombobox size="lg" placeholder={copy.home.searchPlaceholder} />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            <ButtonLink href="/review" variant="secondary">
              {copy.home.contributeCta}
            </ButtonLink>
            <p className="max-w-sm text-label text-ink-subtle">{copy.home.trustNote}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * What a listing will not tell you
 * ---------------------------------------------------------------------- */

function ValueSection() {
  return (
    <section className="container-shell py-20 md:py-24">
      <div className="max-w-2xl">
        <h2 className="font-display text-display-md tracking-display text-ink">
          {copy.home.valueTitle}
        </h2>
      </div>

      <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
        {copy.home.values.map((value, index) => (
          <article key={value.title} className="bg-surface p-7">
            <span
              aria-hidden="true"
              className="block font-display text-title-lg tabular text-accent"
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <h3 className="mt-4 font-display text-title-lg tracking-tightish text-ink">
              {value.title}
            </h3>
            <p className="mt-2.5 text-body text-ink-muted">{value.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Recently reviewed
 * ---------------------------------------------------------------------- */

function DiscoverSection({ summaries }: { summaries: PropertySummary[] }) {
  const hasDemo = summaries.some((summary) => summary.property.isDemo);

  return (
    <section className="border-y border-border bg-surface-sunken/50">
      <div className="container-shell py-20 md:py-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-display-md tracking-display text-ink">
              {copy.home.discoverTitle}
            </h2>
            <p className="mt-2 text-body text-ink-muted">{copy.home.discoverLead}</p>
          </div>
          <Link
            href="/search"
            className="rounded-sm text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            {copy.home.browseAll}
          </Link>
        </div>

        <div className="mt-9 grid grid-cols-1 gap-4 md:grid-cols-3">
          {summaries.map((summary) => (
            <PropertyCard key={summary.property.id} summary={summary} />
          ))}
        </div>

        {hasDemo && (
          <p className="mt-6 flex items-start gap-2 text-label text-ink-subtle">
            <Badge tone="accent">{copy.property.demoBadge}</Badge>
            <span className="max-w-xl">{copy.property.demoNote}</span>
          </p>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * How it works
 * ---------------------------------------------------------------------- */

function HowItWorksSection() {
  return (
    <section className="container-shell py-20 md:py-24">
      <h2 className="max-w-2xl font-display text-display-md tracking-display text-ink">
        {copy.home.howTitle}
      </h2>

      <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {copy.home.howSteps.map((step, index) => (
          <li key={step.title} className="relative">
            <div className="flex items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border-strong text-label font-semibold tabular text-ink-muted">
                {index + 1}
              </span>
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
            </div>
            <h3 className="mt-4 font-display text-title-md tracking-tightish text-ink">
              {step.title}
            </h3>
            <p className="mt-2 text-label text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Places
 * ---------------------------------------------------------------------- */

function PlacesSection({
  localities,
}: {
  localities: Array<{ locality: string; countryCode: string; href: string; reviewCount: number }>;
}) {
  return (
    <section className="container-shell pb-20 md:pb-24">
      <h2 className="font-display text-title-lg tracking-tightish text-ink">
        {copy.home.exploreLocations}
      </h2>

      <ul className="mt-5 flex flex-wrap gap-2">
        {localities.map((locality) => (
          <li key={`${locality.countryCode}-${locality.locality}`}>
            <Link
              href={locality.href}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-label text-ink transition-colors duration-fast hover:border-border-strong hover:bg-surface-sunken"
            >
              {locality.locality}
              <span className="tabular text-ink-subtle">{locality.reviewCount}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Contribute
 * ---------------------------------------------------------------------- */

function ContributeSection() {
  return (
    <section className="container-shell pb-20 md:pb-24">
      <Card className="overflow-hidden">
        <div className="grid gap-8 p-8 md:grid-cols-[1.3fr_1fr] md:items-center md:p-12">
          <div>
            <Eyebrow>Contribute</Eyebrow>
            <h2 className="mt-4 font-display text-display-md tracking-display text-ink">
              Someone read a review before they moved into your building.
            </h2>
            <p className="mt-4 max-w-lg text-body text-ink-muted">
              If you live somewhere now, or you have just moved out, four minutes of your time
              is the difference between the next person guessing and the next person knowing.
              It is anonymous, and your name is never attached to it.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href="/review" size="lg">
                {copy.home.contributeCta}
              </ButtonLink>
              <ButtonLink href="/trust" variant="secondary" size="lg">
                How we protect reviewers
              </ButtonLink>
            </div>
          </div>

          <ul className="flex flex-col gap-3 border-t border-border pt-8 md:border-l md:border-t-0 md:pl-10 md:pt-0">
            {[
              'Your review shows as “former resident”, never your name.',
              'One review per person, per tenancy — so the record stays honest.',
              'Owners can reply. They can never delete what you wrote.',
            ].map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-label text-ink-muted">
                <CheckIcon />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0 text-positive" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" opacity="0.35" />
      <path
        d="m5 8.2 2 2 4-4.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
