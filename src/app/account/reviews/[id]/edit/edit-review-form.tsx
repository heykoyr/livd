'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';
import { RadioCardGroup, RatingLegend } from '@/components/ui/choice';
import { CharacterCount, Field, FormError, Textarea } from '@/components/ui/field';
import { Card } from '@/components/ui/primitives';
import { VerificationBadge } from '@/components/property/verify-location';
import { categoryLabel } from '@/config/categories';
import { LIMITS } from '@/config/site';
import { copy } from '@/content/copy';
import { formatTenure } from '@/lib/format';
import { describeRemaining } from '@/lib/reviews/edit-window';
import { initialReviewEditState } from '@/server/actions/action-state';
import { correctReview } from '@/server/actions/reviews';
import type { CategoryRating, ResidencyStatus, VerificationLevel } from '@/types/domain';

/**
 * The correction form.
 *
 * Two fields, because two fields is what a correction is: the words and the
 * recommendation. Everything else the review carries is shown beside them,
 * plainly, as the thing it is — a record of what was published — rather than
 * being quietly absent. Somebody who came here to change a rating should find
 * out why they cannot, on the screen where they looked for it.
 *
 * The rating legend is above the locked ratings for the reason it exists at all
 * (see `RatingLegend`): a bare "3" on a screen with no scale on it is a number
 * the reader has to guess the direction of, and that guess is exactly what
 * `tests/components/rating-guidance.test.tsx` was written to stop.
 *
 * The remaining time is stated once and refreshed quietly, never counted down
 * by the second. It starts from a string the server computed, so hydration
 * matches, and every value after that is derived from the deadline the *write*
 * returned — not from anything this browser decided.
 */
