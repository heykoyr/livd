import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, Card, EmptyState, Stat } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import {
  formatRelativeTime,
  formatTenure,
  propertyContextLine,
  propertyDisplayName,
} from '@/lib/format';
import { caseCategories, readReviewInvestigation, reviewSnapshots } from '@/server/admin';
import { getCurrentUser } from '@/server/auth/session';
import { ReviewStatusControls, VerificationControls } from '../../moderation-controls';
import { OpenCaseControls } from '../../cases/case-controls';
import {
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_TONES,
  VERIFICATION_LABELS,
  VERIFICATION_TONES,
} from '../../users/labels';

/**
 * Review investigation.
 *
 * Everything needed to decide whether a review should stay up, in the order a
 * decision actually gets made: what was reported, what was written, who wrote
 * it, whether anybody checked they lived there, what the property looks like
 * around it, and what has already been decided.
 *
 * THE THREE LEVELS, MADE OBVIOUS
 *
 * The page opens with them stated rather than implied, because a moderator who
 * is unclear about which level they are looking at is a moderator who will one
 * day tell a property owner something they should not have:
 *
 *   PUBLIC      an anonymous resident, a badge, a tenure, a date
 *   INTERNAL    an account id, counts, statuses, decisions
 *   RESTRICTED  the address and the residency document — neither is here
 *
 * PROGRESSIVE DISCLOSURE
 *
 * The review body and the report are up front, because they are what the
 * decision turns on. The author's wider history, the property's activity and
 * the verification trail are below them — available in one scroll, not dumped
 * into the first screen. And the controls that change something sit at the
 * bottom, after the evidence, rather than beside it.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Review investigation — ${copy.admin.title}`,
  robots: { index: false, follow: false, nocache: true },
};

export default async function ReviewInvestigationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [viewer, result, categories, snapshots] = await Promise.all([
    getCurrentUser(),
    readReviewInvestigation(id),
    caseCategories(),
    reviewSnapshots(id),
  ]);

  void viewer;
  if (!result) notFound();

  const { review, verification, reports, history } = result;

  const locationChecks = verification.filter((entry) => entry.kind === 'location');
  const residencySubmissions = verification.filter((entry) => entry.kind === 'residency');
  const checksHere = locationChecks.filter((entry) => entry.atThisProperty);
  const openReports = reports.filter((report) => report.status === 'open');

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/admin/cases"
          className="text-label text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Cases
        </Link>
        <h2 className="mt-2 font-display text-title-lg tracking-tightish text-ink">
          Review investigation
        </h2>
      </div>

      {/* ---- The privacy levels, stated ------------------------------- */}

      <Card className="p-5">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              Public identity
            </dt>
            <dd className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge tone="positive">Anonymous</Badge>
              <span className="text-label text-ink-muted">on the property page</span>
            </dd>
          </div>

          <div>
            <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              Internal account
            </dt>
            <dd className="mt-1.5 text-label">
              {review.author ? (
                <Link
                  href={`/admin/users/${review.author.id}`}
                  className="font-mono text-ink underline-offset-4 hover:underline"
                >
                  {review.author.id.slice(0, 8)}
                </Link>
              ) : (
                <span className="text-ink-subtle">Account deleted — unattributable</span>
              )}
            </dd>
          </div>

          <div>
            <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              Full identity
            </dt>
            <dd className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge tone="caution">Restricted</Badge>
              <span className="text-label text-ink-muted">not on this page</span>
            </dd>
          </div>
        </dl>

        <p className="mt-4 border-t border-border pt-3.5 text-label text-ink-muted">
          Nothing here identifies the person who wrote this. Revealing an address needs Trust
          &amp; Safety authorisation, a written reason, and is recorded — it happens on the
          account page, not here.
        </p>
      </Card>

      {/* ---- Why this is being looked at ------------------------------ */}

      <section aria-labelledby="reports-heading">
        <h3
          id="reports-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Why this was reported
        </h3>

        {reports.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border-strong p-5 text-label text-ink-muted">
            Nobody has reported this review. It may be here from the moderation queue or a signal.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {reports.map((report) => (
              <li key={report.reportId} className="bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={report.status === 'open' ? 'caution' : 'neutral'}>
                      {copy.safety.reportReasons[report.reason]}
                    </Badge>
                    <span className="text-micro text-ink-subtle">{report.status}</span>
                    {report.caseId && report.caseReference && (
                      <Link
                        href={`/admin/cases/${report.caseId}`}
                        className="font-mono text-micro text-ink underline underline-offset-4"
                      >
                        {report.caseReference}
                      </Link>
                    )}
                  </div>
                  <span className="text-micro text-ink-subtle">
                    {formatRelativeTime(report.createdAt)}
                  </span>
                </div>

                {report.detail && (
                  <p className="mt-2 rounded-md border-l-2 border-caution bg-caution-soft/40 p-3 text-label text-ink">
                    {report.detail}
                  </p>
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

      {/* ---- What was published --------------------------------------- */}

      <section aria-labelledby="review-heading">
        <h3
          id="review-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          What was published
        </h3>

        <Card className="mt-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={REVIEW_STATUS_TONES[review.status]}>
                {REVIEW_STATUS_LABELS[review.status]}
              </Badge>
              <Badge tone={VERIFICATION_TONES[review.verificationLevel]}>
                {VERIFICATION_LABELS[review.verificationLevel]}
              </Badge>
              <Badge>
                {review.residencyStatus === 'current' ? 'Current' : 'Former'} resident
              </Badge>
              {review.safetyFlags.map((flag) => (
                <Badge key={flag} tone="caution">
                  {flag.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>

            <p className="shrink-0 tabular text-title-md text-ink">{review.overallRating}/5</p>
          </div>

          <p className="mt-3 text-label text-ink-muted">
            {formatTenure(review.tenureMonths)} · {review.movedInMonth.slice(0, 7)} to{' '}
            {review.movedOutMonth ? review.movedOutMonth.slice(0, 7) : 'now'} · written{' '}
            {formatRelativeTime(review.createdAt)}
            {review.updatedAt !== review.createdAt &&
              ` · corrected ${formatRelativeTime(review.updatedAt)}`}
          </p>

          {review.body ? (
            <p className="prose-measure mt-4 whitespace-pre-line rounded-md bg-surface-sunken/60 p-4 text-body text-ink">
              {review.body}
            </p>
          ) : (
            <p className="mt-4 text-label text-ink-subtle">
              This review carries ratings only — no written text.
            </p>
          )}
        </Card>
      </section>

      {/* ---- What it said before -------------------------------------- */}

      {snapshots.length > 0 && (
        <section aria-labelledby="snapshots-heading">
          <h3
            id="snapshots-heading"
            className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
          >
            What it said before
          </h3>
          <p className="mt-1.5 max-w-prose text-label text-ink-muted">
            Preserved automatically before each change, by the database rather than by whoever made
            the change. The oldest entry is the state this review was published in — so removing it
            from public view never destroys what it said.
          </p>

          <ol className="mt-3 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id} className="bg-surface p-4">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <Badge tone={snapshot.reason === 'moderation' ? 'caution' : 'neutral'}>
                    {snapshot.reason}
                  </Badge>
                  {snapshot.status && (
                    <span className="text-label text-ink-muted">was {snapshot.status}</span>
                  )}
                  {snapshot.overallRating !== null && (
                    <span className="tabular text-label text-ink-muted">
                      {snapshot.overallRating}/5
                    </span>
                  )}
                  <span className="ml-auto text-micro text-ink-subtle">
                    {formatRelativeTime(snapshot.createdAt)}
                    {snapshot.changedBy && ` · ${snapshot.changedBy.slice(0, 8)}`}
                  </span>
                </div>

                {snapshot.body && (
                  <p className="prose-measure mt-3 whitespace-pre-line rounded-md bg-surface-sunken/60 p-3.5 text-label text-ink">
                    {snapshot.body}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ---- The account's history ------------------------------------- */}

      <section aria-labelledby="author-heading">
        <h3
          id="author-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          The account that wrote it
        </h3>
        <p className="mt-1.5 max-w-prose text-label text-ink-muted">
          Four reviews of four properties across three years reads very differently from four in a
          week. Neither is misconduct on its own.
        </p>

        <Card className="mt-3 p-5">
          {review.author ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/admin/users/${review.author.id}`}
                  className="font-mono text-label text-ink underline-offset-4 hover:underline"
                >
                  {review.author.id.slice(0, 8)}
                </Link>
                {review.author.status !== 'active' && (
                  <Badge tone="caution">{review.author.status}</Badge>
                )}
                <span className="text-label text-ink-muted">
                  joined {formatRelativeTime(review.author.createdAt)}
                </span>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-5 border-t border-border pt-5 sm:grid-cols-4">
                <Stat label="Reviews written" value={review.author.reviewCount} />
                <Stat label="Verified" value={review.author.verifiedReviewCount} />
                <Stat label="Removed" value={review.author.removedReviewCount} />
                <Stat
                  label="Reports against"
                  value={review.author.reportsAgainst}
                  hint="a question, not a finding"
                />
              </dl>
            </>
          ) : (
            <p className="text-label text-ink-muted">
              The author deleted their account. The review stays on the property record,
              permanently unattributable — nothing can re-link it.
            </p>
          )}
        </Card>
      </section>

      {/* ---- Verification ---------------------------------------------- */}

      <section aria-labelledby="verification-heading">
        <h3
          id="verification-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          What was checked
        </h3>
        <p className="mt-1.5 max-w-prose text-label text-ink-muted">
          A verdict, a method and a time. Livd does not store where anybody was — no coordinate,
          no accuracy, no distance — so this page cannot show one and neither can the database.
        </p>

        <Card className="mt-3 p-5">
          <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="Location checks" value={locationChecks.length} hint="this account" />
            <Stat label="At this property" value={checksHere.length} />
            <Stat label="Residency submissions" value={residencySubmissions.length} />
            <Stat
              label="This review"
              value={VERIFICATION_LABELS[review.verificationLevel]}
              hint={review.verifiedAt ? formatRelativeTime(review.verifiedAt) : undefined}
            />
          </dl>

          {verification.length > 0 && (
            <ul className="mt-5 flex flex-col gap-2 border-t border-border pt-5">
              {verification.slice(0, 12).map((entry) => (
                <li
                  key={`${entry.kind}-${entry.id}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-label"
                >
                  <Badge tone={entry.kind === 'location' ? 'info' : 'brand'}>
                    {entry.kind === 'location' ? 'Location' : 'Residency'}
                  </Badge>
                  <span className="text-ink">{entry.outcome}</span>
                  <span className="text-ink-muted">{entry.method.replace(/_/g, ' ')}</span>
                  {entry.atThisProperty ? (
                    <span className="text-positive">this property</span>
                  ) : (
                    <span className="text-ink-subtle">another property</span>
                  )}
                  {entry.failureReason && (
                    <span className="text-ink-muted">{entry.failureReason.replace(/_/g, ' ')}</span>
                  )}
                  {entry.hasEvidence && <span className="text-ink-subtle">document attached</span>}
                  <span className="ml-auto text-micro text-ink-subtle">
                    {formatRelativeTime(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {residencySubmissions.some((entry) => entry.hasEvidence) && (
            <p className="mt-4 border-t border-border pt-3.5 text-label text-ink-muted">
              Residency documents are opened from the verification queue, by Trust &amp; Safety,
              and every access is recorded. They are not reachable from here.
            </p>
          )}
        </Card>
      </section>

      {/* ---- The property ---------------------------------------------- */}

      <section aria-labelledby="property-heading">
        <h3
          id="property-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          The property
        </h3>

        <Card className="mt-3 p-5">
          <Link
            href={`/property/${review.property.slug}`}
            className="font-display text-title-md tracking-tightish text-ink hover:underline"
          >
            {propertyDisplayName(review.property.address)}
          </Link>
          <p className="mt-1 text-label text-ink-muted">
            {propertyContextLine(review.property.address)}
            {review.property.isClaimed && ' · claimed by a manager'}
          </p>

          <dl className="mt-5 grid grid-cols-2 gap-5 border-t border-border pt-5 sm:grid-cols-4">
            <Stat label="Published reviews" value={review.property.reviewCount} />
            <Stat label="Verified" value={review.property.verifiedReviewCount} />
            <Stat label="Reported reviews" value={review.property.reportedReviewCount} />
            <Stat
              label="Last 90 days"
              value={review.property.recentReviewCount}
              hint="all statuses"
            />
          </dl>

          {review.property.isClaimed && (
            <p className="mt-4 border-t border-border pt-3.5 text-label text-ink-muted">
              A claimed property changes nothing about how this review is judged. An owner can
              reply and can report; they cannot remove, and they cannot learn who wrote it.
            </p>
          )}
        </Card>
      </section>

      {/* ---- What has already been decided ------------------------------ */}

      <section aria-labelledby="history-heading">
        <h3
          id="history-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          What has already been decided
        </h3>

        {history.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border-strong p-5 text-label text-ink-muted">
            No moderation decision has been recorded against this review.
          </p>
        ) : (
          <ol className="mt-3 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-surface p-3.5"
              >
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

      {/* ---- Decide ------------------------------------------------------ */}

      <section aria-labelledby="decide-heading">
        <h3
          id="decide-heading"
          className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
        >
          Decide
        </h3>
        <p className="mt-1.5 max-w-prose text-label text-ink-muted">
          Every decision here needs a written reason and is recorded permanently. Opening a case
          changes nothing about the review; acting on the review is the separate step below it.
        </p>

        <Card className="mt-3 flex flex-col gap-6 p-5">
          {review.caseCount === 0 && (
            <div>
              <h4 className="mb-2.5 text-label font-semibold text-ink">
                Investigate under a case
              </h4>
              <OpenCaseControls
                reviewId={review.reviewId}
                categories={categories}
                defaultCategory={openReports.length > 0 ? 'false_information' : 'other'}
                defaultSummary={`Review of ${propertyDisplayName(review.property.address)}`}
              />
            </div>
          )}

          <div className={review.caseCount === 0 ? 'border-t border-border pt-5' : ''}>
            <h4 className="mb-2.5 text-label font-semibold text-ink">The review itself</h4>
            <ReviewStatusControls reviewId={review.reviewId} currentStatus={review.status} />
          </div>

          <div className="border-t border-border pt-5">
            <h4 className="mb-2.5 text-label font-semibold text-ink">Verification level</h4>
            <p className="mb-3 max-w-prose text-label text-ink-muted">
              Marking a review disputed removes its weight from the property&rsquo;s score until
              the question is settled. It is not a finding about the person.
            </p>
            <VerificationControls reviewId={review.reviewId} />
          </div>
        </Card>
      </section>

      {review.caseCount > 0 && (
        <EmptyState
          headingLevel="h3"
          title="This review is already under a case"
          description="Work it from the case, so the decision and its reasoning stay in one place."
        />
      )}
    </div>
  );
}
