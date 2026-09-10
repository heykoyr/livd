import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, Card, EmptyState, Stat } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { formatRelativeTime, propertyContextLine, propertyDisplayName } from '@/lib/format';
import {
  identityAccessHistory,
  identityAccessReasons,
  listCases,
  listSanctions,
  readUserDetail,
  sanctionReasons,
} from '@/server/admin';
import { hasRole } from '@/server/auth/guards';
import { getCurrentUser } from '@/server/auth/session';
import { RoleControls } from '../../moderation-controls';
import { RevealIdentity } from './reveal-identity';
import { ApplySanctionControls, LiftSanctionControls } from './sanction-controls';
import {
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_TONES,
  ROLE_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  VERIFICATION_LABELS,
  VERIFICATION_TONES,
} from '../labels';

/**
 * One account.
 *
 * The page is built around a distinction that has to be obvious at a glance,
 * because getting it wrong is how a platform like this fails:
 *
 *   PUBLIC      what a reader of the property page sees — an anonymous
 *               resident, a verification badge, a date. No account, ever.
 *   INTERNAL    what this page shows — an account id, a masked address,
 *               counts, standing, history. Enough to investigate.
 *   RESTRICTED  the address itself. Not here. Revealing it is a separate
 *               operation, needs Trust & Safety authorisation, requires a
 *               written reason and writes an audit entry.
 *
 * So the identity panel leads with what is *withheld* rather than burying it.
 * A moderator should never be able to form the impression that they are
 * looking at somebody's identity, because on the day they are asked to hand
 * something to a property owner that impression is what decides what they say.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Account — ${copy.admin.title}`,
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [viewer, result] = await Promise.all([getCurrentUser(), readUserDetail({ userId: id })]);

  if (!result.ok) {
    // A refusal and a missing account look the same from here on purpose: a
    // moderator probing ids should not be able to tell which is which.
    notFound();
  }

  const { detail, reviews, reports, history } = result.data;
  const canEditRoles = hasRole(viewer, 'admin');
  const isSelf = viewer?.id === detail.id;

  // Revealing your own address through this path is refused — it is on the
  // account page — so the control is not offered for it either.
  const canRevealIdentity = hasRole(viewer, 'trust_admin') && !isSelf;

  const canSuspend = hasRole(viewer, 'trust_admin');
  const canBan = hasRole(viewer, 'admin');

  const [reasons, accessHistory, sanctions, sanctionOptions, openCases] = await Promise.all([
    canRevealIdentity ? identityAccessReasons() : Promise.resolve([]),
    identityAccessHistory(detail.id),
    listSanctions({ userId: detail.id }),
    sanctionReasons(),
    // Cases naming this account, so a sanction can be tied to the investigation
    // it came out of rather than floating free.
    listCases({ pageSize: 25, openOnly: false }),
  ]);

  const relatedCases = openCases.items
    .filter((entry) => entry.subjectUserId === detail.id)
    .map((entry) => ({ id: entry.id, reference: entry.reference }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/admin/users"
          className="text-label text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← All accounts
        </Link>
        <h2 className="mt-2 font-display text-title-lg tracking-tightish text-ink">
          Account
        </h2>
      </div>

      {/* ---- Identity ------------------------------------------------- */}

      <section aria-labelledby="identity-heading">
        <h3
          id="identity-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Identity
        </h3>

        <Card className="mt-3 p-5">
          <dl className="grid gap-5 sm:grid-cols-2">
            <div>
              <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                Public identity
              </dt>
              <dd className="mt-1.5 flex items-center gap-2">
                <Badge tone="positive">Anonymous</Badge>
                <span className="text-label text-ink-muted">on every property page</span>
              </dd>
            </div>

            <div>
              <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                Account identity
              </dt>
              <dd className="mt-1.5 flex items-center gap-2">
                <Badge tone="caution">Restricted</Badge>
                <span className="text-label text-ink-muted">not shown here</span>
              </dd>
            </div>

            <div>
              <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                Account id
              </dt>
              <dd className="mt-1.5 break-all font-mono text-label text-ink">{detail.id}</dd>
            </div>

            <div>
              <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                Joined
              </dt>
              <dd className="mt-1.5 text-label text-ink">
                {formatRelativeTime(detail.createdAt)}
              </dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-border pt-5">
            {canRevealIdentity ? (
              <RevealIdentity
                userId={detail.id}
                maskedEmail={detail.maskedEmail}
                reasons={reasons}
              />
            ) : (
              <div className="rounded-lg border border-border bg-surface-sunken/50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="caution">Restricted</Badge>
                  <span className="font-mono text-label text-ink">{detail.maskedEmail}</span>
                </div>
                <p className="mt-3 max-w-prose text-label text-ink-muted">
                  The full address is not loaded into this page. Revealing it needs Trust &amp;
                  Safety authorisation, a written reason, and is recorded in the audit log.
                </p>
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* ---- Who has looked ------------------------------------------- */}

      {accessHistory.length > 0 && (
        <section aria-labelledby="access-heading">
          <h3
            id="access-heading"
            className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
          >
            Identity access
          </h3>
          <p className="mt-1.5 max-w-prose text-label text-ink-muted">
            Every time this account&rsquo;s identity has been looked at, and why. Visible to
            moderators, who cannot perform the access themselves — an access log only its own
            subjects can read deters nobody.
          </p>

          <ol className="mt-3 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {accessHistory.map((entry) => (
              <li key={entry.id} className="bg-surface p-3.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Badge tone={entry.outcome === 'succeeded' ? 'caution' : 'neutral'}>
                    {entry.outcome === 'succeeded' ? 'Revealed' : entry.outcome}
                  </Badge>
                  <span className="text-label text-ink-muted">
                    by {ROLE_LABELS[entry.actorRole]}{' '}
                    <span className="font-mono text-micro">
                      {entry.actorId ? entry.actorId.slice(0, 8) : 'account deleted'}
                    </span>
                  </span>
                  {entry.caseReference && (
                    <span className="font-mono text-micro text-ink-subtle">
                      {entry.caseReference}
                    </span>
                  )}
                  <span className="ml-auto text-micro text-ink-subtle">
                    {formatRelativeTime(entry.createdAt)}
                  </span>
                </div>
                {entry.reason && (
                  <p className="mt-1.5 text-label text-ink-muted">{entry.reason}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ---- Standing ------------------------------------------------- */}

      <section aria-labelledby="standing-heading">
        <h3
          id="standing-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Standing
        </h3>

        <Card className="mt-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={detail.role === 'resident' ? 'neutral' : 'brand'}>
              {ROLE_LABELS[detail.role]}
            </Badge>
            <Badge tone={STATUS_TONES[detail.status]}>{STATUS_LABELS[detail.status]}</Badge>
            <span className="text-label text-ink-muted">
              Joined {formatRelativeTime(detail.createdAt)}
            </span>
            {detail.countryCode && (
              <span className="text-label text-ink-subtle">· {detail.countryCode}</span>
            )}
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-5 border-t border-border pt-5 sm:grid-cols-4">
            <Stat label="Reviews" value={detail.reviewCount} />
            <Stat label="Published" value={detail.publishedReviewCount} />
            <Stat
              label="Verified"
              value={detail.verifiedReviewCount}
              hint="location or residency"
            />
            <Stat
              label="Reports against"
              value={detail.reportsAgainst}
              hint="a question, not a finding"
            />
            <Stat label="Removed" value={detail.removedReviewCount} />
            <Stat label="Held" value={detail.heldReviewCount} />
            <Stat
              label="Location checks"
              value={detail.locationCheckCount}
              hint="never where"
            />
            <Stat label="Reports made" value={detail.reportsMade} />
          </dl>
        </Card>
      </section>

      {/* ---- Reviews --------------------------------------------------- */}

      <section aria-labelledby="reviews-heading">
        <h3
          id="reviews-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Reviews
        </h3>
        <p className="mt-1.5 max-w-prose text-label text-ink-muted">
          What this account has written, and what happened to each one. A history of four
          properties across three years reads very differently from four in a week.
        </p>

        {reviews.items.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border-strong p-5 text-label text-ink-muted">
            This account has not written a review.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {reviews.items.map((review) => (
              <li key={review.reviewId} className="bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <Link
                      href={`/property/${review.propertySlug}`}
                      className="font-medium text-ink underline-offset-4 hover:underline"
                    >
                      {propertyDisplayName(review.address)}
                    </Link>
                    <p className="mt-0.5 truncate text-label text-ink-muted">
                      {propertyContextLine(review.address)}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge tone={REVIEW_STATUS_TONES[review.status]}>
                        {REVIEW_STATUS_LABELS[review.status]}
                      </Badge>
                      <Badge tone={VERIFICATION_TONES[review.verificationLevel]}>
                        {VERIFICATION_LABELS[review.verificationLevel]}
                      </Badge>
                      <Badge>
                        {review.residencyStatus === 'current' ? 'Current' : 'Former'} resident
                      </Badge>
                      {review.reportCount > 0 && (
                        <Badge tone="caution">
                          {review.reportCount} report{review.reportCount === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="tabular text-title-md text-ink">{review.overallRating}/5</p>
                    <p className="mt-0.5 text-micro text-ink-subtle">
                      {formatRelativeTime(review.createdAt)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Reports --------------------------------------------------- */}

      <section aria-labelledby="reports-heading">
        <h3
          id="reports-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Reports about this account&rsquo;s reviews
        </h3>
        <p className="mt-1.5 max-w-prose text-label text-ink-muted">
          A report is an accusation, not a finding. The reporter is shown as an account id — who
          they are is no more this page&rsquo;s business than who the author is.
        </p>

        {reports.items.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border-strong p-5 text-label text-ink-muted">
            Nothing this account wrote has been reported.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {reports.items.map((report) => (
              <li key={report.reportId} className="bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <Badge tone={report.status === 'open' ? 'caution' : 'neutral'}>
                    {copy.safety.reportReasons[report.reason]}
                  </Badge>
                  <span className="text-micro text-ink-subtle">
                    {report.status} · {formatRelativeTime(report.createdAt)}
                  </span>
                </div>

                {report.detail && (
                  <p className="mt-2 text-label text-ink-muted">{report.detail}</p>
                )}
                {report.resolution && (
                  <p className="mt-2 text-label text-ink">
                    <span className="text-ink-subtle">Resolution: </span>
                    {report.resolution}
                  </p>
                )}

                <p className="mt-2 font-mono text-micro text-ink-subtle">
                  Reporter {report.reporterId ? report.reporterId.slice(0, 8) : 'account deleted'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Administrative history ------------------------------------ */}

      <section aria-labelledby="history-heading">
        <h3
          id="history-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Administrative history
        </h3>
        <p className="mt-1.5 max-w-prose text-label text-ink-muted">
          Decisions recorded against this account. Append-only — nothing here can be edited or
          removed by anyone, including whoever made it.
        </p>

        {history.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border-strong p-5 text-label text-ink-muted">
            No decisions have been recorded against this account.
          </p>
        ) : (
          <ol className="mt-3 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-surface p-3.5">
                <span className="font-mono text-label text-ink">{entry.action}</span>
                {entry.previousStatus && entry.newStatus && (
                  <span className="text-label text-ink-muted">
                    {entry.previousStatus} → {entry.newStatus}
                  </span>
                )}
                <span className="ml-auto text-micro text-ink-subtle">
                  {formatRelativeTime(entry.createdAt)}
                </span>
                {entry.reason && (
                  <span className="w-full text-label text-ink-muted">{entry.reason}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ---- Sanctions --------------------------------------------------- */}

      {sanctions.length > 0 && (
        <section aria-labelledby="sanctions-heading">
          <h3
            id="sanctions-heading"
            className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
          >
            Sanctions
          </h3>
          <p className="mt-1.5 max-w-prose text-label text-ink-muted">
            What was done to this account, under which category, in whose words, and out of which
            investigation. Lifted sanctions stay on the record.
          </p>

          <ul className="mt-3 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {sanctions.map((sanction) => (
              <li key={sanction.id} className="bg-surface p-4">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <Badge tone={sanction.isActive ? STATUS_TONES[sanction.action] : 'neutral'}>
                    {STATUS_LABELS[sanction.action]}
                  </Badge>
                  {sanction.isActive ? (
                    <span className="text-label text-ink-muted">
                      {sanction.endsAt
                        ? `until ${formatRelativeTime(sanction.endsAt)}`
                        : 'no end date'}
                    </span>
                  ) : (
                    <span className="text-label text-ink-subtle">
                      {sanction.liftedAt ? 'lifted' : 'expired'}
                    </span>
                  )}
                  {sanction.caseReference && (
                    <Link
                      href={`/admin/cases/${sanction.caseId}`}
                      className="font-mono text-micro text-ink underline underline-offset-4"
                    >
                      {sanction.caseReference}
                    </Link>
                  )}
                  <span className="ml-auto text-micro text-ink-subtle">
                    {formatRelativeTime(sanction.startsAt)}
                  </span>
                </div>

                <p className="mt-2 text-label text-ink">{sanction.reason}</p>

                <p className="mt-1.5 font-mono text-micro text-ink-subtle">
                  {sanction.reasonKey} · by{' '}
                  {sanction.appliedBy ? sanction.appliedBy.slice(0, 8) : 'account deleted'}
                </p>

                {sanction.liftedAt && sanction.liftedReason && (
                  <p className="mt-2 rounded-md border-l-2 border-border-strong bg-surface-sunken/60 p-2.5 text-label text-ink-muted">
                    Lifted {formatRelativeTime(sanction.liftedAt)} — {sanction.liftedReason}
                  </p>
                )}

                {sanction.isActive && !isSelf && (
                  <LiftSanctionControls sanctionId={sanction.id} />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- Actions ---------------------------------------------------- */}

      <section aria-labelledby="actions-heading">
        <h3
          id="actions-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Actions
        </h3>

        {isSelf ? (
          <EmptyState
            headingLevel="h3"
            className="mt-3"
            title="This is your own account"
            description="Nobody changes their own role or standing. An administrator has to do it for you, and the database refuses it either way."
          />
        ) : (
          <Card className="mt-3 flex flex-col gap-6 p-5">
            {canEditRoles ? (
              <div>
                <h4 className="text-label font-semibold text-ink">Role</h4>
                <p className="mb-3 mt-1 text-label text-ink-muted">
                  Trust &amp; Safety can reveal identities and read verification evidence.
                  Administrator can additionally grant roles.
                </p>
                <RoleControls userId={detail.id} currentRole={detail.role} />
              </div>
            ) : (
              <p className="text-label text-ink-muted">
                Roles can only be changed by an administrator.
              </p>
            )}

            <div className="border-t border-border pt-5">
              <h4 className="text-label font-semibold text-ink">Account standing</h4>
              <p className="mb-3 mt-1 max-w-prose text-label text-ink-muted">
                Separate from anything that happens to what this account wrote. Suspending someone
                does not touch their reviews, and removing a review does not touch their account —
                all four combinations are ordinary.
              </p>
              <ApplySanctionControls
                userId={detail.id}
                reasons={sanctionOptions}
                canSuspend={canSuspend}
                canBan={canBan}
                caseOptions={relatedCases}
              />
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
