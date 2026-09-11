import type { Metadata } from 'next';
import Link from 'next/link';

import {
  CategoryScores,
  DepartureBreakdownPanel,
  PreVisitChecks,
  PropertyTimeline,
  ResidentVerdictPanel,
  TagFrequencyList,
} from '@/components/property/intelligence';
import { ResidentFreshnessPanel } from '@/components/property/freshness';
import { PropertyHeader } from '@/components/property/property-header';
import { PropertyMissing } from '@/components/property/property-missing';
import { ReviewCard } from '@/components/property/review-card';
import { ReviewFilters, type ReviewViewOptions } from '@/components/property/review-filters';
import { ButtonLink } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { Card, EmptyState, Section } from '@/components/ui/primitives';
import { LIMITS, SITE } from '@/config/site';
import { copy } from '@/content/copy';
import { propertyContextLine, propertyDisplayName } from '@/lib/format';
import { buildPreVisitChecks, generateVerdict } from '@/lib/intelligence/verdict';
import { getCurrentUser } from '@/server/auth/session';
import { getRepository } from '@/server/data';
import { getCachedIntelligence } from '@/server/data/cache';
import type { Property, PropertyIntelligence } from '@/types/domain';

/* -------------------------------------------------------------------------
 * Metadata
 * ---------------------------------------------------------------------- */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const repository = await getRepository();
  const property = await repository.getPropertyBySlug(slug);

  if (!property) {
    // Kept out of every index. See PropertyMissing for why this is a soft 404.
    return { title: copy.errors.propertyNotFoundTitle, robots: { index: false, follow: true } };
  }

  const intelligence = await getCachedIntelligence(property.id);
  const name = propertyDisplayName(property.address);
  const context = propertyContextLine(property.address);

  const description =
    intelligence.reviewCount > 0
      ? `${intelligence.reviewCount} resident ${
          intelligence.reviewCount === 1 ? 'review' : 'reviews'
        } of ${name}, ${context}${
          intelligence.overallScore !== null
            ? ` — Livd Score ${intelligence.overallScore}/100`
            : ''
        }. Read what people who lived there say, including why they left.`
      : `${name}, ${context}. No resident reviews yet on Livd — be the first to share what it is like to live here.`;

  const canonical = `${SITE.url}/property/${property.slug}`;

  return {
    title: `${name}, ${property.address.locality}`,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title: `${name} — resident reviews`,
      description,
      url: canonical,
    },
    // Demo properties must never reach a search index; they are fabricated.
    robots: property.isDemo
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}

