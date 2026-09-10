'use client';

import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormError, Input } from '@/components/ui/field';
import { initialModerationState } from '@/server/actions/action-state';
import {
  decideClaim,
  decidePropertyFlag,
  resolveReport,
  setReviewStatus,
  setReviewVerification,
  setUserRole,
} from '@/server/actions/moderation';
import {
  decideVerification,
  getVerificationEvidenceLink,
} from '@/server/actions/verification';

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
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="reviewId" value={reviewId} />

      <label className="flex flex-col gap-1.5">
        <span className="text-label text-ink-muted">Verification — why</span>
        <Input
          name="reason"
          required
          minLength={3}
          maxLength={500}
          placeholder="Setting this by hand changes how much the review counts."
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
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
      </div>

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
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="claimId" value={claimId} />

      <label className="flex flex-col gap-1.5">
        <span className="text-label text-ink-muted">{copyReason}</span>
        <Input
          name="reason"
          required
          minLength={3}
          maxLength={500}
          placeholder="What was checked, and against what?"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="status" value="approved" variant="secondary" size="sm" loading={pending}>
          Approve
        </Button>
        <Button type="submit" name="status" value="rejected" variant="ghost" size="sm" loading={pending}>
          Reject
        </Button>
      </div>

      <p className="text-micro text-ink-subtle">
        Approving gives this party a public voice on the property page. One approved claim per
        property — revoking an existing one is a separate decision.
      </p>

      <Feedback state={state} />
    </form>
  );
}

const ROLE_OPTIONS = [
  { value: 'resident', label: 'Resident' },
  { value: 'owner', label: 'Owner' },
  { value: 'moderator', label: 'Moderator' },
  { value: 'trust_admin', label: 'Trust & Safety admin' },
  { value: 'admin', label: 'Administrator' },
] as const;

/**
 * Grants a role.
 *
 * The reason field is not politeness. `livd_set_user_role` refuses a change
 * that arrives without one, because the audit row and the role change are
 * written in the same transaction — a role that moved without a recorded
 * reason is not a state the database can be left in.
 */
export function RoleControls({ userId, currentRole }: { userId: string; currentRole: string }) {
  const [state, formAction, pending] = useActionState(setUserRole, initialModerationState);

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="userId" value={userId} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`role-${userId}`}>
          Role
        </label>
        <select
          id={`role-${userId}`}
          name="role"
          defaultValue={currentRole}
          className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-label text-ink"
        >
          {ROLE_OPTIONS.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor={`role-reason-${userId}`}>
          Reason for this role change
        </label>
        <Input
          id={`role-reason-${userId}`}
          name="reason"
          required
          minLength={3}
          maxLength={500}
          placeholder="Why this change?"
          className="h-9 w-52"
        />

        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Update
        </Button>
      </div>

      <Feedback state={state} />
    </form>
  );
}

export function FlagControls({ flagId }: { flagId: string }) {
  const [state, formAction, pending] = useActionState(decidePropertyFlag, initialModerationState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="flagId" value={flagId} />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="status" value="reviewed" variant="secondary" size="sm" loading={pending}>
          Looked at it
        </Button>
        <Button type="submit" name="status" value="dismissed" variant="ghost" size="sm" loading={pending}>
          Nothing wrong here
        </Button>
      </div>

      {/* No written reason is asked for, unlike every other control in this
          file. Nothing here changes what the public sees — the reviews are
          untouched either way — so the friction would buy nothing and would
          slow down the one queue that needs to be cleared quickly to stay
          useful. Acting on the reviews themselves still requires one. */}
      <p className="text-micro text-ink-subtle">
        Deciding a flag does not touch the reviews behind it. If this is a campaign, hold or
        remove each review separately, with a reason.
      </p>

      <Feedback state={state} />
    </form>
  );
}

export function VerificationControlsForRecord({ recordId }: { recordId: string }) {
  const [state, formAction, pending] = useActionState(decideVerification, initialModerationState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="recordId" value={recordId} />

      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink">What did the document show?</span>
        <Input
          name="notes"
          required
          minLength={3}
          maxLength={500}
          placeholder="Tenancy agreement, address and dates match the review."
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="outcome" value="approved" size="sm" loading={pending}>
          Verify this resident
        </Button>
        <Button
          type="submit"
          name="outcome"
          value="rejected"
          variant="secondary"
          size="sm"
          loading={pending}
        >
          Not enough
        </Button>
      </div>

      <p className="text-micro text-ink-subtle">
        Verifying multiplies this review&rsquo;s weight in the property&rsquo;s score. Rejecting
        leaves the review exactly as it is and still published — failing to produce a document is
        not evidence of having lied.
      </p>

      <Feedback state={state} />
    </form>
  );
}

/**
 * Opens a residency document.
 *
 * Three things changed here after the audit. It requires Trust & Safety rather
 * than moderator, because a tenancy agreement carries a name, an address and a
 * signature and reading one identifies the reviewer as surely as reading their
 * email does. It requires a written reason. And the access is recorded before
 * the link is minted, so there is no path that produces a URL without a record
 * naming who asked for it.
 *
 * The link still lasts minutes and is still never rendered into the page's
 * HTML — a cached page, a screenshot or a tab left open overnight does not
 * carry a tenancy agreement with it.
 */
export function EvidenceViewer({
  recordId,
  mime,
  canOpen,
}: {
  recordId: string;
  mime: string | null;
  canOpen: boolean;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'loading'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function reveal(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setState('loading');
    setError(null);

    const result = await getVerificationEvidenceLink(recordId, reason);

    setState('idle');
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setLink(result.url);
  }

  if (!canOpen) {
    return (
      <div className="rounded-md border border-border bg-surface-sunken/50 p-3.5">
        <p className="text-label text-ink-muted">
          The document is not opened from here. A tenancy agreement carries a name, an address and
          a signature — reading one needs Trust &amp; Safety authorisation, a written reason, and
          is recorded.
        </p>
      </div>
    );
  }

  if (link) {
    return (
      <figure className="flex flex-col gap-2">
        {mime === 'application/pdf' ? (
          <object data={link} type="application/pdf" className="h-[28rem] w-full rounded-md border border-border">
            <a href={link} className="text-label text-brand underline underline-offset-4">
              Open the document
            </a>
          </object>
        ) : (
          // A plain <img>, deliberately: this is a signed URL to a private
          // bucket that expires in minutes, and next/image would proxy and
          // cache it — the opposite of what evidence needs.
          <img
            src={link}
            alt="Submitted residency evidence"
            className="max-h-[28rem] w-auto rounded-md border border-border object-contain"
          />
        )}
        <figcaption className="text-micro text-ink-subtle">
          This link expires in a few minutes, and this access has been recorded. Reload the page to
          request it again.
        </figcaption>
      </figure>
    );
  }

  return (
    <form onSubmit={reveal} className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink">Why are you opening this?</span>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          minLength={3}
          maxLength={500}
          placeholder="Deciding the residency verification for this review."
        />
        <span className="text-micro text-ink-subtle">
          Recorded in the audit log with your name before the document is opened.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" loading={state === 'loading'}>
          Show the document
        </Button>
        <p className="text-micro text-ink-subtle">
          Opened on request, and only for as long as it takes to read.
        </p>
      </div>

      {error && <FormError message={error} />}
    </form>
  );
}
