import Link from 'next/link';

import { Badge, Card, EmptyState, Stat } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { formatRelativeTime } from '@/lib/format';
import { normaliseAuditAction, readAttention } from '@/server/admin';
import { hasRole } from '@/server/auth/guards';
import { getCurrentUser } from '@/server/auth/session';
import { getRepository } from '@/server/data';
import type { AttentionQueue } from '@/server/data/repository';
import { actionLabel } from './audit/labels';

/**
 * The console's first page.
 *
 * It used to ask "how much is there" and answer with five cards that were
 * usually zeros. Five zeros is not an absence of work; it is noise with an
 * absence of work hidden inside it, and a dashboard that looks the same on a
 * quiet Tuesday as on the morning somebody has been mass-reporting a building
 * is a dashboard nobody scans.
 *
 * So it asks what needs attention, and the difference is almost entirely one
 * extra fact per queue: how long the oldest thing has waited.
 *
 * A count says three reports are open. It cannot say one has been open nine
 * days, which is the part a person seeing the number acts on. Everything here
 * degrades with time — an unreviewed report is still visible, a resident
 * waiting on verification is waiting with their review counting for less — so
 * age is the signal and the count is context.
 *
 * Empty queues are not shown. Something with nothing waiting is not something
 * that needs attention, and the page says so in one line rather than in five
 * cards saying nothing.
 */

export const dynamic = 'force-dynamic';

/** Days since an instant, or null when nothing is waiting. */
function daysWaiting(oldest: string | null): number | null {
  if (!oldest) return null;
  return Math.floor((Date.now() - new Date(oldest).getTime()) / 86_400_000);
}

/**
 * How loudly a queue asks.
 *
 * Age rather than size, and the thresholds are deliberately generous: a report
 * open for two days is a normal working queue, and colouring it would teach
 * people to ignore the colour.
 */
function urgency(queue: AttentionQueue): 'critical' | 'caution' | 'neutral' {
  const days = daysWaiting(queue.oldest);
  if (days === null) return 'neutral';
  if (days >= 7) return 'critical';
  if (days >= 3) return 'caution';
  return 'neutral';
}

function waitingLabel(queue: AttentionQueue): string | null {
  const days = daysWaiting(queue.oldest);
  if (days === null) return null;
  if (days === 0) return 'oldest today';
  if (days === 1) return 'oldest a day';
  return `oldest ${days} days`;
}

