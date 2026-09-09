'use client';

import { useActionState, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError, Input, Select, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/primitives';
import { revealAccountIdentity } from '@/server/actions/identity';
import { initialIdentityRevealState } from '@/server/actions/action-state';
import type { IdentityAccessReason } from '@/server/data';

/**
 * Revealing an account identity.
 *
 * Three deliberate pieces of friction, in this order: a warning that says
 * plainly what is about to happen and that it will be recorded; a reason that
 * cannot be skipped and, for some categories, cannot be a single word; and a
 * confirmation that is a separate press from opening the dialog.
 *
 * None of it is security — `livd_reveal_user_identity` is, and it refuses
 * everything this form refuses, plus the caller's role. This is here because
 * somebody about to look at a stranger's identity should have to stop and say
 * why, and because being told the access is recorded is what actually changes
 * behaviour. A control that logs silently deters nobody, because nobody
 * believes in a log they have never been shown.
 *
 * The address, once revealed, lives in this component's state and nowhere else.
 * It is never server-rendered into the page and never cached.
 */
export function RevealIdentity({
  userId,
  maskedEmail,
  reasons,
}: {
  userId: string;
  maskedEmail: string;
  reasons: IdentityAccessReason[];
}) {
  const [open, setOpen] = useState(false);
  const [reasonKey, setReasonKey] = useState(reasons[0]?.key ?? '');
  const [state, formAction, pending] = useActionState(
    revealAccountIdentity,
    initialIdentityRevealState,
  );

  const formId = useId();
  const selected = reasons.find((reason) => reason.key === reasonKey);

  if (state.status === 'revealed' && state.email) {
    return (
      <div className="rounded-lg border border-caution/40 bg-caution-soft/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="caution">Identity revealed</Badge>
          <span className="text-label text-ink-muted">This access has been recorded.</span>
        </div>

        <dl className="mt-4">
          <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            Email
          </dt>
          <dd className="mt-1 break-all font-mono text-body text-ink">{state.email}</dd>
        </dl>

        <p className="mt-4 text-micro text-ink-subtle">
          Audit entry {state.auditEntryId}. This is on the page only while it stays open — it is
          not saved anywhere, and reloading hides it again.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface-sunken/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="caution">Restricted</Badge>
        <span className="font-mono text-label text-ink">{maskedEmail}</span>
      </div>

      <p className="mt-3 max-w-prose text-label text-ink-muted">
        This information is private and should only be accessed for legitimate Trust &amp; Safety,
        security, legal or regulatory purposes. Your access will be recorded in the audit log with
        your name, the reason you give, and the account you looked at.
      </p>

      <div className="mt-4">
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Reveal account information
        </Button>
      </div>

      {state.error && (
        <div className="mt-3">
          <FormError message={state.error} />
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Reveal account information?"
        description="This is recorded permanently and cannot be undone or deleted."
        size="md"
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="danger" size="sm" loading={pending}>
              Confirm and reveal
            </Button>
          </>
        }
      >
        <form id={formId} action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="userId" value={userId} />

          <div className="rounded-md border-l-2 border-caution bg-caution-soft/50 p-3.5 text-label text-ink">
            An audit entry naming you is written in the same transaction that reads the address.
            There is no way to see it without leaving a record.
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-ink">Reason for this access</span>
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
            <span className="text-label font-medium text-ink">
              What is this about?
              {selected?.requiresDetail ? (
                <span className="ml-1.5 font-normal text-critical">Required</span>
              ) : (
                <span className="ml-1.5 font-normal text-ink-subtle">Optional</span>
              )}
            </span>
            <Textarea
              name="reasonDetail"
              rows={3}
              required={selected?.requiresDetail}
              minLength={selected?.requiresDetail ? 10 : undefined}
              maxLength={1000}
              placeholder="A sentence a colleague reading this in six months would understand."
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-ink">
              Case reference
              <span className="ml-1.5 font-normal text-ink-subtle">Optional</span>
            </span>
            <Input name="caseReference" maxLength={64} placeholder="LV-1048" />
          </label>
        </form>
      </Dialog>
    </div>
  );
}
