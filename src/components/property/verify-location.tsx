'use client';

import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { useGeolocation, type GeolocationErrorKind } from '@/lib/geo/use-geolocation';
import { cn } from '@/lib/utils';
import { verifyPropertyLocation } from '@/server/actions/property-verification';
import {
  initialPropertyVerificationState,
  type PropertyVerificationState,
} from '@/server/actions/action-state';
import type { PropertyVerificationFailureReason } from '@/types/domain';

/**
 * Verifying that you are at a property.
 *
 * The tone is the specification. This screen asks somebody to hand over their
 * location, and the difference between a product that "cares about the quality
 * of its information" and one that is "tracking me" is almost entirely in what
 * it says before the browser prompt appears rather than after.
 *
 * So: what the location is for, what happens to it, and who never sees it —
 * stated in three lines, above the button that triggers the prompt. No warning
 * banner, no padlock iconography, no security vocabulary. The way out is a
 * plain link at the same visual weight as the primary action, because the way
 * out is a legitimate choice and hiding it would make the rest of the copy a
 * lie.
 *
 * Not a modal. A dialog that appears over unsaved work and traps focus, on a
 * phone, in the middle of a form, is the interaction people learn to dismiss
 * without reading.
 */
export function VerifyLocation({
  propertyId,
  propertyName,
  verified,
  onVerified,
  onSkip,
}: {
  propertyId: string;
  propertyName: string;
  /** True when this session already holds a live verification for the property. */
  verified: boolean;
  onVerified: (verificationId: string) => void;
  /** Omitted where skipping is not a step, such as the standalone panel. */
  onSkip?: () => void;
}) {
  const geo = useGeolocation();
  const [state, setState] = useState<PropertyVerificationState>(
    initialPropertyVerificationState,
  );
  const [submitting, setSubmitting] = useState(false);

  const run = useCallback(async () => {
    setState(initialPropertyVerificationState);

    const reading = await geo.request();
    if (!reading) return; // The hook's own error state is already showing.

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set('propertyId', propertyId);
      formData.set('latitude', String(reading.latitude));
      formData.set('longitude', String(reading.longitude));
      formData.set('accuracyMeters', String(reading.accuracyMeters));
      formData.set('capturedAtMs', String(reading.capturedAtMs));

      const result = await verifyPropertyLocation(initialPropertyVerificationState, formData);
      setState(result);

      if (result.status === 'verified' && result.verificationId) {
        onVerified(result.verificationId);
      }
    } finally {
      setSubmitting(false);
      // The reading has done its work. Dropping it is not strictly necessary —
      // it never left this component and was never written anywhere — but a
      // coordinate sitting in component state for the rest of the session is a
      // coordinate that can end up in an error report.
      geo.clear();
    }
  }, [geo, onVerified, propertyId]);

  const working = geo.status === 'requesting' || submitting;

  if (verified || state.status === 'verified') {
    return <VerifiedPanel />;
  }

  const problem = describeProblem(geo.error, state);

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5 md:p-6">
        <p className="text-body text-ink">{copy.review.steps.verify.explainer}</p>
        <p className="mt-3 text-label text-ink-muted">{copy.review.steps.verify.honestNote}</p>
      </Card>

      {problem && (
        <div
          // Not an alert: this is the result of something the person just did,
          // and a polite live region announces it without interrupting them.
          role="status"
          aria-live="polite"
          className="rounded-md border-l-2 border-caution bg-caution-soft/50 p-4"
        >
          <p className="text-label font-medium text-ink">{problem.title}</p>
          <p className="mt-1 text-label text-ink-muted">{problem.body}</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Button
          size="lg"
          onClick={run}
          loading={working}
          loadingLabel={copy.review.steps.verify.working}
        >
          {problem ? copy.verification.errors.retry : copy.review.steps.verify.cta}
        </Button>

        {onSkip && (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={onSkip}
              className="self-start rounded-sm text-label font-medium text-ink-muted underline underline-offset-4 transition-colors duration-fast hover:text-ink"
            >
              {copy.review.steps.verify.skip}
            </button>
            <p className="text-micro text-ink-subtle">{copy.review.steps.verify.skipNote}</p>
          </div>
        )}
      </div>

      <p className="sr-only">
        Verifying {propertyName}. Your location is used once and is not stored.
      </p>
    </div>
  );
}