export function EditReviewForm({
  reviewId,
  body: initialBody,
  wouldRecommend: initialRecommend,
  overallRating,
  categoryRatings,
  residencyStatus,
  tenureMonths,
  verificationLevel,
  propertySlug,
  closesAt,
  remainingLabel,
}: {
  reviewId: string;
  body: string;
  wouldRecommend: boolean;
  overallRating: number;
  categoryRatings: CategoryRating[];
  residencyStatus: ResidencyStatus;
  tenureMonths: number;
  verificationLevel: VerificationLevel;
  propertySlug: string | null;
  closesAt: string;
  /** The server's own arithmetic, so the first client render agrees with it. */
  remainingLabel: string;
}) {
  const [body, setBody] = useState(initialBody);
  const [recommend, setRecommend] = useState(initialRecommend);
  const [state, formAction, saving] = useActionState(correctReview, initialReviewEditState);
  const noticeRef = useRef<HTMLDivElement>(null);

  // The deadline the last successful write reported wins over the one the page
  // was rendered with. They agree on a healthy system; when they do not, the
  // database is right.
  const deadline = state.closesAt ?? closesAt;
  const remaining = useRemaining(deadline, remainingLabel);

  // A save is a result, and a result has to reach somebody who cannot see the
  // top of the page or is not looking at it.
  useEffect(() => {
    if (state.status !== 'idle') noticeRef.current?.focus();
  }, [state.status, state.error]);

  const retired = state.status === 'held' || state.windowClosed;

  return (
    <div className="mt-8 flex flex-col gap-8">
      <div ref={noticeRef} tabIndex={-1} className="outline-none">
        {state.status === 'saved' && (
          <Notice tone="positive" title={copy.review.edit.saved}>
            <p className="text-body text-ink-muted">{copy.review.edit.savedBody}</p>
            {propertySlug && (
              <ButtonLink
                href={`/property/${propertySlug}#reviews`}
                variant="secondary"
                size="sm"
                className="mt-4"
              >
                {copy.review.successView}
              </ButtonLink>
            )}
          </Notice>
        )}

        {state.status === 'held' && (
          <Notice tone="caution" title={copy.review.edit.heldTitle}>
            <p className="text-body text-ink-muted">{copy.review.edit.heldBody}</p>
            <ButtonLink href="/account/reviews" variant="secondary" size="sm" className="mt-4">
              {copy.review.edit.cancel}
            </ButtonLink>
          </Notice>
        )}

        {state.status === 'error' && (
          <div className="flex flex-col gap-3">
            <FormError message={state.error} />
            {state.safetyMessages.length > 0 && (
              <ul className="flex flex-col gap-2 rounded-md border border-caution/30 bg-caution-soft p-4">
                {state.safetyMessages.map((message) => (
                  <li key={message} className="flex items-start gap-2 text-body text-caution">
                    <span aria-hidden="true">&bull;</span>
                    {message}
                  </li>
                ))}
              </ul>
            )}
            {state.windowClosed && (
              <ButtonLink href="/account/reviews" variant="secondary" size="sm">
                {copy.review.edit.cancel}
              </ButtonLink>
            )}
          </div>
        )}
      </div>

      {!retired && (
        <form action={formAction} className="flex flex-col gap-8">
          <input type="hidden" name="reviewId" value={reviewId} />

          <div>
            <Field
              label={copy.review.edit.bodyLabel}
              hint={copy.review.steps.words.lead}
              error={state.fieldErrors.body ?? null}
              optional
            >
              {(props) => (
                <Textarea
                  {...props}
                  name="body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  maxLength={LIMITS.reviewBodyMax}
                  rows={10}
                  placeholder={copy.review.steps.words.placeholder}
                />
              )}
            </Field>
            <div className="mt-2 flex justify-end">
              <CharacterCount used={body.length} max={LIMITS.reviewBodyMax} />
            </div>
          </div>

          <RadioCardGroup
            name="wouldRecommend"
            legend={copy.review.steps.words.recommendQuestion}
            value={recommend ? 'yes' : 'no'}
            onChange={(value) => setRecommend(value === 'yes')}
            columns={2}
            options={[
              { value: 'yes', label: copy.review.steps.words.recommendYes },
              { value: 'no', label: copy.review.steps.words.recommendNo },
            ]}
          />

          <LockedSummary
            overallRating={overallRating}
            categoryRatings={categoryRatings}
            residencyStatus={residencyStatus}
            tenureMonths={tenureMonths}
            verificationLevel={verificationLevel}
          />

          {/* An ordinary row rather than a bar pinned to the bottom of the
              viewport. A sticky control over a textarea is the one place it
              reliably goes wrong on a phone: the on-screen keyboard shortens
              the viewport, and the bar lands on top of the words somebody is
              still writing. */}
          <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-micro text-ink-subtle">{copy.review.edit.remaining(remaining)}</p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/account/reviews" variant="ghost">
                {copy.review.edit.cancel}
              </ButtonLink>
              <Button type="submit" size="lg" loading={saving} loadingLabel={copy.review.edit.saving}>
                {copy.review.edit.save}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * What a correction does not touch
 * ---------------------------------------------------------------------- */

function LockedSummary({
  overallRating,
  categoryRatings,
  residencyStatus,
  tenureMonths,
  verificationLevel,
}: {
  overallRating: number;
  categoryRatings: CategoryRating[];
  residencyStatus: ResidencyStatus;
  tenureMonths: number;
  verificationLevel: VerificationLevel;
}) {
  return (
    <Card className="p-5">
      <h2 className="text-label font-semibold text-ink">{copy.review.edit.lockedTitle}</h2>
      <p className="mt-2 text-label text-ink-muted">{copy.review.edit.lockedBody}</p>

      {/* Static here, not sticky: this is a short block a reader passes once,
          rather than a list longer than the screen. */}
      <RatingLegend className="static mt-4" />

      <dl className="mt-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="text-label text-ink-muted">Overall</dt>
          <dd className="text-title-md tabular text-ink">{overallRating}/5</dd>
        </div>

        {categoryRatings.map((rating) => (
          <div
            key={rating.categoryKey}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
          >
            <dt className="text-label text-ink-muted">{categoryLabel(rating.categoryKey)}</dt>
            <dd className="tabular text-body text-ink">{rating.rating}/5</dd>
          </div>
        ))}

        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border pt-3">
          <dt className="text-label text-ink-muted">{copy.review.edit.lockedTenancy}</dt>
          <dd className="text-body text-ink">
            {residencyStatus === 'current' ? 'Current resident' : 'Former resident'} &middot;{' '}
            {formatTenure(tenureMonths)}
          </dd>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="text-label text-ink-muted">Verification</dt>
          <dd>
            <VerificationBadge level={verificationLevel} />
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * Bits
 * ---------------------------------------------------------------------- */

function Notice({
  tone,
  title,
  children,
}: {
  tone: 'positive' | 'caution';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className={
        tone === 'positive'
          ? 'rounded-lg border border-positive/25 bg-positive-soft p-5'
          : 'rounded-lg border border-caution/30 bg-caution-soft p-5'
      }
    >
      <p
        className={
          tone === 'positive'
            ? 'font-display text-title-md tracking-tightish text-positive'
            : 'font-display text-title-md tracking-tightish text-caution'
        }
      >
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/**
 * How long is left, refreshed every minute.
 *
 * Starts from the server's own arithmetic on the first render so hydration has
 * nothing to disagree about, then recomputes from the deadline. A wrong clock
 * on this device makes this line wrong and changes nothing else: the deadline
 * that decides is the one in Postgres.
 */
function useRemaining(closesAt: string, initial: string): string {
  const [remaining, setRemaining] = useState(initial);

  useEffect(() => {
    function tick(): void {
      setRemaining(describeRemaining(new Date(closesAt).getTime() - Date.now()));
    }

    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [closesAt]);

  return remaining;
}