export default async function AdminDashboard() {
  const viewer = await getCurrentUser();
  const attention = await readAttention();

  const queues = [
    {
      href: '/admin/queue',
      label: copy.admin.queue,
      queue: attention.pendingReviews,
      noun: 'reviews held for a decision',
    },
    {
      href: '/admin/reports',
      label: copy.admin.reports,
      queue: attention.openReports,
      noun: 'reports nobody has resolved',
    },
    {
      href: '/admin/verification',
      label: copy.admin.verificationQueue,
      queue: attention.pendingVerifications,
      noun: 'residents waiting to be recognised as having lived there',
    },
    {
      href: '/admin/flags',
      label: copy.admin.flags,
      queue: attention.openFlags,
      noun: 'properties whose review activity does not fit their own history',
    },
    {
      href: '/admin/claims',
      label: copy.admin.claims,
      queue: attention.pendingClaims,
      noun: 'ownership claims awaiting a decision',
    },
  ].filter((entry) => entry.queue.count > 0);

  const { cases, trustAndSafety, platform } = attention;

  // The moderation trail only — decisions, not identity access. A moderator is
  // entitled to see what colleagues decided about content; who looked up whose
  // identity is the audit trail, which is Trust & Safety's and says so.
  const repository = await getRepository();
  const recentDecisions = await repository.listModerationActions(undefined, 8);

  const clear =
    queues.length === 0 && cases.open === 0 && (trustAndSafety?.openAuthorityRequests ?? 0) === 0;

  return (
    <div className="flex flex-col gap-10">
      {/* ---- What needs attention -------------------------------------- */}

      <section aria-labelledby="attention-heading">
        <h2
          id="attention-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Needs attention
        </h2>

        {clear ? (
          <EmptyState
            headingLevel="h3"
            className="mt-4"
            title="Nothing is waiting"
            description="Every queue is empty and no case is open. This is what a quiet day looks like — the counts come back on their own when there is something to do."
          />
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {queues.map((entry) => {
              const tone = urgency(entry.queue);
              const waiting = waitingLabel(entry.queue);

              return (
                <li key={entry.href}>
                  <Link href={entry.href} className="block">
                    <Card
                      interactive
                      className={
                        tone === 'critical'
                          ? 'border-l-2 border-l-critical p-5'
                          : tone === 'caution'
                            ? 'border-l-2 border-l-caution p-5'
                            : 'p-5'
                      }
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-label font-medium text-ink">{entry.label}</p>
                        {waiting && (
                          <span
                            className={
                              tone === 'critical'
                                ? 'text-micro font-medium text-critical'
                                : 'text-micro text-ink-subtle'
                            }
                          >
                            {waiting}
                          </span>
                        )}
                      </div>

                      <p className="tabular mt-2 font-display text-[2rem] leading-none text-ink">
                        {entry.queue.count}
                      </p>
                      <p className="mt-2 text-micro text-ink-subtle">{entry.noun}</p>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---- Cases ------------------------------------------------------ */}

      {cases.open > 0 && (
        <section aria-labelledby="cases-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2
              id="cases-heading"
              className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
            >
              Cases
            </h2>
            <Link
              href="/admin/cases"
              className="text-label text-ink-muted underline underline-offset-4 hover:text-ink"
            >
              All cases
            </Link>
          </div>

          <Card className="mt-4 p-5">
            <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Stat label="Open" value={cases.open} />
              <Stat
                label="Yours"
                value={cases.mine}
                hint={cases.mine === 0 ? 'none assigned to you' : undefined}
              />
              <Stat
                label="Unassigned"
                value={cases.unassigned}
                hint={cases.unassigned > 0 ? 'nobody has picked these up' : undefined}
              />
              <Stat label="Critical" value={cases.critical} />
            </dl>

            {cases.oldest && (
              <p className="mt-4 border-t border-border pt-3 text-micro text-ink-subtle">
                The oldest open case was opened {formatRelativeTime(cases.oldest)}.
              </p>
            )}
          </Card>
        </section>
      )}

      {/* ---- Trust & Safety --------------------------------------------- */}

      {trustAndSafety && (
        <section aria-labelledby="ts-heading">
          <h2
            id="ts-heading"
            className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
          >
            Trust &amp; Safety
          </h2>

          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TrustFigure
              href="/admin/authority-requests"
              label="Authority requests"
              value={trustAndSafety.openAuthorityRequests}
              hint="not yet decided"
            />
            <TrustFigure
              href="/admin/cases"
              label="Preservation holds"
              value={trustAndSafety.preservationHolds}
              hint="cases whose material must not be deleted"
            />
            <TrustFigure
              href="/admin/sanctions"
              label="Sanctions ending"
              value={trustAndSafety.sanctionsExpiring}
              hint="within seven days"
            />
            <TrustFigure
              href="/admin/audit?outcome=denied&since=7d"
              label="Refused attempts"
              value={trustAndSafety.refusalsLast7Days}
              hint="in the last seven days"
              // One is ordinary. A run of them from one account is what an
              // access log exists to surface, which is why this links straight
              // into the trail already filtered.
              flagWhenAbove={2}
            />
          </ul>
        </section>
      )}

      {/* ---- Recent decisions -------------------------------------------- */}

      <section aria-labelledby="recent-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2
            id="recent-heading"
            className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
          >
            Recent decisions
          </h2>
          {hasRole(viewer, 'trust_admin') && (
            <Link
              href="/admin/audit"
              className="text-label text-ink-muted underline underline-offset-4 hover:text-ink"
            >
              {copy.admin.auditTrail}
            </Link>
          )}
        </div>

        <p className="mt-2 max-w-prose text-label text-ink-muted">
          What was decided about content and accounts, newest first. Append-only: the entry and
          the change it describes are written together, and nothing can edit or delete either.
          {hasRole(viewer, 'trust_admin')
            ? ' Who looked at whose information is the audit trail.'
            : ' Who looked at whose information is recorded separately, and read by Trust & Safety.'}
        </p>

        {recentDecisions.length === 0 ? (
          <EmptyState
            headingLevel="h3"
            className="mt-4"
            title="No decisions yet"
            description="Nothing has been decided about any review, account or claim."
          />
        ) : (
          <ol className="mt-4 flex flex-col gap-2">
            {recentDecisions.map((decision) => (
              <li key={decision.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-label font-medium text-ink">
                      {actionLabel(normaliseAuditAction(decision.action))}
                    </p>
                    <p className="text-micro text-ink-subtle">
                      {formatRelativeTime(decision.createdAt)}
                    </p>
                  </div>

                  <p className="mt-1 flex flex-wrap items-center gap-2 text-micro text-ink-subtle">
                    <span className="font-mono">{decision.subjectId.slice(0, 8)}</span>
                    {decision.previousStatus && decision.newStatus && (
                      <Badge>
                        {decision.previousStatus.replace(/_/g, ' ')} →{' '}
                        {decision.newStatus.replace(/_/g, ' ')}
                      </Badge>
                    )}
                  </p>

                  {decision.reason && (
                    <p className="prose-measure mt-2 text-label text-ink">{decision.reason}</p>
                  )}
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ---- Platform ---------------------------------------------------- */}

      <section aria-labelledby="platform-heading">
        <h2
          id="platform-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Platform
        </h2>
        <Card className="mt-4 p-6">
          <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Properties" value={platform.properties} />
            <Stat label="Published reviews" value={platform.reviews} />
            <Stat label="Accounts" value={platform.users} />
            <Stat
              label="Reviews, 30 days"
              value={platform.reviewsLast30Days}
              hint="the number that matters"
            />
          </dl>
        </Card>
      </section>
    </div>
  );
}

function TrustFigure({
  href,
  label,
  value,
  hint,
  flagWhenAbove,
}: {
  href: string;
  label: string;
  value: number;
  hint: string;
  flagWhenAbove?: number;
}) {
  const flagged = flagWhenAbove !== undefined && value > flagWhenAbove;

  return (
    <li>
      <Link href={href} className="block">
        <Card
          interactive
          className={flagged ? 'border-l-2 border-l-caution p-5' : 'p-5'}
        >
          <p className="text-label font-medium text-ink">{label}</p>
          <p
            className={`tabular mt-2 font-display text-[2rem] leading-none ${
              value > 0 ? 'text-ink' : 'text-ink-subtle'
            }`}
          >
            {value}
          </p>
          <p className="mt-2 text-micro text-ink-subtle">{hint}</p>
        </Card>
      </Link>
    </li>
  );
}
