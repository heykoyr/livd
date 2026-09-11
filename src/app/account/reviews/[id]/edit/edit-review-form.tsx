'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';
import { RadioCardGroup, RatingLegend, RatingScale } from '@/components/ui/choice';
import { CharacterCount, Field, FormError, Textarea } from '@/components/ui/field';
import { Card } from '@/components/ui/primitives';
import { VerificationBadge } from '@/components/property/verify-location';
import {
  CATEGORY_DEFINITIONS,
  CORE_CATEGORIES,
  suggestedExtendedCategories,
} from '@/config/categories';
import { LIMITS } from '@/config/site';
import { copy } from '@/content/copy';
import { formatTenure } from '@/lib/format';
import { cn } from '@/lib/utils';
import { describeRemaining } from '@/lib/reviews/edit-window';
import { initialReviewEditState } from '@/server/actions/action-state';
import { correctReview } from '@/server/actions/reviews';
import type { CategoryRating, ResidencyStatus, VerificationLevel } from '@/types/domain';

/**
 * The correction form.
 *
 * What a person *said* is editable — the words, the ratings, and whether they
 * would live there again. What they *claimed* is not: the tenancy, the
 * property, the rent and the verification are shown beside the fields as the
 * record they are, because those are not opinions to revise.
 *
 * The ratings became editable in 0047. Two things make that safe rather than a
 * way to launder a review's meaning, and neither is in this file: the window is
 * twenty-four hours from a `created_at` the database will not let anybody move,
 * and `livd_snapshot_review` copies the score a review was published with —
 * overall and every category — before any of it changes.
 *
 * The rating legend sits above the scales, sticky, which is the whole reason
 * `RatingLegend` exists: the compact scale has no room for a word under each
 * number, and this list is longer than a phone screen, so a legend printed once
 * at the top would be gone exactly when somebody needs it. Held to that by
 * `tests/components/rating-guidance.test.tsx`.
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
  overallRating: initialOverall,
  categoryRatings: initialCategories,
  residencyStatus,
  tenureMonths,
  verificationLevel,
  countryCode,
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
  countryCode: string | null;
  propertySlug: string | null;
  closesAt: string;
  /** The server's own arithmetic, so the first client render agrees with it. */
  remainingLabel: string;
}) {
  const [body, setBody] = useState(initialBody);
  const [recommend, setRecommend] = useState(initialRecommend);
  const [overall, setOverall] = useState(initialOverall);
  const [ratings, setRatings] = useState<Record<string, number>>(() =>
    Object.fromEntries(initialCategories.map((rating) => [rating.categoryKey, rating.rating])),
  );
  const [showAll, setShowAll] = useState(false);

  const [state, formAction, saving] = useActionState(correctReview, initialReviewEditState);
  const noticeRef = useRef<HTMLDivElement>(null);

  // The deadline the last successful write reported wins over the one the page
  // was rendered with. They agree on a healthy system; when they do not, the
  // database is right.
  const deadline = state.closesAt ?? closesAt;
  const remaining = useRemaining(deadline, remainingLabel);

  /*
    Which categories to show. Everything this review already carries, plus the
    core set and whatever this market suggests, with the rest behind a
    disclosure — the same shape as the wizard's category step.

    A rated category is always visible whether or not it is core or suggested,
    because a rating that exists and cannot be seen is a rating somebody cannot
    correct, which is the bug this whole feature is about.
  */
  const visible = useMemo(() => {
    const suggested = suggestedExtendedCategories(countryCode);
    const shown = new Set([
      ...Object.keys(ratings),
      ...CORE_CATEGORIES.map((c) => c.key),
      ...suggested.map((c) => c.key),
    ]);

    return CATEGORY_DEFINITIONS.filter((c) => (showAll ? true : shown.has(c.key)));
  }, [countryCode, ratings, showAll]);

  const hiddenCount = CATEGORY_DEFINITIONS.length - visible.length;

  // A save is a result, and a result has to reach somebody who cannot see the
  // top of the page or is not looking at it.
  useEffect(() => {
    if (state.status !== 'idle') noticeRef.current?.focus();
  }, [state.status, state.error]);

  const retired = state.status === 'held' || state.windowClosed;

  const payload = JSON.stringify(
    Object.entries(ratings).map(([categoryKey, rating]) => ({ categoryKey, rating })),
  );

  function rate(key: string, rating: number): void {
    setRatings((current) => ({ ...current, [key]: rating }));
  }

  function clear(key: string): void {
    setRatings((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

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
            {Object.entries(state.fieldErrors).length > 0 && (
              <ul className="flex flex-col gap-1 text-label text-critical">
                {Object.entries(state.fieldErrors).map(([field, message]) => (
                  <li key={field}>{message}</li>
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
          <input type="hidden" name="overallRating" value={overall} />
          {/* One field rather than one control per category. The set is a
              single value, and scattering it across `category-noise=3` keys
              would make "which categories were cleared" something the server
              has to infer from absence. */}
          <input type="hidden" name="categoryRatings" value={payload} />

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

          {/* The legend opens the ratings section and stays put through all of
              it — see `RatingLegend`. */}
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="font-display text-title-md tracking-tightish text-ink">
                {copy.review.edit.ratingsTitle}
              </h2>
              <p className="mt-1 text-label text-ink-muted">{copy.review.edit.ratingsLead}</p>
            </div>

            <RatingLegend />

            <RatingScale
              name="overall"
              legend={copy.review.steps.overall.title}
              value={overall}
              onChange={setOverall}
            />

            <ul className="flex flex-col gap-6">
              {visible.map((category) => {
                const rating = ratings[category.key];
                return (
                  <li
                    key={category.key}
                    className={cn(
                      'rounded-lg border p-4 transition-colors duration-fast',
                      rating === undefined
                        ? 'border-dashed border-border opacity-60'
                        : 'border-border',
                    )}
                  >
                    <RatingScale
                      name={`category-${category.key}`}
                      legend={category.label}
                      description={category.prompt}
                      value={rating ?? null}
                      onChange={(value) => rate(category.key, value)}
                      onSkip={() => clear(category.key)}
                      skipLabel={copy.review.steps.categories.notApplicable}
                      size="sm"
                    />
                  </li>
                );
              })}
            </ul>

            {!showAll && hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="self-start rounded-md text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
              >
                {copy.review.steps.categories.addMore}
              </button>
            )}
          </div>

          <LockedSummary
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
              <Button
                type="submit"
                size="lg"
                loading={saving}
                loadingLabel={copy.review.edit.saving}
              >
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
  residencyStatus,
  tenureMonths,
  verificationLevel,
}: {
  residencyStatus: ResidencyStatus;
  tenureMonths: number;
  verificationLevel: VerificationLevel;
}) {
  return (
    <Card className="p-5">
      <h2 className="text-label font-semibold text-ink">{copy.review.edit.lockedTitle}</h2>
      <p className="mt-2 text-label text-ink-muted">{copy.review.edit.lockedBody}</p>

      <dl className="mt-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
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
