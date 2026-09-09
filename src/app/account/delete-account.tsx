'use client';

import { useActionState, useState } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';
import { FormError } from '@/components/ui/field';
import { Card } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { deleteAccount } from '@/server/actions/account';
import {
  initialDeleteAccountState,
  type DeleteAccountState,
} from '@/server/actions/action-state';

/**
 * Deleting a Livd account.
 *
 * Two decisions shape this component, and both are about honesty rather than
 * friction.
 *
 * The consequences are stated *before* the control that triggers them, and the
 * surprising one comes first. People expect deletion to remove everything; on
 * Livd their reviews stay, permanently severed from them, because the property
 * record the next renter relies on is not a record if it can be withdrawn. That
 * is what all three legal pages promise, and burying it under a button would
 * make the promise technically kept and practically hidden.
 *
 * And it asks for a typed word. Not to be obstructive — the action cannot be
 * undone and cannot be traced back afterwards, so a stray click on a red button
 * is not consent to it.
 */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<DeleteAccountState, FormData>(
    deleteAccount,
    initialDeleteAccountState,
  );

  if (state.status === 'deleted') {
    return <Farewell state={state} />;
  }

  return (
    <Card className="border-critical/25 p-5 md:p-6">
      <h2 className="font-display text-title-md tracking-tightish text-ink">
        {copy.account.deleteAccount}
      </h2>
      <p className="mt-2 max-w-prose text-body text-ink-muted">
        {copy.account.deleteAccountBody}
      </p>

      {!open ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => setOpen(true)}
        >
          {copy.account.deleteStart}
        </Button>
      ) : (
        <div className="mt-5 border-t border-border pt-5">
          <h3 className="text-label font-semibold text-ink">
            {copy.account.deleteWhatHappens}
          </h3>

          <dl className="mt-3 flex flex-col gap-3 text-body text-ink-muted">
            <div>
              <dt className="font-medium text-ink">Stays on Livd</dt>
              <dd className="mt-0.5">{copy.account.deleteKept}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink">Deleted</dt>
              <dd className="mt-0.5">{copy.account.deleteRemoved}</dd>
            </div>
          </dl>

          <p className="mt-3 max-w-prose text-label text-ink-subtle">
            {copy.account.deleteWhyKept}
          </p>

          <form action={formAction} className="mt-5 flex flex-col gap-3">
            <label className="flex max-w-xs flex-col gap-1.5">
              <span className="text-label font-medium text-ink">
                {copy.account.deleteConfirmLabel}
              </span>
              <input
                type="text"
                name="confirmation"
                required
                autoComplete="off"
                // A visible, deliberate act. Autocapitalise off so a phone
                // keyboard does not do the typing for them.
                autoCapitalize="off"
                spellCheck={false}
                aria-describedby="delete-irreversible"
                className="h-11 rounded-md border border-border-strong bg-surface px-3 text-body text-ink"
              />
            </label>

            <p id="delete-irreversible" className="text-label font-medium text-critical">
              {copy.account.deleteIrreversible}
            </p>

            {state.error && <FormError message={state.error} />}

            <div className="mt-1 flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="danger"
                loading={pending}
                loadingLabel={copy.account.deleteWorking}
              >
                {copy.account.deleteSubmit}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {copy.account.deleteCancel}
              </Button>
            </div>
          </form>
        </div>
      )}
    </Card>
  );
}

/**
 * What they see once it is done.
 *
 * States the number of reviews left standing rather than a generic success,
 * because that is the fact they were promised and the one they may not have
 * expected. Rendered in place instead of redirecting immediately — throwing a
 * redirect past a summary nobody has read would defeat the point of producing
 * one.
 */
function Farewell({ state }: { state: DeleteAccountState }) {
  const kept = state.summary?.reviewsUnlinked ?? 0;

  return (
    <Card className="p-6 md:p-8" role="status" aria-live="polite">
      <h2 className="font-display text-title-lg tracking-tightish text-ink">
        {copy.account.deletedTitle}
      </h2>
      <p className="mt-3 text-body-lg text-ink-muted">{copy.account.deletedBody}</p>

      <p className="mt-4 text-body text-ink">
        {kept > 0
          ? copy.account.deletedReviewsKept(kept)
          : copy.account.deletedNothingKept}
      </p>

      <ButtonLink href="/" className="mt-6" size="lg">
        {copy.account.deletedDone}
      </ButtonLink>
    </Card>
  );
}
