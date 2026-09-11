'use client';

import Link from 'next/link';
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';
import { FormError } from '@/components/ui/field';
import { Card } from '@/components/ui/primitives';
import { Turnstile } from '@/components/ui/turnstile';
import { LIMITS } from '@/config/site';
import { copy } from '@/content/copy';
import { cn } from '@/lib/utils';
import type { WizardProperty } from '@/server/actions/property-lookup';
import {
  initialReviewSubmitState,
  type ReviewSubmitState,
} from '@/server/actions/action-state';
import { submitReview } from '@/server/actions/reviews';
import {
  ConfirmStep,
  CategoriesStep,
  VerifyStep,
  DatesStep,
  DepartureStep,
  OverallStep,
  PositivesStep,
  ProblemsStep,
  PropertyStep,
  ResidencyStep,
  WordsStep,
  type StepProps,
} from './steps';
import {
  emptyDraft,
  stepsFor,
  toSubmitPayload,
  type StepId,
  type WizardDraft,
} from './wizard-types';

const DRAFT_KEY = 'livd-review-draft';

const STEP_META: Record<StepId, { title: string; lead: string }> = {
  property: copy.review.steps.property,
  verify: copy.review.steps.verify,
  residency: copy.review.steps.residency,
  dates: copy.review.steps.dates,
  overall: copy.review.steps.overall,
  categories: copy.review.steps.categories,
  positives: copy.review.steps.positives,
  problems: copy.review.steps.problems,
  departure: copy.review.steps.departure,
  words: copy.review.steps.words,
  confirm: copy.review.steps.confirm,
};

const STEP_COMPONENTS: Record<StepId, (props: StepProps) => React.ReactElement> = {
  property: PropertyStep,
  verify: VerifyStep,
  residency: ResidencyStep,
  dates: DatesStep,
  overall: OverallStep,
  categories: CategoriesStep,
  positives: PositivesStep,
  problems: ProblemsStep,
  departure: DepartureStep,
  words: WordsStep,
  confirm: ConfirmStep,
};

/**
 * The review wizard.
 *
 * One question per screen, with the step sequence derived from the draft so a
 * current resident is never asked why they left and the progress indicator
 * never counts a step nobody will see.
 *
 * The draft is mirrored to localStorage on every change. Someone writing about
 * three years of their life should not lose it to a stray refresh, and the
 * alternative — a server-side draft — would mean storing an unfinished, unvetted
 * review against a person's identity.
 */
