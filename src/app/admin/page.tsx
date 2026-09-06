import Link from 'next/link';

import { Card, Stat } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { formatRelativeTime } from '@/lib/format';
import { getRepository } from '@/server/data';

export default async function AdminDashboard() {
  const repository = await getRepository();

  const [overview, recentActions] = await Promise.all([
    repository.adminOverview(),
    repository.listModerationActions(undefined, 12),
  ]);

  const queues = [
    {
      href: '/admin/queue',
      label: copy.admin.queue,
      count: overview.pendingModerationCount,
      hint: 'reviews held for a decision',
    },
    {
      href: '/admin/reports',
      label: copy.admin.reports,
      count: overview.openReportCount,
      hint: 'open reports',
    },
    {
      href: '/admin/flags',
      label: copy.admin.flags,
      count: overview.openFlagCount,
      hint: 'properties whose review activity does not fit their own history',
    },
    {
      href: '/admin/claims',
      label: copy.admin.claims,
      count: overview.pendingClaimCount,
      hint: 'ownership claims awaiting review',
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
          Needs attention
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          {queues.map((queue) => (
            <li key={queue.href}>
              <Link href={queue.href} className="block">
                <Card interactive className="p-5">
                  <p className="text-label font-medium text-ink">{queue.label}</p>
                  <p
                    className={`mt-2 font-display text-[2rem] leading-none tabular ${
                      queue.count > 0 ? 'text-accent' : 'text-ink-subtle'
                    }`}
                  >
                    {queue.count}
                  </p>
                  <p className="mt-2 text-micro text-ink-subtle">{queue.hint}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
          Platform
        </h2>
        <Card className="mt-4 p-6">
          <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Properties" value={overview.propertyCount} />
            <Stat label="Published reviews" value={overview.reviewCount} />
            <Stat label="Accounts" value={overview.userCount} />
            <Stat
              label="Reviews, 30 days"
              value={overview.reviewsLast30Days}
              hint="the number that matters"
            />
          </dl>
        </Card>
      </section>

      <section>
        <h2 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
          {copy.admin.auditTrail}
        </h2>
        <p className="mt-2 max-w-prose text-label text-ink-muted">
          Append-only. Every moderation decision is recorded with who made it and why, and
          nothing here can be edited or deleted by anyone.
        </p>

        {recentActions.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-border-strong p-6 text-body text-ink-muted">
            No moderation decisions yet.
          </p>
        ) : (
          <ol className="mt-4 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {recentActions.map((action) => (
              <li key={action.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-surface p-4">
                <span className="font-mono text-label text-ink">{action.action}</span>
                <span className="text-label text-ink-muted">
                  {action.subjectType} · {action.subjectId.slice(0, 12)}
                </span>
                {action.reason && (
                  <span className="w-full text-label text-ink-muted">{action.reason}</span>
                )}
                <span className="ml-auto text-micro text-ink-subtle">
                  {formatRelativeTime(action.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
