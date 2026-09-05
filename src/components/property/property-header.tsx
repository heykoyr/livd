import Link from 'next/link';

import { Badge, Card, Eyebrow, Stat } from '@/components/ui/primitives';
import { getMarket, propertyTypeLabel } from '@/config/markets';
import { copy } from '@/content/copy';
import {
  formatMoney,
  formatPercent,
  formatRelativeTime,
  propertyContextLine,
  propertyDisplayName,
} from '@/lib/format';
import type { Property, PropertyIntelligence, UserProfile } from '@/types/domain';
import { ConfidenceChip, ScoreDial, TrendPill } from './score';
import { SaveButton } from './save-button';
import { ShareButton } from './share-button';

/**
 * The property header.
 *
 * Order matters: identity, then the score, then immediately the evidence behind
 * it. A prominent number with its basis a scroll away is the shape of a
 * misleading page, so the confidence chip and review count sit against the
 * dial and are not optional props.
 */
export function PropertyHeader({
  property,
  intelligence,
  user,
  isSaved,
  isClaimed,
}: {
  property: Property;
  intelligence: PropertyIntelligence;
  user: UserProfile | null;
  isSaved: boolean;
  isClaimed: boolean;
}) {
  const { address } = property;
  const market = getMarket(address.countryCode);
  const name = propertyDisplayName(address);
  const context = propertyContextLine(address);

  return (
    <header className="border-b border-border bg-surface">
      <div className="container-shell py-8 md:py-12">
        <nav aria-label="Breadcrumb" className="mb-5">
          <ol className="flex flex-wrap items-center gap-1.5 text-label text-ink-muted">
            <li>
              <Link href="/search" className="rounded-sm hover:text-ink">
                {copy.search.heading}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link
                href={`/places/${address.countryCode.toLowerCase()}/${encodeURIComponent(
                  address.locality.toLowerCase(),
                )}`}
                className="rounded-sm hover:text-ink"
              >
                {address.locality}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-ink">{name}</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow>{propertyTypeLabel(property.propertyType, address.countryCode)}</Eyebrow>
              {property.isDemo && <Badge tone="accent">{copy.property.demoBadge}</Badge>}
              {isClaimed && <Badge tone="brand">{copy.property.claimed}</Badge>}
            </div>

            <h1 className="mt-3 font-display text-display-lg tracking-display text-ink">{name}</h1>

            <p className="mt-2 text-body-lg text-ink-muted">{context}</p>

            {/* The context line above already carries street, neighbourhood and
                city. Repeating the whole formatted address here just made the
                header say the same thing twice, which is most obvious on a
                phone. This adds only what is genuinely missing. */}
            <address className="mt-1 not-italic text-label text-ink-subtle">
              {[address.postalCode, market.name].filter(Boolean).join(' · ')}
            </address>

            {/* Score, on mobile, sits directly under the identity it describes. */}
            <div className="mt-7 flex items-center gap-5 lg:hidden">
              <ScoreDial
                score={intelligence.overallScore}
                confidence={intelligence.confidence}
                size="md"
              />
              <div className="flex flex-col gap-2">
                <ConfidenceChip
                  confidence={intelligence.confidence}
                  reviewCount={intelligence.reviewCount}
                />
                <TrendPill
                  direction={intelligence.trend.direction}
                  delta={intelligence.trend.delta}
                />
              </div>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              <SaveButton
                propertyId={property.id}
                propertySlug={property.slug}
                initiallySaved={isSaved}
                isSignedIn={user !== null}
              />
              <ShareButton />
              <Link
                href={`/review?property=${property.slug}`}
                className="rounded-md px-3 py-2.5 text-label font-medium text-brand underline underline-offset-4 transition-colors duration-fast hover:text-brand-hover"
              >
                {copy.property.writeReview}
              </Link>
            </div>
          </div>

          <Card className="w-full shrink-0 p-6 lg:w-80">
            <div className="hidden items-center gap-5 lg:flex">
              <ScoreDial
                score={intelligence.overallScore}
                confidence={intelligence.confidence}
                size="lg"
              />
              <div className="min-w-0">
                <p className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                  {copy.score.label}
                </p>
                <p className="mt-1 text-label text-ink-muted">
                  {intelligence.overallScore !== null
                    ? copy.score.outOf
                    : copy.score.confidenceExplainer.insufficient}
                </p>
              </div>
            </div>

            {/* Hidden below lg: the same two chips already sit beside the
                dial in the mobile header block above. */}
            <div className="hidden flex-wrap gap-2 lg:mt-5 lg:flex">
              <ConfidenceChip
                confidence={intelligence.confidence}
                reviewCount={intelligence.reviewCount}
              />
              <TrendPill
                direction={intelligence.trend.direction}
                delta={intelligence.trend.delta}
              />
            </div>

            <p className="mt-3 text-micro text-ink-subtle">
              {copy.score.confidenceExplainer[intelligence.confidence]}
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-5 border-t border-border pt-5">
              <Stat
                label="Residents"
                value={
                  <span className="text-body">
                    {copy.property.currentResidents(intelligence.currentResidentCount)} ·{' '}
                    {copy.property.formerResidents(intelligence.formerResidentCount)}
                  </span>
                }
              />
              <Stat
                label="Verified"
                value={<span className="text-body">{intelligence.verifiedReviewCount}</span>}
                hint={intelligence.verifiedReviewCount > 0 ? 'residency evidenced' : undefined}
              />

              {intelligence.recommendRate !== null && (
                <Stat
                  label="Would return"
                  value={
                    <span className="text-body">
                      {formatPercent(intelligence.recommendRate, address.countryCode)}
                    </span>
                  }
                  hint={`of ${intelligence.reviewCount} residents`}
                />
              )}

              {intelligence.reportedRent && (
                <Stat
                  label={copy.property.reportedRent}
                  value={
                    <span className="text-body">
                      {formatMoney(intelligence.reportedRent.median, {
                        countryCode: address.countryCode,
                        compact: true,
                      })}
                      <span className="text-ink-subtle">
                        /{intelligence.reportedRent.period === 'month' ? 'mo' : 'yr'}
                      </span>
                    </span>
                  }
                  hint={copy.property.rentBasis(intelligence.reportedRent.sampleSize)}
                />
              )}
            </dl>

            {intelligence.lastReviewAt && (
              <p className="mt-5 border-t border-border pt-4 text-micro text-ink-subtle">
                Last reviewed {formatRelativeTime(intelligence.lastReviewAt, address.countryCode)}
              </p>
            )}
          </Card>
        </div>
      </div>
    </header>
  );
}
