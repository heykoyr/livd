'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { FormError, Input } from '@/components/ui/field';
import { initialModerationState } from '@/server/actions/action-state';
import {
  decideClaim,
  resolveReport,
  setReviewStatus,
  setReviewVerification,
  setUserRole,
} from '@/server/actions/moderation';

/**
 * Moderation controls.
 *
 * Every decision that changes what the public sees requires a written reason
 * before the button will submit. That is deliberate friction: the reason goes
 * into an append-only audit log, and a moderation system whose decisions cannot
 * be explained later is not accountable to anyone.
 */

function Feedback({ state }: { state: typeof initialModerationState }) {
  if (state.error) return <FormError message={state.error} />;
  if (state.message) {
    return (
      <p role="status" className="text-label text-positive">
        {state.message}
      </p>
    );
  }
  return null;
}

export function ReviewStatusControls({
  reviewId,
  currentStatus,
}: {
  reviewId: string;
  currentStatus: string;
}) {
  const [state, formAction, pending] = useActionState(setReviewStatus, initialModerationState);

  const options =
    currentStatus === 'removed'
      ? [{ value: 'published', label: 'Restore', variant: 'secondary' as const }]
      : [
          { value: 'published', label: 'Publish', variant: 'secondary' as const },
          { value: 'removed', label: 'Remove', variant: 'danger' as const },
        ];

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="reviewId" value={reviewId} />

      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink">{copyReason}</span>
        <Input
          name="reason"
          required
          minLength={3}
          maxLength={500}
          placeholder="Why this decision?"
        />
        <span className="text-micro text-ink-subtle">
          Recorded in the audit log. Never shown to the reviewer.
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.value}
            type="submit"
            name="status"
            value={option.value}
            variant={option.variant}
            size="sm"
            loading={pending}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <Feedback state={state} />
    </form>
  );
}

const copyReason = 'Reason for this decision';

export function VerificationControls({ reviewId }: { reviewId: string }) {
  const [state, formAction, pending] = useActionState(
    setReviewVerification,
    initialModerationState,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <span className="text-label text-ink-muted">Verification:</span>

      {[
        { value: 'verified_resident', label: 'Verify' },
        { value: 'unverified', label: 'Unverify' },
        { value: 'disputed', label: 'Dispute' },
      ].map((option) => (
        <Button
          key={option.value}
          type="submit"
          name="level"
          value={option.value}
          variant="ghost"
          size="sm"
          loading={pending}
        >
          {option.label}
        </Button>
      ))}

      <Feedback state={state} />
    </form>
  );
}

export function ReportControls({ reportId }: { reportId: string }) {
  const [state, formAction, pending] = useActionState(resolveReport, initialModerationState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="reportId" value={reportId} />

      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink">Resolution</span>
        <Input
          name="resolution"
          required
          minLength={3}
          maxLength={500}
          placeholder="What did you find?"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="status" value="upheld" variant="secondary" size="sm" loading={pending}>
          Uphold
        </Button>
        <Button type="submit" name="status" value="dismissed" variant="ghost" size="sm" loading={pending}>
          Dismiss
        </Button>
      </div>

      <p className="text-micro text-ink-subtle">
        Upholding records the decision. Removing the review is a separate action, so a
        coordinated reporting campaign cannot take content down on its own.
      </p>

      <Feedback state={state} />
    </form>
  );
}

export function ClaimControls({ claimId }: { claimId: string }) {
  const [state, formAction, pending] = useActionState(decideClaim, initialModerationState);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="claimId" value={claimId} />
      <Button type="submit" name="status" value="approved" variant="secondary" size="sm" loading={pending}>
        Approve
      </Button>
      <Button type="submit" name="status" value="rejected" variant="ghost" size="sm" loading={pending}>
        Reject
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function RoleControls({ userId, currentRole }: { userId: string; currentRole: string }) {
  const [state, formAction, pending] = useActionState(setUserRole, initialModerationState);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={currentRole}
        className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-label text-ink"
      >
        {['resident', 'owner', 'moderator', 'admin'].map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        Update
      </Button>
      <Feedback state={state} />
    </form>
  );
}
