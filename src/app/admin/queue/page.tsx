import Link from 'next/link';

import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { formatRelativeTime, formatTenure, propertyDisplayName } from '@/lib/format';
import { getRepository } from '@/server/data';
import { ReviewStatusControls, VerificationControls } from '../moderation-controls';

/**
 * The moderation queue.
 *
 * Reviews held by the safety pipeline, with the flags that put them here shown
 * up front so a moderator can triage without reading every word first.
 */
export default async function ModerationQueuePage() {
  const repository = await getRepository();
  const held = await repository.listReviewsByStatus('pending_moderation', 50);

  if (held.length === 0) {
    return (
      <EmptyState
        title={copy.admin.emptyQueue}
        description="Reviews appear here when the content linter flags something a person needs to read — most often a serious allegation stated as fact."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-5">
      {held.map(({ review, property }) => (
        <li key={review.id}>
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <Link
                  href={`/property/${property.slug}`}
                  className="font-display text-title-md tracking-tightish text-ink hover:underline"
                >
                  {propertyDisplayName(property.address)}
                </Link>
                <p className="mt-1 text-label text-ink-muted">
                  {review.residencyStatus === 'current' ? 'Current' : 'Former'} resident ·{' '}
                  {formatTenure(review.tenureMonths)} · submitted{' '}
                  {formatRelativeTime(review.createdAt)}
                </p>
              </div>
              <span className="shrink-0 text-title-md tabular text-ink">
                {review.overallRating}/5
              </span>
            </div>

            {review.safetyFlags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {review.safetyFlags.map((flag) => (
                  <Badge key={flag} tone="caution">
                    {flag.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
            )}

            {review.body && (
              <p className="prose-measure mt-4 whitespace-pre-line rounded-md bg-surface-sunken/60 p-4 text-body text-ink">
                {review.body}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-5 border-t border-border pt-5">
              {/* Deciding from the card is fine for something obvious. Anything
                  that needs the author's history, the property's activity or
                  the verification trail belongs on the investigation view. */}
              <p className="text-label">
                <Link
                  href={`/admin/reviews/${review.id}`}
                  className="text-ink underline underline-offset-4"
                >
                  Investigate this review
                </Link>
                <span className="ml-2 text-ink-subtle">
                  — author history, verification and property activity
                </span>
              </p>

              <ReviewStatusControls reviewId={review.id} currentStatus={review.status} />
              <VerificationControls reviewId={review.id} />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
