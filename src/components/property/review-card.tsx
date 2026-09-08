import { Badge, Card } from '@/components/ui/primitives';
import { categoryLabel } from '@/config/categories';
import { departureReasonLabel } from '@/config/departure-reasons';
import { tagLabel } from '@/config/tags';
import { copy } from '@/content/copy';
import { formatRelativeTime, formatRent } from '@/lib/format';
import { ratingToScore, scoreBand } from '@/lib/intelligence/scoring';
import { cn } from '@/lib/utils';
import type { PublicReview } from '@/types/domain';
import { VerificationBadge } from './verify-location';
import { ReportReviewButton } from './report-review';

/**
 * A single resident review.
 *
 * Note what identifies the author: whether they lived there, for how long, how
 * recently, and whether that was verified. Nothing else. There is no name, no
 * handle, no avatar and no link to a profile — because there is no profile, and
 * the `PublicReview` shape this component consumes has no author field to leak.
 *
 * The verification line is deliberately quiet. It is a subtitle, not a banner:
 * the review is what the reader came for, and a badge that shouts turns a trust
 * signal into a ranking. The precise moment of verification never appears —
 * "Verified 7 September at 4:13pm" would place a person at an address to the
 * minute — and neither does the record behind it.
 */
export function ReviewCard({
  review,
  countryCode,
  canReport,
  className,
}: {
  review: PublicReview;
  countryCode: string;
  canReport: boolean;
  className?: string;
}) {
  const band = scoreBand(ratingToScore(review.overallRating));

  const notableCategories = [...review.categoryRatings]
    .sort((a, b) => Math.abs(3 - b.rating) - Math.abs(3 - a.rating))
    .slice(0, 4);

  return (
    <Card as="article" className={cn('p-6', className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* The full sentence — "Current resident · Location verified" —
                lives in the heading, so recency and verification are readable
                without reference to any badge, colour or icon. */}
            <h3 className="text-body font-medium text-ink">{review.trustLabel}</h3>
            <VerificationBadge level={review.verificationLevel} />
            {review.isDemo && <Badge tone="accent">{copy.property.demoBadge}</Badge>}
          </div>
          <p className="mt-1 text-label text-ink-muted">
            {review.tenureLabel} · Written {formatRelativeTime(review.createdAt, countryCode)}
          </p>
        </div>

        <RatingPill rating={review.overallRating} band={band} />
      </header>

      {review.body && (
        <p className="prose-measure mt-4 whitespace-pre-line text-body-lg leading-relaxed text-ink">
          {review.body}
        </p>
      )}

      {(review.positiveTags.length > 0 || review.problemTags.length > 0) && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {review.positiveTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border border-positive/25 bg-positive-soft px-2.5 py-1 text-micro text-positive"
            >
              {tagLabel(tag)}
            </span>
          ))}
          {review.problemTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border border-caution/25 bg-caution-soft px-2.5 py-1 text-micro text-caution"
            >
              {tagLabel(tag)}
            </span>
          ))}
        </div>
      )}

      {notableCategories.length > 0 && (
        <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4">
          {notableCategories.map((rating) => (
            <div key={rating.categoryKey} className="flex items-baseline gap-1.5">
              <dt className="text-label text-ink-muted">{categoryLabel(rating.categoryKey)}</dt>
              <dd className="text-label font-medium tabular text-ink">{rating.rating}/5</dd>
            </div>
          ))}
        </dl>
      )}

      <footer className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-label text-ink-muted">
          {review.primaryDepartureReason && (
            <span>
              Left because of{' '}
              <span className="text-ink">
                {departureReasonLabel(review.primaryDepartureReason).toLowerCase()}
              </span>
            </span>
          )}
          {review.rent && review.rentPeriod && (
            <span>Paid {formatRent(review.rent, review.rentPeriod, countryCode)}</span>
          )}
          <span className={review.wouldRecommend ? 'text-positive' : 'text-ink-muted'}>
            {review.wouldRecommend ? 'Would live here again' : 'Would not live here again'}
          </span>
        </div>

        {canReport && <ReportReviewButton reviewId={review.id} />}
      </footer>

      {review.ownerResponse && (
        <div className="mt-5 rounded-md border-l-2 border-brand bg-brand-soft/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-label font-semibold text-brand-ink">
              {copy.property.ownerResponse}
            </h4>
            {review.ownerResponse.isResolutionNotice && (
              <Badge tone="positive">{copy.property.resolutionNotice}</Badge>
            )}
          </div>
          <p className="prose-measure mt-2 whitespace-pre-line text-body text-ink">
            {review.ownerResponse.body}
          </p>
          <p className="mt-2 text-micro text-ink-subtle">
            Responded {formatRelativeTime(review.ownerResponse.createdAt, countryCode)}
          </p>
        </div>
      )}
    </Card>
  );
}

function RatingPill({ rating, band }: { rating: number; band: string }) {
  const tone = {
    strong: 'border-score-strong/30 bg-positive-soft text-score-strong',
    good: 'border-score-good/30 bg-positive-soft text-score-good',
    mixed: 'border-score-mixed/30 bg-caution-soft text-score-mixed',
    weak: 'border-score-weak/30 bg-critical-soft text-score-weak',
    poor: 'border-score-poor/30 bg-critical-soft text-score-poor',
  }[band];

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-baseline gap-1 rounded-md border px-2.5 py-1',
        tone ?? 'border-border bg-surface-sunken text-ink-muted',
      )}
    >
      <span className="text-title-md font-medium tabular leading-none">{rating}</span>
      {/* Full token colour. `opacity-70` blended the score colour into the
          pill's tinted background and landed at 2.6:1. */}
      <span className="text-micro">/5</span>
      <span className="sr-only">overall rating</span>
    </span>
  );
}
