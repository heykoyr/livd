import Link from 'next/link';

import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { formatRelativeTime, propertyDisplayName } from '@/lib/format';
import { getRepository } from '@/server/data';
import { ReportControls, ReviewStatusControls } from '../moderation-controls';

/**
 * Open reports.
 *
 * The reported review is shown in full beside the complaint, because a report
 * is an accusation and deciding on one without reading what was actually
 * written is how legitimate reviews get removed.
 */
export default async function ReportsPage() {
  const repository = await getRepository();
  const reports = await repository.listReports('open');

  if (reports.length === 0) {
    return (
      <EmptyState
        title="No open reports"
        description="Reports from readers appear here. Nothing is removed automatically — a report opens a decision, it does not make one."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-5">
      {reports.map(({ report, review, property }) => (
        <li key={report.id}>
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <Badge tone="critical">{copy.safety.reportReasons[report.reason]}</Badge>
                <Link
                  href={`/property/${property.slug}`}
                  className="mt-3 block font-display text-title-md tracking-tightish text-ink hover:underline"
                >
                  {propertyDisplayName(property.address)}
                </Link>
                <p className="mt-1 text-label text-ink-subtle">
                  Reported {formatRelativeTime(report.createdAt)}
                </p>
              </div>
              <span className="shrink-0 text-title-md tabular text-ink">
                {review.overallRating}/5
              </span>
            </div>

            {report.detail && (
              <p className="mt-4 rounded-md border-l-2 border-critical bg-critical-soft/60 p-4 text-body text-ink">
                {report.detail}
              </p>
            )}

            {review.body && (
              <div className="mt-4">
                <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                  The review as published
                </h3>
                <p className="prose-measure mt-2 whitespace-pre-line rounded-md bg-surface-sunken/60 p-4 text-body text-ink">
                  {review.body}
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-6 border-t border-border pt-5">
              <ReportControls reportId={report.id} />
              <div className="border-t border-border pt-5">
                <h3 className="mb-3 text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                  Act on the review itself
                </h3>
                <ReviewStatusControls reviewId={review.id} currentStatus={review.status} />
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
