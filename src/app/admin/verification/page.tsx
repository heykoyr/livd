import Link from 'next/link';

import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { formatRelativeTime, propertyContextLine, propertyDisplayName } from '@/lib/format';
import { getRepository } from '@/server/data';
import type { VerificationMethod } from '@/types/domain';
import { VerificationControlsForRecord, EvidenceViewer } from '../moderation-controls';

/**
 * Residency proof awaiting a decision.
 *
 * The whole pipeline exists to put a document and a judgement in front of one
 * person. Everything a machine could settle has been settled already and is
 * listed on the card; what is left is the part a machine should not do.
 *
 * The evidence is not on this page. It is fetched on demand, through a link
 * that lasts minutes, because a tenancy agreement carries a name, an address
 * and a signature — and the person who handed it over did so precisely in order
 * to stay anonymous. Rendering it into the HTML of a page that might be cached,
 * screenshotted or left open would undo that.
 */

const METHOD_LABELS: Record<VerificationMethod, string> = {
  tenancy_agreement: 'Tenancy agreement',
  utility_bill: 'Utility bill',
  correspondence: 'Addressed correspondence',
  other: 'Something else',
};

function readableSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)}KB`
    : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export default async function VerificationPage() {
  const repository = await getRepository();
  const pending = await repository.listPendingVerifications();

  if (pending.length === 0) {
    return (
      <EmptyState
        title="Nothing waiting"
        description="Residents who want their review marked as verified submit a document here. Nothing is approved automatically — verification multiplies a review's weight in the score, so a person decides every one."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-5">
      {pending.map(({ record, review, property }) => {
        const blocking = record.checks.filter((check) => check.severity === 'blocking');
        const notes = record.checks.filter((check) => check.severity === 'note');
        const size = readableSize(record.evidenceBytes);

        return (
          <li key={record.id}>
            <Card className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info">{METHOD_LABELS[record.method]}</Badge>
                    {record.checks.length === 0 && <Badge tone="positive">Nothing flagged</Badge>}
                    {notes.length > 0 && (
                      <Badge tone="caution">
                        {notes.length} thing{notes.length === 1 ? '' : 's'} to weigh
                      </Badge>
                    )}
                    {blocking.length > 0 && <Badge tone="critical">Blocked</Badge>}
                  </div>

                  <h2 className="mt-3 font-display text-title-md tracking-tightish text-ink">
                    <Link href={`/property/${property.slug}`} className="hover:underline">
                      {propertyDisplayName(property.address)}
                    </Link>
                  </h2>
                  <p className="mt-1 text-label text-ink-muted">
                    {propertyContextLine(property.address)}
                  </p>
                </div>

                <p className="shrink-0 text-label text-ink-subtle">
                  Submitted {formatRelativeTime(record.createdAt)}
                </p>
              </div>

              <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-4 text-label">
                <div>
                  <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                    Tenancy claimed
                  </dt>
                  <dd className="mt-1 tabular text-ink">
                    {review.movedInMonth.slice(0, 7)} to{' '}
                    {review.movedOutMonth ? review.movedOutMonth.slice(0, 7) : 'now'}
                  </dd>
                </div>
                <div>
                  <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                    Residency
                  </dt>
                  <dd className="mt-1 text-ink">
                    {review.residencyStatus === 'current' ? 'Current resident' : 'Former resident'}
                  </dd>
                </div>
                {size && (
                  <div>
                    <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                      Document
                    </dt>
                    <dd className="mt-1 text-ink">
                      {record.evidenceMime ?? 'unknown type'} · {size}
                    </dd>
                  </div>
                )}
              </dl>

              {record.checks.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                    What the automated checks found
                  </h3>
                  <ul className="mt-2 flex flex-col gap-2">
                    {record.checks.map((check) => (
                      <li
                        key={check.code}
                        className={
                          check.severity === 'blocking'
                            ? 'rounded-md border-l-2 border-critical bg-critical-soft/50 p-3 text-label text-ink'
                            : 'rounded-md border-l-2 border-caution bg-caution-soft/40 p-3 text-label text-ink'
                        }
                      >
                        {check.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-5 border-t border-border pt-5">
                <EvidenceViewer recordId={record.id} mime={record.evidenceMime} />
              </div>

              <div className="mt-5 border-t border-border pt-5">
                <VerificationControlsForRecord recordId={record.id} />
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
