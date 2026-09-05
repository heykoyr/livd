'use client';

import { useActionState, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, Textarea } from '@/components/ui/field';
import { RadioCardGroup } from '@/components/ui/choice';
import { useToast } from '@/components/ui/toast';
import { copy } from '@/content/copy';
import { initialReportState } from '@/server/actions/action-state';
import { submitReport } from '@/server/actions/reports';

const REASON_OPTIONS = (
  Object.entries(copy.safety.reportReasons) as Array<
    [keyof typeof copy.safety.reportReasons, string]
  >
).map(([value, label]) => ({ value, label }));

/**
 * Report a review.
 *
 * A quiet text link rather than a button: reporting should be available without
 * being suggested. A prominent "Report" control next to every review invites
 * use as a disagreement button, which is exactly what a moderation queue does
 * not need.
 */
export function ReportReviewButton({ reviewId }: { reviewId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(submitReport, initialReportState);
  const toast = useToast();

  useEffect(() => {
    if (state.status !== 'success') return;
    setOpen(false);
    setReason(null);
    toast.show(copy.safety.reportSuccessTitle, 'positive');
  }, [state.status, toast]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm text-micro text-ink-subtle underline underline-offset-2 transition-colors duration-fast hover:text-ink"
      >
        Report
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={copy.safety.reportTitle}
        description={copy.safety.reportLead}
        size="md"
      >
        <form action={formAction} className="flex flex-col gap-6 py-2">
          <input type="hidden" name="reviewId" value={reviewId} />
          {/* The radio group is controlled, so its value is mirrored for submit. */}
          <input type="hidden" name="reason" value={reason ?? ''} />

          <FormError message={state.error} />

          <RadioCardGroup
            name="reason-choice"
            legend={copy.safety.reportReason}
            options={REASON_OPTIONS}
            value={reason}
            onChange={setReason}
          />

          <Field label={copy.safety.reportDetail} hint={copy.safety.reportDetailHint} optional>
            {(props) => (
              <Textarea
                {...props}
                name="detail"
                maxLength={1000}
                rows={4}
                placeholder="What should a moderator look at?"
              />
            )}
          </Field>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {copy.common.cancel}
            </Button>
            <Button
              type="submit"
              variant="danger"
              loading={pending}
              disabled={reason === null}
            >
              {copy.safety.reportSubmit}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