/* -------------------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------------- */

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  const repository = await getRepository();
  const property = await repository.getPropertyBySlug(slug);
  if (!property) return <PropertyMissing />;

  const options = parseReviewOptions(query);

  const [intelligence, user, isClaimed] = await Promise.all([
    getCachedIntelligence(property.id),
    getCurrentUser(),
    // The public flag, not the claim itself — a visitor may know a property is
    // claimed, but not by whom.
    repository.isPropertyClaimed(property.id),
  ]);

  const [reviews, isSaved, claimedByViewer] = await Promise.all([
    repository.listPublicReviews(property.id, {
      residency: options.residency,
      verifiedOnly: options.verifiedOnly,
      sort: options.sort,
      page: options.page,
      pageSize: LIMITS.reviewsPerPage,
    }),
    user ? repository.isPropertySaved(user.id, property.id) : Promise.resolve(false),
    // Whether *this reader* may speak for this property. Their own claims,
    // read as themselves — no widening of who can see who claimed what.
    user ? repository.listClaimedPropertyIds(user.id) : Promise.resolve([]),
  ]);

  const canRespond = claimedByViewer.includes(property.id);

  const verdict = generateVerdict(intelligence);
  const checks = buildPreVisitChecks(intelligence);
  const countryCode = property.address.countryCode;

  const buildReviewHref = (next: Partial<ReviewViewOptions>): string =>
    buildHref(property.slug, { ...options, ...next });

  const hasScore = intelligence.overallScore !== null;

  return (
    <>
      {!property.isDemo && intelligence.reviewCount > 0 && (
        <PropertyJsonLd property={property} intelligence={intelligence} />
      )}

      <PropertyHeader
        property={property}
        intelligence={intelligence}
        user={user}
        isSaved={isSaved}
        isClaimed={isClaimed}
      />

      {property.isDemo && (
        <div className="border-b border-accent/25 bg-accent-soft">
          <p className="container-shell py-3 text-label text-accent">
            <strong className="font-semibold">{copy.property.demoBadge}.</strong>{' '}
            {copy.property.demoNote}
          </p>
        </div>
      )}

      <div className="container-shell py-12 md:py-16">
        <div className="grid grid-cols-1 gap-14 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
          <div className="min-w-0">
            {intelligence.reviewCount === 0 ? (
              <EmptyState
                title={copy.property.reviewsEmptyTitle}
                description={copy.property.reviewsEmptyBody}
                action={
                  <ButtonLink href={`/review?property=${property.slug}`} size="lg">
                    {copy.property.beFirst}
                  </ButtonLink>
                }
              />
            ) : (
              <div className="flex flex-col gap-16">
                {hasScore ? (
                  <ResidentVerdictPanel verdict={verdict} />
                ) : (
                  <Card className="border-dashed p-6 md:p-8">
                    <h2 className="font-display text-title-lg tracking-tightish text-ink">
                      {copy.property.learningTitle}
                    </h2>
                    <p className="mt-3 max-w-prose text-body text-ink-muted">
                      {copy.property.learningBody(intelligence.reviewCount)}
                    </p>
                  </Card>
                )}

                <Section id="freshness" className="scroll-mt-24">
                  <ResidentFreshnessPanel
                    intelligence={intelligence}
                    countryCode={countryCode}
                  />
                </Section>

                {checks.length > 0 && (
                  <Section
                    id="check"
                    title={copy.property.checksTitle}
                    description={copy.property.checksLead}
                  >
                    <PreVisitChecks checks={checks} />
                  </Section>
                )}

                <Section id="why-people-leave" title={copy.property.departuresTitle}>
                  <DepartureBreakdownPanel
                    departures={intelligence.departures}
                    countryCode={countryCode}
                  />
                </Section>

                {intelligence.categoryScores.length > 0 && (
                  <Section
                    id="categories"
                    title={copy.property.categoryTitle}
                    description={copy.property.categoryLead}
                  >
                    <CategoryScores intelligence={intelligence} />
                  </Section>
                )}

                {(intelligence.topPositiveTags.length > 0 ||
                  intelligence.topProblemTags.length > 0) && (
                  <Section id="themes" title="What comes up most often">
                    <div className="grid grid-cols-1 gap-8 rounded-lg border border-border bg-surface p-6 sm:grid-cols-2">
                      {intelligence.topPositiveTags.length > 0 && (
                        <div>
                          <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                            Mentioned as good
                          </h3>
                          <TagFrequencyList
                            className="mt-4"
                            tags={intelligence.topPositiveTags}
                            reviewCount={intelligence.reviewCount}
                            polarity="positive"
                          />
                        </div>
                      )}
                      {intelligence.topProblemTags.length > 0 && (
                        <div>
                          <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                            Mentioned as difficult
                          </h3>
                          <TagFrequencyList
                            className="mt-4"
                            tags={intelligence.topProblemTags}
                            reviewCount={intelligence.reviewCount}
                            polarity="problem"
                          />
                        </div>
                      )}
                    </div>
                  </Section>
                )}

                {intelligence.timeline.length > 0 && (
                  <Section
                    id="timeline"
                    title={copy.property.timelineTitle}
                    description={copy.property.timelineLead}
                  >
                    <PropertyTimeline entries={intelligence.timeline} />
                  </Section>
                )}

                <Section
                  id="reviews"
                  title={copy.property.reviewsTitle}
                  description={copy.property.reviewCount(intelligence.reviewCount)}
                >
                  <ReviewFilters
                    options={options}
                    intelligence={intelligence}
                    buildHref={buildReviewHref}
                  />

                  {reviews.items.length === 0 ? (
                    <p className="mt-8 rounded-lg border border-dashed border-border-strong p-8 text-center text-body text-ink-muted">
                      {copy.property.noMatchingReviews}
                    </p>
                  ) : (
                    <ul className="mt-6 flex flex-col gap-4">
                      {reviews.items.map((review) => (
                        <li key={review.id}>
                          <ReviewCard
                            review={review}
                            countryCode={countryCode}
                            canReport={user !== null}
                            canRespond={canRespond}
                            propertyName={propertyDisplayName(property.address)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}

                  <Pagination
                    className="mt-10"
                    page={reviews.page}
                    pageSize={reviews.pageSize}
                    total={reviews.total}
                    buildHref={(page) => buildReviewHref({ page })}
                  />
                </Section>
              </div>
            )}
          </div>

          <PropertySidebar
            property={property}
            intelligence={intelligence}
            isClaimed={isClaimed}
            viewerIsClaimant={canRespond}
          />
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Sidebar
 * ---------------------------------------------------------------------- */

function PropertySidebar({
  property,
  intelligence,
  isClaimed,
  viewerIsClaimant,
}: {
  property: Property;
  intelligence: PropertyIntelligence;
  isClaimed: boolean;
  viewerIsClaimant: boolean;
}) {
  const sections: Array<{ href: string; label: string }> = [
    ...(intelligence.reviewCount > 0
      ? [{ href: '#freshness', label: copy.verification.freshnessTitle }]
      : []),
    ...(intelligence.reviewCount > 0
      ? [{ href: '#check', label: copy.property.checksTitle }]
      : []),
    { href: '#why-people-leave', label: copy.property.departuresTitle },
    ...(intelligence.categoryScores.length > 0
      ? [{ href: '#categories', label: copy.property.categoryTitle }]
      : []),
    ...(intelligence.timeline.length > 0
      ? [{ href: '#timeline', label: copy.property.timelineTitle }]
      : []),
    { href: '#reviews', label: copy.property.reviewsTitle },
  ];

  return (
    <aside className="flex flex-col gap-8 lg:sticky lg:top-24 lg:self-start">
      {intelligence.reviewCount > 0 && (
        <nav aria-label="On this page">
          <h2 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            On this page
          </h2>
          <ul className="mt-3 flex flex-col border-l border-border">
            {sections.map((section) => (
              <li key={section.href}>
                <a
                  href={section.href}
                  className="-ml-px block border-l border-transparent py-2 pl-4 text-label text-ink-muted transition-colors duration-fast hover:border-brand hover:text-ink"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <Card className="p-5">
        <h2 className="font-display text-title-md tracking-tightish text-ink">
          Lived here?
        </h2>
        <p className="mt-2 text-label text-ink-muted">
          Your experience is the reason the next person can decide properly. It takes about four
          minutes and your name is never shown.
        </p>
        <ButtonLink
          href={`/review?property=${property.slug}`}
          className="mt-4"
          size="sm"
          fullWidth
        >
          {copy.property.writeReview}
        </ButtonLink>
      </Card>

      {/* Three states, not two. A claimant arriving at their own property
          page used to see the same "this property has been claimed" note a
          stranger sees, with no indication that the thing they were approved
          for was available anywhere on the page. */}
      <Card className="p-5">
        <h2 className="font-display text-title-md tracking-tightish text-ink">
          {viewerIsClaimant
            ? 'You represent this property'
            : isClaimed
              ? copy.property.claimed
              : 'Own or manage this property?'}
        </h2>
        <p className="mt-2 text-label text-ink-muted">
          {viewerIsClaimant
            ? 'You can reply once to each review, below. You cannot edit, hide or remove a resident review, and you will never be shown who wrote one.'
            : isClaimed
              ? copy.property.claimedNote
              : 'Claim it to correct the details and respond publicly to reviews. Claiming never lets anyone edit or remove what a resident wrote.'}
        </p>
        {viewerIsClaimant ? (
          <a
            href="#reviews"
            className="mt-3 inline-block rounded-sm text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            Go to the reviews
          </a>
        ) : (
          !isClaimed && (
            <Link
              href={`/property/${property.slug}/claim`}
              className="mt-3 inline-block rounded-sm text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
            >
              {copy.property.claim}
            </Link>
          )
        )}
      </Card>

      <p className="text-micro text-ink-subtle">{copy.score.weightingNote}</p>
    </aside>
  );
}

/* -------------------------------------------------------------------------
 * Structured data
 * ---------------------------------------------------------------------- */

/**
 * `Place` with an aggregate rating.
 *
 * Emitted only where the confidence band justifies it, and never for demo data.
 * No review author information of any kind appears here — a structured-data
 * payload is a machine-readable export, and anonymity has to survive it.
 */
function PropertyJsonLd({
  property,
  intelligence,
}: {
  property: Property;
  intelligence: PropertyIntelligence;
}) {
  const includeRating =
    intelligence.overallScore !== null && intelligence.confidence !== 'limited';

  const data = {
    '@context': 'https://schema.org',
    '@type': 'Residence',
    name: propertyDisplayName(property.address),
    url: `${SITE.url}/property/${property.slug}`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: property.address.streetAddress ?? undefined,
      addressLocality: property.address.locality,
      addressRegion: property.address.adminArea ?? undefined,
      postalCode: property.address.postalCode ?? undefined,
      addressCountry: property.address.countryCode,
    },
    ...(includeRating
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: intelligence.overallScore,
            bestRating: 100,
            worstRating: 0,
            ratingCount: intelligence.reviewCount,
          },
        }
      : {}),
  };

  return (
    <script
      type="application/ld+json"
      // Serialised from server-controlled values only; no user text reaches it.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/* -------------------------------------------------------------------------
 * Review view options
 * ---------------------------------------------------------------------- */

function parseReviewOptions(
  query: Record<string, string | string[] | undefined>,
): ReviewViewOptions {
  const residency = first(query.residents);
  const sort = first(query.sort);
  const page = Number.parseInt(first(query.page) ?? '', 10);

  return {
    residency:
      residency === 'current' || residency === 'former' ? residency : 'all',
    verifiedOnly: first(query.verified) === '1',
    sort:
      sort === 'helpful' || sort === 'highest' || sort === 'lowest' ? sort : 'recent',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function buildHref(slug: string, options: ReviewViewOptions): string {
  const params = new URLSearchParams();
  if (options.residency !== 'all') params.set('residents', options.residency);
  if (options.verifiedOnly) params.set('verified', '1');
  if (options.sort !== 'recent') params.set('sort', options.sort);
  if (options.page > 1) params.set('page', String(options.page));

  const query = params.toString();
  return `/property/${slug}${query ? `?${query}` : ''}#reviews`;
}
