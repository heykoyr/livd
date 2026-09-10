import Link from 'next/link';

import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { formatRelativeTime, propertyContextLine, propertyDisplayName } from '@/lib/format';
import { listAccountSignals } from '@/server/admin';
import { getRepository } from '@/server/data';
import type { AccountSignalKind, PropertyFlag } from '@/types/domain';
import { FlagControls } from '../moderation-controls';
import { AccountSignalControls, InvestigateControls } from './controls';

/**
 * Signals.
 *
 * Everything on this page is a question, not a finding. A property written
 * about by twenty delighted residents produces the same shape in the data as
 * one being astroturfed; the difference is a judgement, and this queue exists
 * so that a person makes it.
 *
 * Each card shows the arithmetic that raised it, so a moderator can disagree
 * with the rule rather than only with its conclusion.
 *
 * TWO KINDS, AND THE SECOND IS NEW
 *
 * The original detector could only see abuse that concentrates on one
 * building. That left two things invisible.
 *
 * The first is reporting. The lever an unhappy owner actually has is not
 * writing reviews — it is reporting them — and twelve reports against one
 * property in a day is the shape of a campaign to get honest reviews taken
 * down. Upholding a report has never removed anything, so a campaign could not
 * mechanically succeed, but it could exhaust somebody into agreeing and nobody
 * would have seen the shape of it.
 *
 * The second is one account across many buildings. One glowing review of each
 * of twenty properties in an afternoon is not a burst anywhere; the pattern
 * only exists when you stop looking building by building.
 *
 * NOTHING ON THIS PAGE ACTS
 *
 * Deciding a signal changes the signal. It does not hide a review, move a
 * score or restrict an account — each of those is a separate decision with its
 * own authorisation and its own written reason. The third control is the
 * important one: it opens a case, which is how a signal becomes an
 * investigation rather than a verdict.
 */

export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<PropertyFlag['kind'], string> = {
  review_burst: 'Unusual pace',
  rating_anomaly: 'Ratings moved sharply',
  new_account_concentration: 'New accounts',
  report_campaign: 'Reports arriving together',
};

const ACCOUNT_KIND_LABELS: Record<AccountSignalKind, string> = {
  author_spread: 'Writing across many buildings',
  serial_reporter: 'Reporting a great deal, and wrong',
};

const SEVERITY: Record<1 | 2 | 3, { label: string; tone: 'neutral' | 'caution' | 'critical' }> = {
  1: { label: 'Worth a glance', tone: 'neutral' },
  2: { label: 'Hard to explain innocently', tone: 'caution' },
  3: { label: 'Look at this today', tone: 'critical' },
};

/** Turns `reviews_in_window` into `Reviews in window`, for the evidence list. */
function humanise(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Evidence({ observed }: { observed: Record<string, number | string | null> }) {
  const entries = Object.entries(observed).filter(([, value]) => value !== null);
  if (entries.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
        What the rule measured
      </h3>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-label">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-center gap-1.5">
            <dt className="text-ink-muted">{humanise(key)}</dt>
            <dd className="tabular font-medium text-ink">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default async function SignalsPage() {
  const repository = await getRepository();

  const [flags, signals] = await Promise.all([
    repository.listPropertyFlags('open'),
    listAccountSignals('open'),
  ]);

  if (flags.length === 0 && signals.length === 0) {
    return (
      <EmptyState
        title="Nothing unusual"
        description="Review and report activity is checked every hour against each property's own history, and each account's behaviour against everybody else's. Anything that does not fit appears here for a person to decide about — it is never acted on automatically."
      />
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {/* ---- Properties ------------------------------------------------- */}

      {flags.length > 0 && (
        <section aria-labelledby="property-signals">
          <h2
            id="property-signals"
            className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
          >
            Properties
          </h2>

          <ul className="mt-4 flex flex-col gap-5">
            {flags.map(({ flag, property }) => {
              const severity = SEVERITY[flag.severity];

              return (
                <li key={flag.id}>
                  <Card className="p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={severity.tone}>{severity.label}</Badge>
                          <Badge>{KIND_LABELS[flag.kind]}</Badge>
                          {flag.caseReference && (
                            <Badge tone="info">{flag.caseReference}</Badge>
                          )}
                        </div>

                        <h3 className="mt-3 font-display text-title-md tracking-tightish text-ink">
                          <Link href={`/property/${property.slug}`} className="hover:underline">
                            {propertyDisplayName(property.address)}
                          </Link>
                        </h3>
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

                    {flag.kind === 'report_campaign' && (
                      <p className="prose-measure mt-3 text-label text-ink-muted">
                        Reports do not remove anything on their own, and upholding one is a
                        separate decision from taking a review down. What this is for is seeing
                        the shape of a campaign before somebody is worn down by it.
                      </p>
                    )}

                    <Evidence observed={flag.observed} />

                    <div className="mt-6 flex flex-col gap-5 border-t border-border pt-5">
                      <InvestigateControls signalKind="property" signalId={flag.id} />

                      <div className="border-t border-border pt-5">
                        <FlagControls flagId={flag.id} />
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ---- Accounts ---------------------------------------------------- */}

      {signals.length > 0 && (
        <section aria-labelledby="account-signals">
          <h2
            id="account-signals"
            className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
          >
            Accounts
          </h2>
          <p className="mt-2 max-w-prose text-label text-ink-muted">
            Patterns that are invisible property by property. The account is identified by its
            id and nothing else — establishing that one account did all of this does not require
            knowing who they are, and finding that out is a separate decision with a reason and a
            record.
          </p>

          <ul className="mt-4 flex flex-col gap-5">
            {signals.map((signal) => {
              const severity = SEVERITY[signal.severity];

              return (
                <li key={signal.id}>
                  <Card className="p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={severity.tone}>{severity.label}</Badge>
                          <Badge>{ACCOUNT_KIND_LABELS[signal.kind]}</Badge>
                          {signal.caseReference && (
                            <Badge tone="info">{signal.caseReference}</Badge>
                          )}
                        </div>

                        <h3 className="mt-3 font-mono text-title-sm text-ink">
                          <Link
                            href={`/admin/users/${signal.userId}`}
                            className="hover:underline"
                          >
                            {signal.userId.slice(0, 8)}
                          </Link>
                        </h3>
                      </div>

                      <p className="shrink-0 text-label text-ink-subtle">
                        Raised {formatRelativeTime(signal.createdAt)}
                      </p>
                    </div>

                    <p className="mt-4 rounded-md border-l-2 border-caution bg-caution-soft/50 p-4 text-body text-ink">
                      {signal.detail}
                    </p>

                    {signal.kind === 'author_spread' && (
                      <p className="prose-measure mt-3 text-label text-ink-muted">
                        People do move, and somebody catching up on three old flats in one
                        evening looks exactly like this. The question is whether the reviews read
                        like one person who lived somewhere.
                      </p>
                    )}

                    {signal.kind === 'serial_reporter' && (
                      <p className="prose-measure mt-3 text-label text-ink-muted">
                        Reporting a great deal is not the signal. Reporting a great deal and
                        being wrong about it is — and an unresolved report counts as neither, so
                        nobody is flagged for a backlog that is the queue&rsquo;s own fault.
                      </p>
                    )}

                    <Evidence observed={signal.observed} />

                    <div className="mt-6 flex flex-col gap-5 border-t border-border pt-5">
                      <InvestigateControls signalKind="account" signalId={signal.id} />

                      <div className="border-t border-border pt-5">
                        <AccountSignalControls signalId={signal.id} />
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
