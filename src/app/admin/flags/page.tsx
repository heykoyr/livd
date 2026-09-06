import Link from 'next/link';

import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { formatRelativeTime, propertyContextLine, propertyDisplayName } from '@/lib/format';
import { getRepository } from '@/server/data';
import type { PropertyFlag } from '@/types/domain';
import { FlagControls } from '../moderation-controls';

/**
 * Automated signals.
 *
 * Everything on this page is a question, not a finding. A property written
 * about by twenty delighted residents produces the same shape in the data as
 * one being astroturfed; the difference is a judgement, and this queue exists
 * so that a person makes it.
 *
 * Each card shows the arithmetic that raised it, so a moderator can disagree
 * with the rule rather than only with its conclusion.
 */

const KIND_LABELS: Record<PropertyFlag['kind'], string> = {
  review_burst: 'Unusual pace',
  rating_anomaly: 'Ratings moved sharply',
  new_account_concentration: 'New accounts',
};

const SEVERITY: Record<1 | 2 | 3, { label: string; tone: 'neutral' | 'caution' | 'critical' }> = {
  1: { label: 'Worth a glance', tone: 'neutral' },
  2: { label: 'Hard to explain innocently', tone: 'caution' },
  3: { label: 'Look at this today', tone: 'critical' },
};

/** Turns `reviews_in_window` into `Reviews in window`, for the evidence table. */
function humanise(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default async function FlagsPage() {
  const repository = await getRepository();
  const flags = await repository.listPropertyFlags('open');

  if (flags.length === 0) {
    return (
      <EmptyState
        title="Nothing unusual"
        description="Review activity is checked every hour against each property's own history. Anything that does not fit appears here for a decision — it is never acted on automatically."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-5">
      {flags.map(({ flag, property }) => {
        const severity = SEVERITY[flag.severity];
        const evidence = Object.entries(flag.observed).filter(([, value]) => value !== null);

        return (
          <li key={flag.id}>
            <Card className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={severity.tone}>{severity.label}</Badge>
                    <Badge>{KIND_LABELS[flag.kind]}</Badge>
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
                  Raised {formatRelativeTime(flag.createdAt)}
                </p>
              </div>

              <p className="mt-4 rounded-md border-l-2 border-caution bg-caution-soft/50 p-4 text-body text-ink">
                {flag.detail}
              </p>

              {evidence.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                    What the rule measured
                  </h3>
                  <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-label">
                    {evidence.map(([key, value]) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <dt className="text-ink-muted">{humanise(key)}</dt>
                        <dd className="tabular font-medium text-ink">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              <div className="mt-6 border-t border-border pt-5">
                <FlagControls flagId={flag.id} />
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
