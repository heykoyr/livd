'use client';

import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormError, Input, Select, Textarea } from '@/components/ui/field';
import { initialModerationState } from '@/server/actions/action-state';
import {
  addCaseNote,
  assignCase,
  openCase,
  setCasePreservation,
  setCasePriority,
  setCaseStatus,
} from '@/server/actions/cases';
import type { CaseCategory, CasePriority, CaseStatus } from '@/types/domain';
import { CASE_PRIORITY_LABELS, CASE_STATUS_LABELS, CONCLUDING_STATUSES } from './labels';

/**
 * Case controls.
 *
 * Each one is a form posting to a Server Action that hands off to the
 * administrative layer. None of them decides anything: the database refuses
 * what these refuse, plus the caller's role, so a control rendered by mistake
 * is a bad experience rather than a hole.
 *
 * The one piece of real logic here is the outcome field appearing when a
 * concluding status is chosen — which is a courtesy, not a control. Postgres
 * refuses to conclude a case without one either way.
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

/** Opens a case from a report, on the reports page. */
export function OpenCaseControls({
  reportId,
  categories,
  defaultCategory,
  defaultSummary,
}: {
  reportId: string;
  categories: CaseCategory[];
  defaultCategory: string;
  defaultSummary: string;
}) {
  const [state, formAction, pending] = useActionState(openCase, initialModerationState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="reportId" value={reportId} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1.5 sm:w-56">
          <span className="text-label font-medium text-ink">Category</span>
          <Select name="category" defaultValue={defaultCategory}>
            {categories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-label font-medium text-ink">Summary</span>
          <Input
            name="summary"
            required
            minLength={3}
            maxLength={500}
            defaultValue={defaultSummary}
            placeholder="One line a colleague could pick this up from."
          />
        </label>

        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Open a case
        </Button>
      </div>

      <p className="text-micro text-ink-subtle">
        Opening a case does not hide, flag or change the review. Acting on the review is a separate
        decision with its own reason.
      </p>

      <Feedback state={state} />
    </form>
  );
}

export function AssignControls({
  caseId,
  currentAssignee,
  moderators,
  viewerId,
}: {
  caseId: string;
  currentAssignee: string | null;
  moderators: Array<{ id: string; label: string }>;
  viewerId: string | null;
}) {
  const [state, formAction, pending] = useActionState(assignCase, initialModerationState);

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="caseId" value={caseId} />

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Assign this case to</span>
          <Select name="assigneeId" defaultValue={currentAssignee ?? ''} className="h-9 min-w-52">
            <option value="">Nobody</option>
            {moderators.map((moderator) => (
              <option key={moderator.id} value={moderator.id}>
                {moderator.label}
                {moderator.id === viewerId ? ' (you)' : ''}
              </option>
            ))}
          </Select>
        </label>

        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Assign
        </Button>
      </div>

      <Feedback state={state} />
    </form>
  );
}

export function StatusControls({
  caseId,
  currentStatus,
}: {
  caseId: string;
  currentStatus: CaseStatus;
}) {
  const [state, formAction, pending] = useActionState(setCaseStatus, initialModerationState);
  const [status, setStatus] = useState<CaseStatus>(currentStatus);

  const concluding = CONCLUDING_STATUSES.includes(status);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="caseId" value={caseId} />

      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink">Status</span>
        <Select
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value as CaseStatus)}
        >
          {(Object.keys(CASE_STATUS_LABELS) as CaseStatus[]).map((option) => (
            <option key={option} value={option}>
              {CASE_STATUS_LABELS[option]}
            </option>
          ))}
        </Select>
      </label>

      {concluding && (
        <label className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-ink">What was decided?</span>
          <Textarea
            name="outcome"
            required
            minLength={3}
            maxLength={2000}
            rows={3}
            placeholder="The review stands. No evidence of manipulation; the reporter disagrees with it."
          />
          <span className="text-micro text-ink-subtle">
            Somebody reading this case in a year should find the decision, not just that it stopped
            being open.
          </span>
        </label>
      )}

      <div>
        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Update status
        </Button>
      </div>

      <Feedback state={state} />
    </form>
  );
}

export function PriorityControls({
  caseId,
  currentPriority,
  canSetCritical,
}: {
  caseId: string;
  currentPriority: CasePriority;
  canSetCritical: boolean;
}) {
  const [state, formAction, pending] = useActionState(setCasePriority, initialModerationState);

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="caseId" value={caseId} />

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Priority</span>
          <Select name="priority" defaultValue={currentPriority} className="h-9 min-w-40">
            {(Object.keys(CASE_PRIORITY_LABELS) as CasePriority[]).map((option) => (
              <option key={option} value={option}>
                {CASE_PRIORITY_LABELS[option]}
              </option>
            ))}
          </Select>
        </label>

        <Input name="why" maxLength={500} placeholder="Why?" className="h-9 w-52" />

        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Set priority
        </Button>
      </div>

      {!canSetCritical && (
        <p className="text-micro text-ink-subtle">
          Raising a case to critical needs Trust &amp; Safety authorisation.
        </p>
      )}

      <Feedback state={state} />
    </form>
  );
}

export function NoteControls({ caseId }: { caseId: string }) {
  const [state, formAction, pending] = useActionState(addCaseNote, initialModerationState);

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="caseId" value={caseId} />

      <label className="flex flex-col gap-1.5">
        <span className="sr-only">Add an internal note</span>
        <Textarea
          name="body"
          required
          minLength={1}
          maxLength={4000}
          rows={3}
          placeholder="Reviewed the reported content. Location verification exists for this property. No evidence of coordinated manipulation."
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Add note
        </Button>
        <span className="text-micro text-ink-subtle">
          Internal. Never shown to the reviewer, the reporter or the property owner — and not
          editable afterwards, including by you.
        </span>
      </div>

      <Feedback state={state} />
    </form>
  );
}

export function PreservationControls({
  caseId,
  held,
}: {
  caseId: string;
  held: boolean;
}) {
  const [state, formAction, pending] = useActionState(setCasePreservation, initialModerationState);

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="hold" value={held ? 'false' : 'true'} />

      <div className="flex flex-wrap items-end gap-2">
        <Input name="reason" required minLength={3} maxLength={500} placeholder="Why?" className="h-9 w-64" />
        <Button type="submit" variant={held ? 'ghost' : 'secondary'} size="sm" loading={pending}>
          {held ? 'Lift preservation hold' : 'Apply preservation hold'}
        </Button>
      </div>

      <p className="text-micro text-ink-subtle">
        While a hold is on, nothing belonging to this case is eligible for routine deletion.
      </p>

      <Feedback state={state} />
    </form>
  );
}