export function ReviewWizard({
  initialProperty,
  propertyPreselected,
  notice,
}: {
  initialProperty: WizardProperty | null;
  propertyPreselected: boolean;
  notice: string | null;
}) {
  const [draft, setDraft] = useState<WizardDraft>(() => emptyDraft(initialProperty));
  const [index, setIndex] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  // Held in state rather than left in the DOM: a token is single-use and
  // expires after about five minutes, and the widget clears it rather than
  // letting the form submit something Cloudflare will refuse.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [state, formAction, submitting] = useActionState(submitReview, initialReviewSubmitState);

  const steps = useMemo(
    () => stepsFor(draft, propertyPreselected),
    [draft, propertyPreselected],
  );
  const stepId = steps[Math.min(index, steps.length - 1)] ?? 'residency';
  const meta = STEP_META[stepId];
  const StepComponent = STEP_COMPONENTS[stepId];

  /* --- Draft persistence --- */

  useEffect(() => {
    try {
      const stored = localStorage.getItem(DRAFT_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as WizardDraft;
      const property = initialProperty ?? parsed.property;
      // A preselected property wins: the reviewer arrived from its page and
      // means that one, whatever an older draft says. A verification the draft
      // was carrying is only kept if it still belongs to the property being
      // reviewed — and even then the server re-checks that it has not expired,
      // which is why a stale one here costs a badge rather than a submission.
      setDraft({
        ...parsed,
        property,
        verificationId:
          property && property.id === parsed.property?.id ? parsed.verificationId : null,
      });
    } catch {
      // Corrupt or unavailable storage is not worth surfacing.
    } finally {
      setRestored(true);
    }
  }, [initialProperty]);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage full or blocked */
    }
  }, [draft, restored]);

  useEffect(() => {
    if (state.status === 'published' || state.status === 'pending') {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [state.status]);

  /* --- Navigation --- */

  const update = useCallback((patch: Partial<WizardDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      // A verification belongs to the property it was taken at. Changing the
      // property has to drop it, or the server refuses the submission and a
      // legitimate change of mind arrives as an error.
      if (patch.property && patch.property.id !== current.property?.id) {
        next.verificationId = null;
      }
      return next;
    });
    setStepError(null);
  }, []);

  function next(): void {
    const error = validateStep(stepId, draft);
    if (error) {
      setStepError(error);
      return;
    }
    setStepError(null);
    setIndex((current) => Math.min(current + 1, steps.length - 1));
  }

  function back(): void {
    setStepError(null);
    setIndex((current) => Math.max(0, current - 1));
  }

  // Moving between steps must move focus, or a keyboard or screen-reader user
  // is left on a button that now belongs to a different question.
  useEffect(() => {
    headingRef.current?.focus();
  }, [index]);

  /* --- Terminal states --- */

  if (state.status === 'published' || state.status === 'pending') {
    return <SubmissionResult state={state} draftWasVerified={draft.verificationId !== null} />;
  }

  const isLast = index === steps.length - 1;
  const payload = JSON.stringify(toSubmitPayload(draft));
  const skippingVerification = stepId === 'verify' && draft.verificationId === null;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <ProgressBar current={index + 1} total={steps.length} />

      {notice && (
        <p className="mt-6 rounded-md border border-positive/25 bg-positive-soft px-3.5 py-2.5 text-label text-positive">
          {notice}
        </p>
      )}

      <div className="mt-8">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-display-md tracking-display text-ink outline-none"
        >
          {meta.title}
        </h1>
        <p className="mt-3 text-body-lg text-ink-muted">{meta.lead}</p>
      </div>

      <div className="mt-8">
        <StepComponent draft={draft} update={update} error={stepError} />
      </div>

      {state.error && (
        <div className="mt-8 flex flex-col gap-3">
          <FormError message={state.error} />
          {state.safetyMessages.length > 0 && (
            <ul className="flex flex-col gap-2 rounded-md border border-caution/30 bg-caution-soft p-4">
              {state.safetyMessages.map((message) => (
                <li key={message} className="flex items-start gap-2 text-body text-caution">
                  <span aria-hidden="true">•</span>
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
        </div>
      )}

      <div className="mt-10 flex items-center justify-between gap-3 border-t border-border pt-6">
        <div>
          {index > 0 && (
            <Button variant="ghost" onClick={back}>
              {copy.review.back}
            </Button>
          )}
        </div>

        {isLast ? (
          <form action={formAction}>
            <input type="hidden" name="draft" value={payload} />
            <input type="hidden" name="captchaToken" value={captchaToken ?? ''} />
            {/* On the last step only. A token lives about five minutes, and
                issuing one at the start of a four-minute wizard would expire
                it somewhere around the departure-reasons screen. The submit
                button is deliberately not gated on it: an extension that
                blocks the script would otherwise strand somebody on a
                disabled button with no explanation, where the server's
                refusal at least says what to do. */}
            <Turnstile action="review-submit" onToken={setCaptchaToken} />
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              loadingLabel={copy.review.submitting}
              disabled={!draft.confirmedGuidelines}
            >
              {copy.review.submit}
            </Button>
          </form>
        ) : (
          <Button
            size="lg"
            // On the verification step the way past is a first-class choice,
            // not a consolation. It says what it does, and it steps down to
            // secondary so the primary action on the screen is unambiguous —
            // rather than two large buttons competing while somebody decides
            // whether to hand over their location.
            variant={skippingVerification ? 'secondary' : 'primary'}
            onClick={next}
          >
            {skippingVerification ? copy.review.steps.verify.skip : copy.review.next}
          </Button>
        )}
      </div>

      {skippingVerification && (
        <p className="mt-4 text-micro text-ink-subtle">
          {copy.review.steps.verify.skipNote}
        </p>
      )}

      <p className="mt-6 text-micro text-ink-subtle">
        Your progress is saved in this browser only. Nothing is sent to Livd until you publish.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Progress
 * ---------------------------------------------------------------------- */

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-label text-ink-muted">
        <span>{copy.review.stepOf(current, total)}</span>
        <Link href="/" className="rounded-sm underline underline-offset-4 hover:text-ink">
          {copy.review.exit}
        </Link>
      </div>
      <div
        className="mt-2 flex gap-1"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={copy.review.stepOf(current, total)}
      >
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-base',
              i < current ? 'bg-brand' : 'bg-surface-sunken',
            )}
          />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Result
 * ---------------------------------------------------------------------- */

function SubmissionResult({
  state,
  draftWasVerified,
}: {
  state: ReviewSubmitState;
  draftWasVerified: boolean;
}) {
  const published = state.status === 'published';

  return (
    <Card className="mx-auto w-full max-w-xl p-8 text-center">
      <div
        aria-hidden="true"
        className={cn(
          'mx-auto grid size-12 place-items-center rounded-full',
          published ? 'bg-positive-soft text-positive' : 'bg-caution-soft text-caution',
        )}
      >
        <svg viewBox="0 0 20 20" className="size-6" fill="none">
          {published ? (
            <path
              d="m4 10.5 4 4 8-9"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <>
              <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10 6v4.5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </>
          )}
        </svg>
      </div>

      <h1 className="mt-5 font-display text-display-md tracking-display text-ink">
        {published ? copy.review.successTitle : copy.review.pendingTitle}
      </h1>
      <p className="mt-3 text-body-lg text-ink-muted">
        {published ? copy.review.successBody : copy.review.pendingBody}
      </p>

      {published && state.verificationLevel === 'location_verified' && (
        <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-positive/25 bg-positive-soft px-3 py-1.5 text-label font-medium text-positive">
          <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden="true">
            <path
              d="m2 6.3 2.3 2.3L10 2.9"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {copy.verification.locationVerified}
        </p>
      )}

      {published && state.verificationLevel === 'unverified' && draftWasVerified && (
        // The one case worth saying out loud: they did verify, and it expired
        // while they were writing. Quietly dropping the badge they had earned
        // would look like the check had failed.
        <p className="mt-5 text-label text-ink-muted">
          {copy.review.verificationExpired}
        </p>
      )}

      {published && (
        <p className="mt-4 text-label text-ink-subtle">
          {copy.review.editWindow(LIMITS.reviewEditWindowHours)}
        </p>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {state.propertySlug && (
          <ButtonLink href={`/property/${state.propertySlug}`} size="lg">
            {copy.review.successView}
          </ButtonLink>
        )}
        <ButtonLink href="/review" variant="secondary" size="lg">
          {copy.review.successAnother}
        </ButtonLink>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * Per-step validation
 *
 * Client-side and advisory only. The server revalidates everything through the
 * same Zod schema; this exists so a reviewer is told about a gap on the screen
 * where they can fix it, rather than nine screens later.
 * ---------------------------------------------------------------------- */

function validateStep(stepId: StepId, draft: WizardDraft): string | null {
  switch (stepId) {
    case 'property':
      return draft.property ? null : 'Choose the property you lived in.';

    // No case for 'verify'. Verification is never required, so the step has
    // nothing to validate — the reviewer either did it or continued past it,
    // and both are complete answers.

    case 'residency':
      return draft.residencyStatus ? null : 'Let us know whether you still live there.';

    case 'dates': {
      if (!draft.movedInMonth) return 'Tell us roughly when you moved in.';
      if (draft.residencyStatus === 'former' && !draft.movedOutMonth) {
        return 'Tell us roughly when you moved out.';
      }
      if (
        draft.movedOutMonth &&
        draft.movedInMonth &&
        draft.movedOutMonth < draft.movedInMonth
      ) {
        return 'The move-out date cannot be before the move-in date.';
      }
      if (draft.movedInMonth > new Date().toISOString().slice(0, 10)) {
        return 'You cannot review a tenancy that has not started.';
      }
      return null;
    }

    case 'overall':
      return draft.overallRating ? null : 'Choose a rating to continue.';

    case 'categories':
      // At least one category, or the review carries no comparable signal at all.
      return Object.keys(draft.categoryRatings).length > 0
        ? null
        : 'Rate at least one category, or skip the ones that did not apply.';

    case 'departure':
      return draft.primaryDepartureReason ? null : 'Choose the main reason you left.';

    case 'words': {
      const trimmed = draft.body.trim();
      if (trimmed.length > 0 && trimmed.length < LIMITS.reviewBodyMin) {
        return copy.safety.tooShort(LIMITS.reviewBodyMin);
      }
      if (draft.wouldRecommend === null) return 'Let us know whether you would live here again.';
      return null;
    }

    case 'confirm':
      return draft.confirmedGuidelines ? null : copy.review.steps.confirm.agree;

    default:
      return null;
  }
}
