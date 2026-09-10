'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { FormError, Input, Select, Textarea } from '@/components/ui/field';
import { initialModerationState } from '@/server/actions/action-state';
import { addCaseEvidence, withdrawCaseEvidence } from '@/server/actions/evidence';

/**
 * Evidence controls.
 *
 * Adding is ordinary. Withdrawing asks for a reason and says plainly that the
 * item stays — because the word "withdraw" invites the assumption that it
 * deletes, and somebody clicking it believing that is somebody who will be
 * surprised later, in a case review, when it is still there.
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

export function AddEvidenceControls({ caseId }: { caseId: string }) {
  const [state, formAction, pending] = useActionState(addCaseEvidence, initialModerationState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="caseId" value={caseId} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1.5 sm:w-44">
          <span className="text-label font-medium text-ink">Kind</span>
          <Select name="kind" defaultValue="note">
            <option value="note">Note or record</option>
            <option value="link">External reference</option>
            <option value="file">File</option>
          </Select>
        </label>

        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-label font-medium text-ink">Title</span>
          <Input
            name="title"
            required
            minLength={1}
            maxLength={200}
            placeholder="Screenshot supplied by the reporter"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink">
          Description
          <span className="ml-1.5 font-normal text-ink-subtle">Optional</span>
        </span>
        <Textarea
          name="description"
          rows={2}
          maxLength={2000}
          placeholder="What this is, where it came from, and why it matters to the case."
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Add evidence
        </Button>
        <span className="text-micro text-ink-subtle">
          Immutable once added. A correction is a new version, and both remain readable.
        </span>
      </div>

      <Feedback state={state} />
    </form>
  );
}

export function WithdrawEvidenceControls({
  caseId,
  evidenceId,
}: {
  caseId: string;
  evidenceId: string;
}) {
  const [state, formAction, pending] = useActionState(withdrawCaseEvidence, initialModerationState);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="evidenceId" value={evidenceId} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`withdraw-${evidenceId}`}>
          Reason for withdrawing this evidence
        </label>
        <Input
          id={`withdraw-${evidenceId}`}
          name="reason"
          required
          minLength={3}
          maxLength={500}
          placeholder="Why withdraw this?"
          className="h-9 w-64"
        />
        <Button type="submit" variant="ghost" size="sm" loading={pending}>
          Withdraw
        </Button>
      </div>

      <p className="text-micro text-ink-subtle">
        Marks the item withdrawn. It stays on the case, with your reason.
      </p>

      <Feedback state={state} />
    </form>
  );
}
