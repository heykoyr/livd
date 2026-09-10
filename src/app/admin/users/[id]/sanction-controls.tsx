'use client';

import { useActionState, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError, Input, Select, Textarea } from '@/components/ui/field';
import { initialModerationState } from '@/server/actions/action-state';
import { applySanction, liftSanction } from '@/server/actions/sanctions';
import type { SanctionAction, SanctionReason } from '@/types/domain';

/**
 * Sanction controls.
 *
 * A confirmation step, and one that says what will actually happen rather than
 * "are you sure?". Somebody about to suspend an account for a week should read
 * that sentence before the button, not discover it afterwards — and the
 * sentence changes with the choice, because a restriction, a suspension and a
 * ban are three different things.
 *
 * Nothing here decides anything. `livd_apply_sanction` refuses what this
 * refuses, plus the caller's tier, so a control shown by mistake is a bad
 * experience rather than a hole.
 */

const ACTION_LABELS: Record<SanctionAction, string> = {
  restricted: 'Restrict',
  suspended: 'Suspend',
  banned: 'Ban',
};

/** What the person on the receiving end will experience. Shown before the act. */
function consequence(action: SanctionAction, days: number | null): string {
  if (action === 'restricted') {
    return days
      ? `Some features are limited for ${days} day${days === 1 ? '' : 's'}. Their published reviews stay exactly where they are.`
      : 'Some features are limited until this is lifted. Their published reviews stay exactly where they are.';
  }

  if (action === 'suspended') {
    return days
      ? `They cannot sign in or contribute for ${days} day${days === 1 ? '' : 's'}, then the account returns by itself. Their published reviews stay exactly where they are.`
      : 'They cannot sign in or contribute until this is lifted. Their published reviews stay exactly where they are.';
  }

  return 'The account is permanently prevented from contributing. Their published reviews stay on the property records, as the legal pages promise. A ban has no end date.';
}

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

export function ApplySanctionControls({
  userId,
  reasons,
  canSuspend,
  canBan,
  caseOptions,
}: {
  userId: string;
  reasons: SanctionReason[];
  canSuspend: boolean;
  canBan: boolean;
  caseOptions: Array<{ id: string; reference: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<SanctionAction>('restricted');
  const [days, setDays] = useState('7');
  const [reasonKey, setReasonKey] = useState(reasons[0]?.key ?? '');
  const [state, formAction, pending] = useActionState(applySanction, initialModerationState);

  const formId = useId();
  const selected = reasons.find((reason) => reason.key === reasonKey);
  const durationDays = action === 'banned' ? null : Number(days) || null;

  const available: SanctionAction[] = [
    'restricted',
    ...(canSuspend ? (['suspended'] as const) : []),
    ...(canBan ? (['banned'] as const) : []),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Sanction this account
        </Button>
        {!canSuspend && (
          <p className="text-micro text-ink-subtle">
            Suspending needs Trust &amp; Safety; banning needs an administrator.
          </p>
        )}
      </div>

      {state.error && (
        <div className="mt-3">
          <FormError message={state.error} />
        </div>
      )}
      {state.message && (
        <p role="status" className="mt-3 text-label text-positive">
          {state.message}
        </p>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${ACTION_LABELS[action]} this account?`}
        description="Recorded permanently, with your name and your reason."
        size="md"
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              variant={action === 'restricted' ? 'secondary' : 'danger'}
              size="sm"
              loading={pending}
            >
              Confirm {ACTION_LABELS[action].toLowerCase()}
            </Button>
          </>
        }
      >
        <form id={formId} action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="userId" value={userId} />
          <input
            type="hidden"
            name="durationDays"
            value={durationDays === null ? '' : String(durationDays)}
          />

          <label className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-ink">Sanction</span>
            <Select
              name="action"
              value={action}
              onChange={(event) => setAction(event.target.value as SanctionAction)}
            >
              {available.map((option) => (
                <option key={option} value={option}>
                  {ACTION_LABELS[option]}
                </option>
              ))}
            </Select>
          </label>

          {/* What actually happens, before the button rather than after it. */}
          <div className="rounded-md border-l-2 border-caution bg-caution-soft/50 p-3.5 text-label text-ink">
            {consequence(action, durationDays)}
          </div>

          {action !== 'banned' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-label font-medium text-ink">
                Duration
                <span className="ml-1.5 font-normal text-ink-subtle">In days</span>
              </span>
              <Input
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(event) => setDays(event.target.value)}
                placeholder="7"
              />
              <span className="text-micro text-ink-subtle">
                Leave empty for no fixed end date. A timed sanction lifts itself.
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-ink">Category</span>
            <Select
              name="reasonKey"
              value={reasonKey}
              onChange={(event) => setReasonKey(event.target.value)}
              required
            >
              {reasons.map((reason) => (
                <option key={reason.key} value={reason.key}>
                  {reason.label}
                </option>
              ))}
            </Select>
            {selected && <span className="text-micro text-ink-subtle">{selected.description}</span>}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-ink">What happened?</span>
            <Textarea
              name="reason"
              rows={3}
              required
              minLength={3}
              maxLength={1000}
              placeholder="Four reviews of unrelated properties in two days, all five stars, near-identical wording."
            />
            <span className="text-micro text-ink-subtle">
              A category alone explains nothing. Write what a colleague reading this in six months
              would need.
            </span>
          </label>

          {caseOptions.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-label font-medium text-ink">
                Related case
                <span className="ml-1.5 font-normal text-ink-subtle">Optional</span>
              </span>
              <Select name="caseId" defaultValue="">
                <option value="">None</option>
                {caseOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.reference}
                  </option>
                ))}
              </Select>
            </label>
          )}

          <p className="text-micro text-ink-subtle">
            This does nothing to what the account wrote. Removing a review is a separate decision,
            with its own reason.
          </p>
        </form>
      </Dialog>
    </div>
  );
}

export function LiftSanctionControls({ sanctionId }: { sanctionId: string }) {
  const [state, formAction, pending] = useActionState(liftSanction, initialModerationState);

  return (
    <form action={formAction} className="mt-2.5 flex flex-col gap-2">
      <input type="hidden" name="sanctionId" value={sanctionId} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`lift-${sanctionId}`}>
          Reason for lifting this sanction
        </label>
        <Input
          id={`lift-${sanctionId}`}
          name="reason"
          required
          minLength={3}
          maxLength={500}
          placeholder="Why lift this?"
          className="h-9 w-64"
        />
        <Button type="submit" variant="ghost" size="sm" loading={pending}>
          Lift early
        </Button>
      </div>

      <Feedback state={state} />
    </form>
  );
}
