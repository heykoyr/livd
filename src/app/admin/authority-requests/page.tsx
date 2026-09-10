import Link from 'next/link';

import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { formatRelativeTime } from '@/lib/format';
import { listAuthorityRequests, listDisclosures } from '@/server/admin';
import { hasRole } from '@/server/auth/guards';
import { getCurrentUser } from '@/server/auth/session';
import {
  AUTHORITY_STATUS_LABELS,
  AUTHORITY_STATUS_TONES,
  AUTHORITY_TYPE_LABELS,
  DISCLOSABLE_STATUSES,
} from './labels';
import {
  DecideRequestControls,
  RecordDisclosureControls,
  RecordRequestControls,
} from './controls';

/**
 * Authority requests.
 *
 * The most restricted area in the product and the smallest in capability. It
 * records that somebody asked, what was decided, and — separately — what
 * actually left.
 *
 * There is no control anywhere on this page that gathers or sends a user's
 * information, and there is none anywhere else in Livd either. The judgement
 * about whether a request is valid is made by a person reading it; what the
 * software provides is the memory of that judgement, and of what followed.
 *
 * The page says so explicitly and more than once. The one dangerous
 * misunderstanding here is somebody believing a button sends data to the
 * requester, and the cost of over-explaining that is nothing.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: `Authority requests — ${copy.admin.title}`,
  robots: { index: false, follow: false, nocache: true },
};

export default async function AuthorityRequestsPage() {
  const viewer = await getCurrentUser();
  const authorised = hasRole(viewer, 'trust_admin');

  if (!authorised) {
    return (
      <EmptyState
        title="Not available"
        description="Authority requests are handled by Trust & Safety. A moderator has no business in a law-enforcement request, and the accounts these concern have the strongest interest in the smallest number of people being able to read them."
      />
    );
  }

  const [requests, disclosures] = await Promise.all([
    listAuthorityRequests({ limit: 100 }),
    listDisclosures(),
  ]);

  const open = requests.filter(
    (request) => !['fulfilled', 'declined', 'closed'].includes(request.status),
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="font-display text-title-lg tracking-tightish text-ink">
          Authority requests
        </h2>
        <p className="mt-1 max-w-prose text-label text-ink-muted">
          For requests from bodies asserting a legal basis — law enforcement, courts, regulators.
          This area records and manages them.
        </p>
      </div>

      <Card className="border-caution/30 bg-caution-soft/30 p-5">
        <h3 className="text-label font-semibold text-ink">Nothing here discloses anything</h3>
        <p className="mt-2 max-w-prose text-label text-ink">
          There is no control in Livd that assembles an account&rsquo;s information and sends it to
          a requester, and there is not going to be one. A person reads the request, decides, and
          — if the decision is to disclose — gathers and sends what was decided, outside this
          system. What this page does is remember: who asked, on what basis, what was decided, by
          whom, and exactly what left.
        </p>
        <p className="mt-3 max-w-prose text-label text-ink-muted">
          Livd operates globally. What is lawful, what must be disclosed and whether the account
          holder may be told all differ by jurisdiction, and none of that is decided here. Those
          questions need professional legal advice; this is the record-keeping a process needs,
          not the process itself.
        </p>
      </Card>

      {/* ---- Record a new one ------------------------------------------ */}

      <section aria-labelledby="record-heading">
        <h3
          id="record-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Record a request
        </h3>

        <Card className="mt-3 p-5">
          <RecordRequestControls />
        </Card>
      </section>

      {/* ---- The requests ---------------------------------------------- */}

      <section aria-labelledby="requests-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3
            id="requests-heading"
            className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
          >
            Requests
          </h3>
          <p className="text-label text-ink-muted">
            <span className="tabular font-medium text-ink">{open.length}</span> open ·{' '}
            <span className="tabular">{requests.length}</span> total
          </p>
        </div>

        {requests.length === 0 ? (
          <EmptyState
            headingLevel="h3"
            className="mt-3"
            title="No requests recorded"
            description="Requests appear here once somebody records one. Nothing is created automatically."
          />
        ) : (
          <ul className="mt-3 flex flex-col gap-5">
            {requests.map((request) => {
              const theirDisclosures = disclosures.filter((d) => d.requestId === request.id);
              const canDisclose = DISCLOSABLE_STATUSES.includes(request.status);

              return (
                <li key={request.id}>
                  <Card className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-label font-medium text-ink">
                            {request.reference}
                          </span>
                          <Badge tone={AUTHORITY_STATUS_TONES[request.status]}>
                            {AUTHORITY_STATUS_LABELS[request.status]}
                          </Badge>
                          <Badge>{AUTHORITY_TYPE_LABELS[request.requestType]}</Badge>
                          {request.documentationReceived ? (
                            <Badge tone="positive">Paperwork held</Badge>
                          ) : (
                            <Badge tone="caution">No paperwork</Badge>
                          )}
                        </div>

                        <p className="mt-2.5 text-body text-ink">
                          {request.requestingAuthority}
                          <span className="text-ink-muted"> · {request.jurisdiction}</span>
                        </p>

                        {request.externalReference && (
                          <p className="mt-0.5 font-mono text-micro text-ink-subtle">
                            their ref {request.externalReference}
                          </p>
                        )}
                      </div>

                      <p className="shrink-0 text-micro text-ink-subtle">
                        Received {formatRelativeTime(request.receivedAt)}
                      </p>
                    </div>

                    <div className="mt-4 border-t border-border pt-4">
                      <h4 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                        What was asked for
                      </h4>
                      <p className="prose-measure mt-1.5 whitespace-pre-line text-label text-ink">
                        {request.requestedInformation}
                      </p>
                    </div>

                    {request.legalBasis && (
                      <div className="mt-4">
                        <h4 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                          Basis asserted
                        </h4>
                        <p className="mt-1.5 text-label text-ink-muted">{request.legalBasis}</p>
                        <p className="mt-1 text-micro text-ink-subtle">
                          What they claim, recorded as a claim.
                        </p>
                      </div>
                    )}

                    {(request.subjectUserId || request.caseId) && (
                      <p className="mt-4 flex flex-wrap gap-x-4 text-label">
                        {request.subjectUserId && (
                          <Link
                            href={`/admin/users/${request.subjectUserId}`}
                            className="font-mono text-ink underline underline-offset-4"
                          >
                            account {request.subjectUserId.slice(0, 8)}
                          </Link>
                        )}
                        {request.caseId && request.caseReference && (
                          <Link
                            href={`/admin/cases/${request.caseId}`}
                            className="font-mono text-ink underline underline-offset-4"
                          >
                            {request.caseReference}
                          </Link>
                        )}
                      </p>
                    )}

                    {request.decision && (
                      <div className="mt-4 rounded-md border-l-2 border-brand bg-brand-soft/40 p-3.5">
                        <h4 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                          Livd&rsquo;s decision
                        </h4>
                        <p className="mt-1.5 whitespace-pre-line text-label text-ink">
                          {request.decision}
                        </p>
                        <p className="mt-1.5 font-mono text-micro text-ink-subtle">
                          {request.decidedBy ? request.decidedBy.slice(0, 8) : 'unknown'} ·{' '}
                          {request.decidedAt ? formatRelativeTime(request.decidedAt) : ''}
                        </p>
                      </div>
                    )}

                    {theirDisclosures.length > 0 && (
                      <div className="mt-4">
                        <h4 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                          What was disclosed
                        </h4>
                        <ul className="mt-2 flex flex-col gap-2">
                          {theirDisclosures.map((disclosure) => (
                            <li
                              key={disclosure.id}
                              className="rounded-md border border-border bg-surface-sunken/60 p-3"
                            >
                              <p className="font-mono text-label text-ink">
                                {disclosure.disclosedFields.join(', ')}
                              </p>
                              <p className="mt-1 text-micro text-ink-muted">
                                to {disclosure.disclosedTo} · {disclosure.method.replace(/_/g, ' ')}{' '}
                                · {formatRelativeTime(disclosure.disclosedAt)}
                              </p>
                              {disclosure.notes && (
                                <p className="mt-1.5 text-label text-ink-muted">
                                  {disclosure.notes}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="mt-5 flex flex-col gap-5 border-t border-border pt-5">
                      <DecideRequestControls
                        requestId={request.id}
                        currentStatus={request.status}
                      />

                      {canDisclose && (
                        <div className="border-t border-border pt-5">
                          <h4 className="mb-3 text-label font-semibold text-ink">
                            Record a disclosure
                          </h4>
                          <RecordDisclosureControls requestId={request.id} />
                        </div>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
