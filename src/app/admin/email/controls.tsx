'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { FormError, Select } from '@/components/ui/field';
import { Badge, Card } from '@/components/ui/primitives';
import { initialEmailDeliveryTestState } from '@/server/actions/action-state';
import { runEmailDeliveryTest } from '@/server/actions/email';

/**
 * The delivery check's form and its results.
 *
 * The recipient is shown and not editable, because it is not an input: the
 * action sends to the signed-in account and ignores anything else. Showing it
 * is so that nobody presses the button expecting the mail to go elsewhere.
 *
 * Results are per message. "Twelve sent" is not what anybody needs after a
 * provider change; "eleven sent and the staff escalation was refused, here is
 * why" is.
 */

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Every message (12)' },
  { value: 'review_published', label: 'Reviewer — review published' },
  { value: 'review_held', label: 'Reviewer — review held for checking' },
  { value: 'review_removed', label: 'Reviewer — review removed' },
  { value: 'review_restored', label: 'Reviewer — review restored' },
  { value: 'owner_responded', label: 'Reviewer — property responded' },
  { value: 'claim_approved', label: 'Owner — claim approved' },
  { value: 'claim_rejected', label: 'Owner — claim not approved' },
  { value: 'owner_new_review', label: 'Owner — new review of their property' },
  { value: 'staff_report_opened', label: 'Staff — review reported' },
  { value: 'staff_case_opened', label: 'Staff — case opened' },
  { value: 'staff_authority_request', label: 'Staff — authority request' },
  { value: 'staff_claim_submitted', label: 'Staff — property claim waiting' },
];

export function DeliveryTestControls({ recipient }: { recipient: string }) {
  const [state, formAction, pending] = useActionState(
    runEmailDeliveryTest,
    initialEmailDeliveryTestState,
  );

  const report = state.report;
  const sent = report?.results.filter((result) => result.ok).length ?? 0;
  const failed = report ? report.results.length - sent : 0;

  return (
    <Card className="flex flex-col gap-5 p-5">
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="delivery-kind" className="text-label font-medium text-ink">
            What to send
          </label>
          <Select id="delivery-kind" name="kind" defaultValue="all" disabled={pending}>
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <p className="max-w-prose text-label text-ink-muted">
          Sent to <span className="font-mono text-ink">{recipient}</span>, and only to you. Subjects
          start with <span className="font-mono">[Test]</span>; everything else is exactly what a
          real notification carries. Nothing is written to the notification record, and the run is
          recorded in the audit trail. Three runs an hour.
        </p>

        <FormError message={state.error} />

        <div>
          <Button type="submit" loading={pending} loadingLabel="Sending…">
            Send the delivery check
          </Button>
        </div>
      </form>

      {report ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-label text-ink">
            {report.providerConfigured
              ? `${sent} accepted by Resend${failed ? `, ${failed} refused` : ''}. Accepted is not delivered — check the inbox, and the headers of what arrives.`
              : 'Nothing left the server: this deployment has no RESEND_API_KEY, so each message was logged instead.'}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-label">
              <thead className="text-ink-subtle">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Subject
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Result
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Provider reference
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((result) => (
                  <tr key={result.kind} className="border-t border-border align-top">
                    <td className="py-2 pr-4 text-ink">{result.subject}</td>
                    <td className="py-2 pr-4">
                      {result.ok ? (
                        <Badge tone={result.provider === 'resend' ? 'positive' : 'neutral'}>
                          {result.provider === 'resend' ? 'Accepted' : 'Logged only'}
                        </Badge>
                      ) : (
                        <span className="flex flex-col gap-1">
                          <Badge tone="critical">Refused</Badge>
                          <span className="break-words text-ink-muted">{result.error}</span>
                        </span>
                      )}
                    </td>
                    <td className="break-all py-2 font-mono text-ink-subtle">{result.id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
