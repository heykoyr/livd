'use client';

import { useActionState, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CharacterCount, Field, FormError, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { initialOwnerResponseState } from '@/server/actions/action-state';
import { submitOwnerResponse } from '@/server/actions/claims';

const MIN = 20;
const MAX = 2000;

/**
 * The property's right of reply.
 *
 * The control the whole claim system exists to grant, and until now it had no
 * button anywhere in the product. A claimant who had been through
 * verification and approval arrived at their own property page to find
 * exactly what a stranger sees.
 *
 * It is rendered only for the approved claimant of this property, decided on
 * the server. That is a matter of not showing somebody a control they cannot
 * use — it is not the security boundary, which is `owner_responses_insert`
 * plus the check in the action, and both hold if this component is called
 * from a console.
 *
 * One reply per review, so the button disappears once a response exists. The
 * alternative — an edit window — would mean a response could change after a
 * resident had read it and after Livd had emailed them about it, and a right
 * of reply that is rewritable is a different thing from a right of reply.
 */
export function RespondToReviewButton({
  reviewId,
  propertyName,
}: {
  reviewId: string;
  propertyName: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [state, formAction, pending] = useActionState(
    submitOwnerResponse,
    initialOwnerResponseState,
  );
  const toast = useToast();

  useEffect(() => {
    if (state.status !== 'published') return;
    setOpen(false);
    setBody('');
    toast.show('Your response is now on the property page.', 'positive');
  }, [state.status, toast]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm text-micro font-medium text-brand underline underline-offset-2 transition-colors duration-fast hover:text-brand-hover"
      >
        Respond as the property
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Respond to this review"
        description={`Your reply appears publicly under this review of ${propertyName}, labelled as a response from the property. You can reply once.`}
        size="md"
      >
        <form action={formAction} className="flex flex-col gap-5 py-2">
          <input type="hidden" name="reviewId" value={reviewId} />

          <FormError message={state.error} />

          <Field
            label="Your response"
            hint="Address what the resident raised. Naming them, or anyone else, is not permitted and will be refused."
          >
            {(props) => (
              <>
                <Textarea
                  {...props}
                  name="body"
                  rows={7}
                  minLength={MIN}
                  maxLength={MAX}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="What has changed, what is being done, or what the resident may not have known."
                />
                <CharacterCount used={body.trim().length} max={MAX} />
              </>
            )}
          </Field>

          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface-sunken/50 p-3.5">
            <input
              type="checkbox"
              name="isResolutionNotice"
              className="mt-0.5 size-4 shrink-0 accent-brand"
            />
            <span>
              <span className="block text-label font-medium text-ink">
                This issue has been resolved
              </span>
              <span className="mt-0.5 block text-micro text-ink-muted">
                Adds a &ldquo;resolved&rdquo; marker to your response. It does not change the
                review, its rating, or the property&rsquo;s score.
              </span>
            </span>
          </label>

          <p className="text-micro text-ink-subtle">
            Residents write to Livd anonymously. You will not be told who wrote this review, and
            responding does not let you edit, hide or remove it.
          </p>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={body.trim().length < MIN}>
              Publish response
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
