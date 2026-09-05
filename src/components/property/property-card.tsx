import Link from 'next/link';

import { Badge, Card, Meter } from '@/components/ui/primitives';
import { categoryLabel } from '@/config/categories';
import { copy } from '@/content/copy';
import { formatRelativeTime, propertyContextLine, propertyDisplayName } from '@/lib/format';
import { scoreBand } from '@/lib/intelligence/scoring';
import { standoutCategories } from '@/lib/intelligence/verdict';
import { propertyTypeLabel } from '@/config/markets';
import { cn } from '@/lib/utils';
import type { PropertySummary } from '@/types/domain';
import { ConfidenceChip, ScoreBadge, TrendPill } from './score';

/**
 * A property in a list.
 *
 * The card answers, in order: what is it, how did residents rate it, how much
 * evidence is behind that, and what stands out either way. A card that shows a
 * score without its confidence would be the most quietly misleading component
 * in the product, so the two are rendered together and neither is optional.
 */
export function PropertyCard({
  summary,
  action,
  className,
}: {
  summary: PropertySummary;
  action?: React.ReactNode;
  className?: string;
}) {
  const { property, intelligence } = summary;
  const { address } = property;

  const name = propertyDisplayName(address);
  const context = propertyContextLine(address);
  const standouts = standoutCategories(intelligence, 2);

  const worst = intelligence.categoryScores
    .filter((c) => c.score !== null && c.score <= 56)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];

  return (
    <Card interactive className={cn('group relative flex flex-col p-5', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-title-md tracking-tightish text-ink">
            {/* Stretched link: the whole card is the target, but only the name
                is in the accessibility tree as a link. */}
            <Link href={`/property/${property.slug}`} className="after:absolute after:inset-0">
              {name}
            </Link>
          </h3>
          <p className="mt-1 truncate text-label text-ink-muted">{context}</p>
        </div>

        <ScoreBadge
          score={intelligence.overallScore}
          confidence={intelligence.confidence}
          className="shrink-0"
        />
      </div>

      {intelligence.overallScore !== null && (
        <Meter
          value={intelligence.overallScore}
          tone={scoreBand(intelligence.overallScore)}
          label={`${copy.score.label} ${intelligence.overallScore} ${copy.score.outOf}`}
          className="mt-4"
        />
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ConfidenceChip
          confidence={intelligence.confidence}
          reviewCount={intelligence.reviewCount}
        />
        <TrendPill direction={intelligence.trend.direction} delta={intelligence.trend.delta} />
        {property.isDemo && <Badge tone="accent">{copy.property.demoBadge}</Badge>}
      </div>

      {(standouts.length > 0 || worst) && (
        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-label">
          {standouts.map((standout) => (
            <div key={standout.categoryKey} className="flex items-center gap-1.5">
              <dt className="text-ink-muted">{standout.label}</dt>
              <dd className="tabular font-medium text-score-strong">{standout.score}</dd>
            </div>
          ))}
          {worst && (
            <div className="flex items-center gap-1.5">
              <dt className="text-ink-muted">{categoryLabel(worst.categoryKey)}</dt>
              <dd className="tabular font-medium text-score-weak">{worst.score}</dd>
            </div>
          )}
        </dl>
      )}

      {intelligence.reviewCount === 0 && (
        <p className="mt-4 border-t border-border pt-4 text-label text-ink-subtle">
          {copy.property.reviewsEmptyTitle} · {propertyTypeLabel(property.propertyType, address.countryCode)}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-micro text-ink-subtle">
          {intelligence.lastReviewAt
            ? `Last reviewed ${formatRelativeTime(intelligence.lastReviewAt, address.countryCode)}`
            : propertyTypeLabel(property.propertyType, address.countryCode)}
        </p>
        {/* Sits above the stretched link so its own click is not swallowed. */}
        {action && <div className="relative z-10">{action}</div>}
      </div>
    </Card>
  );
}

export function PropertyCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="h-5 w-2/3 rounded-md bg-surface-sunken" />
          <div className="h-4 w-1/2 rounded-md bg-surface-sunken" />
        </div>
        <div className="h-7 w-14 rounded-md bg-surface-sunken" />
      </div>
      <div className="mt-4 h-1.5 w-full rounded-full bg-surface-sunken" />
      <div className="mt-4 flex gap-2">
        <div className="h-6 w-28 rounded-full bg-surface-sunken" />
        <div className="h-6 w-20 rounded-full bg-surface-sunken" />
      </div>
      <div className="mt-4 border-t border-border pt-4">
        <div className="h-4 w-3/4 rounded-md bg-surface-sunken" />
      </div>
    </div>
  );
}
