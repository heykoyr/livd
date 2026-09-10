import Link from 'next/link';

import { ButtonLink } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { formatRelativeTime } from '@/lib/format';
import { listSanctions } from '@/server/admin';
import { STATUS_LABELS, STATUS_TONES } from '../users/labels';

/**
 * Sanctions.
 *
 * Every restriction, suspension and ban, with what it was for and who applied
 * it. Defaults to the ones still in force, because that is the operational
 * question — but the history is one click away and nothing is ever removed from
 * it, including sanctions that were lifted early.
 *
 * A lifted sanction staying visible is deliberate. It is the record of a
 * decision that was made and then reconsidered, which is exactly the kind of
 * thing an appeal or a review needs to be able to find.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: `Sanctions — ${copy.admin.title}`,
  robots: { index: false, follow: false, nocache: true },
};

export default async function SanctionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const showAll = params.all === '1';

  const sanctions = await listSanctions({ activeOnly: !showAll, limit: 200 });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-title-lg tracking-tightish text-ink">Sanctions</h2>
        <p className="mt-1 max-w-prose text-label text-ink-muted">
          Account standing only. None of this touched what these accounts wrote — removing a
          review is a separate decision, recorded separately.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p aria-live="polite" className="text-label text-ink-muted">
          <span className="tabular font-medium text-ink">{sanctions.length}</span>{' '}
          {showAll ? 'recorded' : 'in force'}
        </p>
        <ButtonLink
          href={showAll ? '/admin/sanctions' : '/admin/sanctions?all=1'}
          variant="secondary"
          size="sm"
        >
          {showAll ? 'Show only those in force' : 'Include lifted and expired'}
        </ButtonLink>
      </div>

      {sanctions.length === 0 ? (
        <EmptyState
          title={showAll ? 'No sanctions recorded' : 'Nothing in force'}
          description="Sanctions are applied from an account page, always with a category and a written reason."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[48rem] border-collapse text-label">
            <caption className="sr-only">
              Account sanctions, most recent first.
            </caption>
            <thead>
              <tr className="border-b border-border bg-surface-sunken/60 text-left">
                <Th>Account</Th>
                <Th>Sanction</Th>
                <Th>Reason</Th>
                <Th>Case</Th>
                <Th>Applied</Th>
                <Th>Ends</Th>
              </tr>
            </thead>
            <tbody>
              {sanctions.map((sanction) => (
                <tr key={sanction.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/admin/users/${sanction.userId}`}
                      className="font-mono text-label text-ink underline-offset-4 hover:underline"
                    >
                      {sanction.userId.slice(0, 8)}
                    </Link>
                  </td>

                  <td className="px-3 py-2.5">
                    <Badge tone={sanction.isActive ? STATUS_TONES[sanction.action] : 'neutral'}>
                      {STATUS_LABELS[sanction.action]}
                    </Badge>
                    {!sanction.isActive && (
                      <span className="ml-2 text-micro text-ink-subtle">
                        {sanction.liftedAt ? 'lifted' : 'expired'}
                      </span>
                    )}
                  </td>

                  <td className="max-w-md px-3 py-2.5">
                    <span className="text-ink">{sanction.reason}</span>
                    <span className="mt-0.5 block font-mono text-micro text-ink-subtle">
                      {sanction.reasonKey}
                    </span>
                  </td>

                  <td className="px-3 py-2.5">
                    {sanction.caseId && sanction.caseReference ? (
                      <Link
                        href={`/admin/cases/${sanction.caseId}`}
                        className="font-mono text-micro text-ink underline underline-offset-4"
                      >
                        {sanction.caseReference}
                      </Link>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </td>

                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">
                    {formatRelativeTime(sanction.startsAt)}
                    <span className="mt-0.5 block font-mono text-micro text-ink-subtle">
                      {sanction.appliedBy ? sanction.appliedBy.slice(0, 8) : 'deleted'}
                    </span>
                  </td>

                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">
                    {sanction.endsAt ? formatRelativeTime(sanction.endsAt) : 'No end date'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2 text-micro font-semibold uppercase tracking-micro text-ink-subtle"
    >
      {children}
    </th>
  );
}
