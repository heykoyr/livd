'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/field';
import { VERIFICATION_LIMITS } from '@/lib/safety/verification-checks';
import { initialVerificationSubmitState } from '@/server/actions/action-state';
import { submitVerificationEvidence } from '@/server/actions/verification';
import type { VerificationOutcome } from '@/types/domain';

/**
 * Offering proof that you lived somewhere.
 *
 * The thing being asked for here is a document with the reviewer's name and
 * address on it, from someone whose whole reason for using Livd is that their
 * landlord will not know who wrote the review. So the copy says plainly where
 * it goes, who reads it, and what happens to it — before the file picker, not
 * in a policy page.
 *
 * Verification is never required. A review without it is published, counted and
 * permanent; verification only changes how much weight it carries.
 */
export function VerifyResidency({
  reviewId,
  outcome,
}: {
  reviewId: string;
  /** The most recent request on this review, if there is one. */
  outcome: VerificationOutcome | null;
}) {
  const [state, formAction, pending] = useActionState(
    submitVerificationEvidence,
    initialVerificationSubmitState,
  );

  if (outcome === 'approved') {
    return (
      <p className="mt-4 border-t border-border pt-3 text-micro text-positive">
        Verified resident. This review counts for more in the property&rsquo;s score.
      </p>
    );
  }

  if (outcome === 'pending' && !state.message) {
    return (
      <p className="mt-4 border-t border-border pt-3 text-micro text-ink-subtle">
        A moderator is looking at the document you sent. Your review is published and unchanged
        while they do.
      </p>
    );
  }

  return (
    <details className="mt-4 border-t border-border pt-3">
      <summary className="cursor-pointer text-micro text-ink-muted hover:text-ink">
        {outcome === 'rejected'
          ? 'The last document was not enough — send another'
          : 'Show that you lived here'}
      </summary>

      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="reviewId" value={reviewId} />

        <div className="rounded-md bg-surface-sunken/60 p-4 text-label text-ink-muted">
          <p>
            A tenancy agreement, a utility bill or anything addressed to you at this property.
            One moderator opens it, decides, and never sees it again; it is stored where no
            account — including yours — can read it back.
          </p>
          <p className="mt-2">
            <strong className="font-medium text-ink">Your review does not change.</strong> It stays
            anonymous and it stays published either way. Verifying only means it counts for more
            against the ones nobody has checked.
          </p>
          <p className="mt-2">
            Cover anything you would rather not send. Only the name, the address and the dates
            need to be readable.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-ink">What are you sending?</span>
          <select
            name="method"
            required
            className="h-11 rounded-md border border-border-strong bg-surface px-3 text-body text-ink"
          >
            <option value="tenancy_agreement">A tenancy agreement</option>
            <option value="utility_bill">A utility bill</option>
            <option value="correspondence">Post addressed to me there</option>
            <option value="other">Something else</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-ink">The document</span>
          <input
            type="file"
            name="evidence"
            required
            accept={VERIFICATION_LIMITS.acceptedTypes.join(',')}
            className="text-label text-ink-muted file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:py-2 file:text-label file:text-ink"
          />
          <span className="text-micro text-ink-subtle">
            JPEG, PNG, WebP, HEIC or PDF, up to {VERIFICATION_LIMITS.maxBytes / 1024 / 1024}MB.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" loading={pending}>
            Send it
          </Button>
        </div>

        {state.error && <FormError message={state.error} />}

        {state.checks.length > 0 && (
          <ul className="flex flex-col gap-2">
            {state.checks.map((check) => (
              <li
                key={check.code}
                className="rounded-md border-l-2 border-critical bg-critical-soft/50 p-3 text-label text-ink"
              >
                {check.detail}
              </li>
            ))}
          </ul>
        )}

        {state.message && (
          <p role="status" className="text-label text-positive">
            {state.message}
          </p>
        )}
      </form>
    </details>
  );
}
