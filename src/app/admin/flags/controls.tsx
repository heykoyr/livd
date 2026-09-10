'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { FormError, Input } from '@/components/ui/field';
import { initialModerationState } from '@/server/actions/action-state';
import { decideSignal, openCaseFromSignal } from '@/server/actions/signals';

/**
 * Signal controls.
 *
 * Three answers rather than two. "Looked at it" and "nothing wrong here" were
 * the whole vocabulary until Phase 12, and both are verdicts on the *signal* —
 * which left no way to say the thing an unexplained pattern most often
 * warrants: this needs looking into.
 *
 * None of these touches a review, a score or an account. The copy says so on
 * every one of them, because the moment somebody believes dismissing a signal
 * has quietly cleared the reviews behind it is the moment the queue stops
 * meaning anything.
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

/** Opens a case from a signal — the answer that is neither yes nor no. */
export function InvestigateControls({
  signalKind,
  signalId,
}: {
  signalKind: 'property' | 'account';
  signalId: string;
}) {
  const [state, formAction, pending] = useActionState(
    openCaseFromSignal,
    initialModerationState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="signalKind" value={signalKind} />
      <input type="hidden" name="signalId" value={signalId} />

      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink">What do you want looked into?</span>
        <Input
          name="why"
          required
          minLength={3}
          maxLength={500}
          placeholder="What about this does not add up?"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Open a case
        </Button>
        <span className="text-micro text-ink-subtle">
          The numbers above go onto the case timeline. Nothing else changes.
        </span>
      </div>

      <Feedback state={state} />
    </form>
  );
}

/** Decides an account signal. Changes the signal and nothing else. */
export function AccountSignalControls({ signalId }: { signalId: string }) {
  const [state, formAction, pending] = useActionState(decideSignal, initialModerationState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="signalId" value={signalId} />

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="status"
          value="reviewed"
          variant="secondary"
          size="sm"
          loading={pending}
        >
          Looked at it
        </Button>
        <Button
          type="submit"
          name="status"
          value="dismissed"
          variant="ghost"
          size="sm"
          loading={pending}
        >
          Nothing wrong here
        </Button>
      </div>

      <p className="text-micro text-ink-subtle">
        Deciding a signal does not restrict the account, hide their reviews or change their
        standing. Each of those is a separate decision and needs its own reason.
      </p>

      <Feedback state={state} />
    </form>
  );
}
