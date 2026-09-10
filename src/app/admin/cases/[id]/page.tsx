import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { formatRelativeTime, propertyContextLine, propertyDisplayName } from '@/lib/format';
import { caseCategories, readCase, readUserDirectory } from '@/server/admin';
import { hasRole } from '@/server/auth/guards';
import { getCurrentUser } from '@/server/auth/session';
import {
  AssignControls,
  NoteControls,
  PreservationControls,
  PriorityControls,
  StatusControls,
} from '../case-controls';
import {
  CASE_EVENT_LABELS,
  CASE_PRIORITY_LABELS,
  CASE_PRIORITY_TONES,
  CASE_STATUS_LABELS,
  CASE_STATUS_TONES,
} from '../labels';

/**
 * One case.
 *
 * The central object of the console: report, review, property, account,
 * evidence, notes, actions and the timeline that ties them together. Everything
 * a moderator needs to decide, in the order they need it.
 *
 * Two things are deliberately absent. There is no reviewer identity — the
 * account is named by id, and crossing that boundary happens on the account
 * page with its own authorisation and its own record. And there is no control
 * that acts on the review from here; hiding or removing content is a separate
 * decision with a separate reason, and putting it beside "resolve case" would
 * make the two feel like one step.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Case — ${copy.admin.title}`,
  robots: { index: false, follow: false, nocache: true },
};

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [viewer, result, categories] = await Promise.all([
    getCurrentUser(),
    readCase(id),
    caseCategories(),
  ]);

  if (!result) notFound();

  const { detail, events, notes, reports } = result;
  const category = categories.find((entry) => entry.key === detail.category);
  const canSetCritical = hasRole(viewer, 'trust_admin');
  const canPreserve = hasRole(viewer, 'trust_admin');

  // Who a case can be handed to. Only accounts that could actually work it —
  // the database refuses anything else, so offering more would be a lie.
  const directory = await readUserDirectory({ pageSize: 100 });
  const moderators = directory.ok
    ? directory.data.items
        .filter((user) => ['moderator', 'trust_admin', 'admin'].includes(user.role))
        .filter((user) => user.status === 'active')
        .map((user) => ({ id: user.id, label: `${user.maskedEmail} · ${user.role}` }))
    : [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/admin/cases"
          className="text-label text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← All cases
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <h2 className="font-display text-title-lg tracking-tightish text-ink">
            {detail.reference}
          </h2>
          <Badge tone={CASE_PRIORITY_TONES[detail.priority]}>
            {CASE_PRIORITY_LABELS[detail.priority]}
          </Badge>
          <Badge tone={CASE_STATUS_TONES[detail.status]}>
            {CASE_STATUS_LABELS[detail.status]}
          </Badge>
          {detail.preservationHold && <Badge tone="brand">Preservation hold</Badge>}
        </div>

        <p className="mt-2 max-w-prose text-body text-ink">{detail.summary}</p>
        <p className="mt-1 text-label text-ink-subtle">
          {category?.label ?? detail.category} · opened {formatRelativeTime(detail.createdAt)}
        </p>
      </div>

      {detail.outcome && (
        <Card className="border-positive/30 bg-positive-soft/30 p-5">
          <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            Outcome
          </h3>
          <p className="mt-2 whitespace-pre-line text-body text-ink">{detail.outcome}</p>
        </Card>
      )}

      {/* ---- What this concerns --------------------------------------- */}

      <section aria-labelledby="subjects-heading">
        <h3
          id="subjects-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          What this concerns
        </h3>

        <Card className="mt-3 p-5">
          <dl className="grid gap-5 sm:grid-cols-3">
            <div>
              <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                Property
              </dt>
              <dd className="mt-1.5 text-label text-ink">
                {detail.property ? (
                  <>
                    <Link
                      href={`/property/${detail.property.slug}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {propertyDisplayName(detail.property.address)}
                    </Link>
                    <span className="mt-0.5 block text-micro text-ink-subtle">
                      {propertyContextLine(detail.property.address)}
                    </span>
                  </>
                ) : (
                  <span className="text-ink-subtle">—</span>
                )}
              </dd>
            </div>

            <div>
              <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                Review
              </dt>
              <dd className="mt-1.5 font-mono text-label text-ink">
                {detail.subjectReviewId ? (
                  <Link
                    href={`/admin/reviews/${detail.subjectReviewId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {detail.subjectReviewId.slice(0, 8)}
                  </Link>
                ) : (
                  <span className="text-ink-subtle">—</span>
                )}
              </dd>
            </div>

            <div>
              <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                Account
              </dt>
              <dd className="mt-1.5 text-label">
                {detail.subjectUserId ? (
                  <>
                    <Link
                      href={`/admin/users/${detail.subjectUserId}`}
                      className="font-mono text-ink underline-offset-4 hover:underline"
                    >
                      {detail.subjectUserId.slice(0, 8)}
                    </Link>
                    <span className="mt-0.5 block text-micro text-ink-subtle">
                      Anonymous publicly · identity restricted
                    </span>
                  </>
                ) : (
                  <span className="text-ink-subtle">—</span>
                )}
              </dd>
            </div>
          </dl>
        </Card>
      </section>

      {/* ---- Reports --------------------------------------------------- */}

      <section aria-labelledby="reports-heading">
        <h3
          id="reports-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Reports gathered here
        </h3>

        {reports.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border-strong p-5 text-label text-ink-muted">
            This case was opened without a report.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {reports.map((report) => (
              <li key={report.id} className="bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <Badge tone={report.status === 'open' ? 'caution' : 'neutral'}>
                    {copy.safety.reportReasons[report.reason]}
                  </Badge>
                  <span className="text-micro text-ink-subtle">
                    {formatRelativeTime(report.createdAt)}
                  </span>
                </div>
                {report.detail && <p className="mt-2 text-label text-ink">{report.detail}</p>}
                <p className="mt-2 font-mono text-micro text-ink-subtle">
                  Reporter {report.reporterId ? report.reporterId.slice(0, 8) : 'account deleted'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Working the case ------------------------------------------ */}

      <section aria-labelledby="work-heading">
        <h3
          id="work-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Working the case
        </h3>

        <Card className="mt-3 flex flex-col gap-6 p-5">
          <div>
            <h4 className="mb-2.5 text-label font-semibold text-ink">Assignment</h4>
            <AssignControls
              caseId={detail.id}
              currentAssignee={detail.assignedTo}
              moderators={moderators}
              viewerId={viewer?.id ?? null}
            />
          </div>

          <div className="border-t border-border pt-5">
            <h4 className="mb-2.5 text-label font-semibold text-ink">Priority</h4>
            <PriorityControls
              caseId={detail.id}
              currentPriority={detail.priority}
              canSetCritical={canSetCritical}
            />
          </div>

          <div className="border-t border-border pt-5">
            <h4 className="mb-2.5 text-label font-semibold text-ink">Status</h4>
            <StatusControls caseId={detail.id} currentStatus={detail.status} />
          </div>

          {canPreserve && (
            <div className="border-t border-border pt-5">
              <h4 className="mb-2.5 text-label font-semibold text-ink">Preservation</h4>
              <PreservationControls caseId={detail.id} held={detail.preservationHold} />
            </div>
          )}
        </Card>
      </section>

      {/* ---- Notes ------------------------------------------------------ */}

      <section aria-labelledby="notes-heading">
        <h3
          id="notes-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Internal notes
        </h3>

        <Card className="mt-3 p-5">
          <NoteControls caseId={detail.id} />

          {notes.length > 0 && (
            <ul className="mt-5 flex flex-col gap-4 border-t border-border pt-5">
              {notes.map((note) => (
                <li key={note.id}>
                  <p className="whitespace-pre-line text-body text-ink">{note.body}</p>
                  <p className="mt-1 font-mono text-micro text-ink-subtle">
                    {note.authorId ? note.authorId.slice(0, 8) : 'account deleted'} ·{' '}
                    {formatRelativeTime(note.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* ---- Timeline ---------------------------------------------------- */}

      <section aria-labelledby="timeline-heading">
        <h3
          id="timeline-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Timeline
        </h3>
        <p className="mt-1.5 max-w-prose text-label text-ink-muted">
          Written alongside each change, in the same transaction. Nothing here can be edited or
          removed by anyone — a status that moved without an entry is not a state this case can
          reach.
        </p>

        {events.length === 0 ? (
          <EmptyState
            headingLevel="h3"
            className="mt-3"
            title="Nothing yet"
            description="Events appear as the case is worked."
          />
        ) : (
          <ol className="mt-3 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-surface p-3.5">
                <span className="text-label font-medium text-ink">
                  {CASE_EVENT_LABELS[event.kind] ?? event.kind}
                </span>
                <span className="text-label text-ink-muted">{event.summary}</span>
                <span className="ml-auto shrink-0 text-micro text-ink-subtle">
                  {event.actorId ? `${event.actorId.slice(0, 8)} · ` : ''}
                  {formatRelativeTime(event.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