function VerifiedPanel() {
  return (
    <Card
      className="border-positive/30 bg-positive-soft/40 p-5 md:p-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-positive text-canvas"
        >
          <svg viewBox="0 0 14 14" className="size-3.5" fill="none">
            <path
              d="m3 7.4 2.7 2.7L11 4.2"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="font-display text-title-md tracking-tightish text-ink">
            {copy.review.steps.verify.successTitle}
          </p>
          <p className="mt-1 text-body text-ink-muted">
            {copy.review.steps.verify.successBody}
          </p>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * Turning a failure into something a person can act on
 *
 * Every state below has a way forward, and none of them reveals how far away
 * the reading was. "You are 214 metres outside the area" is a range-finder:
 * enough refusals like that and a building's position is known precisely.
 * ---------------------------------------------------------------------- */

function describeProblem(
  geoError: GeolocationErrorKind | null,
  state: PropertyVerificationState,
): { title: string; body: string } | null {
  const errors = copy.verification.errors;

  if (geoError) {
    switch (geoError) {
      case 'permission_denied':
        return { title: errors.permissionDeniedTitle, body: errors.permissionDeniedBody };
      case 'timeout':
        return { title: errors.timeoutTitle, body: errors.timeoutBody };
      case 'unsupported':
        return { title: errors.unsupportedTitle, body: errors.unsupportedBody };
      default:
        return { title: errors.unavailableTitle, body: errors.unavailableBody };
    }
  }

  if (state.status === 'error' && state.error) {
    return { title: errors.unavailableTitle, body: state.error };
  }

  if (state.status === 'failed') {
    return describeFailure(state.failureReason);
  }

  return null;
}

function describeFailure(
  reason: PropertyVerificationFailureReason | null,
): { title: string; body: string } {
  const errors = copy.verification.errors;

  switch (reason) {
    case 'outside_area':
      return { title: errors.outsideAreaTitle, body: errors.outsideAreaBody };
    case 'accuracy_too_low':
      return { title: errors.accuracyTitle, body: errors.accuracyBody };
    case 'fix_too_old':
      return { title: errors.fixTooOldTitle, body: errors.fixTooOldBody };
    case 'property_has_no_coordinates':
      return { title: errors.noCoordinatesTitle, body: errors.noCoordinatesBody };
    case 'implausible_movement':
      // Deliberately vague. Telling somebody which anti-abuse rule they tripped
      // tells them how to arrange the next attempt so it does not.
      return { title: errors.implausibleTitle, body: errors.implausibleBody };
    default:
      return { title: errors.accuracyTitle, body: errors.accuracyBody };
  }
}

/* -------------------------------------------------------------------------
 * Badges
 * ---------------------------------------------------------------------- */

/**
 * The public trust indicator on a review.
 *
 * A word, always. The tick and the tint are decoration on top of text that
 * already says what it means, so nothing here depends on colour vision or on
 * an icon font having loaded.
 */
export function VerificationBadge({
  level,
  className,
}: {
  level: 'unverified' | 'location_verified' | 'verified_resident' | 'disputed';
  className?: string;
}) {
  if (level === 'unverified') return null;

  const label =
    level === 'verified_resident'
      ? copy.verification.residentVerified
      : level === 'location_verified'
        ? copy.verification.locationVerified
        : copy.verification.disputed;

  const title =
    level === 'verified_resident'
      ? copy.verification.residentVerifiedMeaning
      : level === 'location_verified'
        ? copy.verification.locationVerifiedMeaning
        : undefined;

  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-micro font-medium',
        level === 'disputed'
          ? 'border-caution/25 bg-caution-soft text-caution'
          : 'border-positive/25 bg-positive-soft text-positive',
        className,
      )}
    >
      {level !== 'disputed' && (
        <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden="true">
          <path
            d="m2 6.3 2.3 2.3L10 2.9"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {label}
    </span>
  );
}
