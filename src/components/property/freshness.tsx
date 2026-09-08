import { RECENCY } from '@/config/verification';
import { copy } from '@/content/copy';
import { formatRelativeTime } from '@/lib/format';
import { freshnessVerdict } from '@/lib/intelligence/recency';
import { Card } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { PropertyIntelligence } from '@/types/domain';

/**
 * How current a property's evidence is.
 *
 * The most useful thing on the page after the score itself, and the reason is
 * simple: a 78/100 built from residents who left in 2019 and a 78/100 built
 * from residents who were there last month are different claims about the same
 * building, and until now Livd presented them identically.
 *
 * Deliberately not a score. There is no "freshness rating" out of ten, because
 * a second number beside the first invites the reader to combine them and there
 * is no honest way to. These are counts and a sentence.
 *
 * Colour is never the message. Each bucket is a word first; the tint is a
 * secondary cue and the counts are legible in monochrome — which also means
 * the panel survives a reader who cannot distinguish the tints at all.
 */
export function ResidentFreshnessPanel({
  intelligence,
  countryCode,
  className,
}: {
  intelligence: PropertyIntelligence;
  countryCode: string;
  className?: string;
}) {
  const { freshness } = intelligence;
  const verdict = freshnessVerdict(freshness);

  if (verdict === 'none') return null;

  const buckets = [
    { key: 'current' as const, count: freshness.current },
    { key: 'recent' as const, count: freshness.recent },
    { key: 'former' as const, count: freshness.former },
    { key: 'older' as const, count: freshness.older },
  ].filter((bucket) => bucket.count > 0);

  return (
    <Card className={cn('p-6 md:p-7', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-title-lg tracking-tightish text-ink">
          {copy.verification.freshnessTitle}
        </h2>
        <p className="text-label font-medium text-ink-muted">
          {copy.verification.freshness[verdict]}
        </p>
      </div>

      <p className="mt-2 max-w-prose text-body text-ink-muted">
        {verdict === 'fresh'
          ? copy.verification.freshnessExplainer.fresh(
              freshness.reviewsInActivityWindow,
              RECENCY.activityWindowDays,
            )
          : verdict === 'moderate'
            ? copy.verification.freshnessExplainer.moderate(
                freshness.reviewsInActivityWindow,
                RECENCY.activityWindowDays,
              )
            : copy.verification.freshnessExplainer.limited}
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        {buckets.map((bucket) => (
          <div key={bucket.key} className="min-w-0">
            <dt className="flex items-center gap-2 text-label text-ink-muted">
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  bucket.key === 'current'
                    ? 'bg-positive'
                    : bucket.key === 'recent'
                      ? 'bg-positive/55'
                      : bucket.key === 'former'
                        ? 'bg-ink-subtle/60'
                        : 'bg-ink-subtle/30',
                )}
              />
              <span className="truncate">{copy.verification.recency[bucket.key]}</span>
            </dt>
            <dd className="mt-1 text-title-lg font-medium tabular text-ink">{bucket.count}</dd>
          </div>
        ))}
      </dl>

      {(freshness.verifiedCount > 0 || intelligence.lastReviewAt) && (
        <div className="mt-6 flex flex-col gap-1.5 border-t border-border pt-4 text-label text-ink-muted">
          {freshness.verifiedCount > 0 && (
            <p>
              {copy.verification.evidenceCounts(
                intelligence.reviewCount,
                freshness.verifiedCount,
              )}
              .
            </p>
          )}
          {intelligence.lastReviewAt && (
            // Relative time, never a date. "A resident shared an experience 12
            // days ago" is the useful form; "on 26 August at 19:04" would place
            // a person at an address at a moment, which is not the reader's to
            // know and not the writer's to have to expose.
            <p>
              {copy.verification.recentlyReviewed(
                formatRelativeTime(intelligence.lastReviewAt, countryCode),
              )}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * The one-line version, for the property header.
 *
 * Says nothing when there is nothing worth saying — a property with no recent
 * activity gets silence rather than "0 residents in the last 90 days", which
 * reads as a judgement on the building rather than a statement about Livd's
 * coverage of it.
 */
export function FreshnessLine({
  intelligence,
  className,
}: {
  intelligence: PropertyIntelligence;
  className?: string;
}) {
  const recent = intelligence.freshness.reviewsInActivityWindow;
  if (recent === 0) return null;

  return (
    <p className={cn('text-label text-ink-muted', className)}>
      {copy.verification.recentActivity(recent, RECENCY.activityWindowDays)}
    </p>
  );
}
