'use client';

import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormError, Input, Select, Textarea } from '@/components/ui/field';
import { initialModerationState } from '@/server/actions/action-state';
import {
  decideAuthorityRequest,
  openAuthorityRequest,
  recordDisclosure,
} from '@/server/actions/authority';
import type { AuthorityRequestStatus } from '@/types/domain';
import { AUTHORITY_STATUS_LABELS, CONCLUDING_AUTHORITY_STATUSES } from './labels';

/**
 * Authority request controls.
 *
 * These record. None of them discloses anything, and the copy says so at each
 * step — because the one dangerous misunderstanding in this whole area is
 * somebody believing a button here sends data to the requester. It does not,
 * and there is no button anywhere in Livd that does.
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

export function RecordRequestControls() {
  const [state, formAction, pending] = useActionState(
    openAuthorityRequest,
    initialModerationState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 md:flex-row">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-label font-medium text-ink">Requesting authority</span>
          <Input
            name="requestingAuthority"
            required
            minLength={2}
            maxLength={200}
            placeholder="Metropolitan Police"
          />
        </label>

        <label className="flex flex-col gap-1.5 md:w-56">
          <span className="text-label font-medium text-ink">Jurisdiction</span>
          <Input
            name="jurisdiction"
            required
            minLength={2}
            maxLength={120}
            placeholder="England and Wales"
          />
        </label>
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        <label className="flex flex-col gap-1.5 md:w-64">
          <span className="text-label font-medium text-ink">Type</span>
          <Select name="requestType" defaultValue="account_information">
            <option value="account_information">Account information</option>
            <option value="content_preservation">Content preservation</option>
            <option value="content_removal">Content removal</option>
            <option value="emergency_disclosure">Emergency disclosure</option>
            <option value="other">Other</option>
          </Select>
        </label>

        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-label font-medium text-ink">
            Their reference
            <span className="ml-1.5 font-normal text-ink-subtle">Optional</span>
          </span>
          <Input name="externalReference" maxLength={120} placeholder="MPS/2026/00412" />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink">What was asked for</span>
        <Textarea
          name="requestedInformation"
          rows={3}
          required
          minLength={3}
          maxLength={4000}
          placeholder="In their words, rather than a summary of them."
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink">
          Legal basis asserted
          <span className="ml-1.5 font-normal text-ink-subtle">Optional</span>
        </span>
        <Textarea
          name="legalBasis"
          rows={2}
          maxLength={2000}
          placeholder="Data Protection Act 2018, Schedule 2 Part 1"
        />
        <span className="text-micro text-ink-subtle">
          What they claim, recorded as a claim. Whether it holds is the decision, not this field.
        </span>
      </label>

      <label className="flex items-center gap-2.5 text-label text-ink">
        <input type="checkbox" name="documentationReceived" className="size-4" />
        We hold the paperwork, not just an assertion in an email
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Record this request
        </Button>
        <span className="text-micro text-ink-subtle">
          Recording is not disclosing. Nothing is sent to anybody by this form or any other.
        </span>
      </div>

      <Feedback state={state} />
    </form>
  );
}

export function DecideRequestControls({
  requestId,
  currentStatus,
}: {
  requestId: string;
  currentStatus: AuthorityRequestStatus;
}) {
  const [state, formAction, pending] = useActionState(
    decideAuthorityRequest,
    initialModerationState,
  );
  const [status, setStatus] = useState<AuthorityRequestStatus>(currentStatus);

  const concluding = CONCLUDING_AUTHORITY_STATUSES.includes(status);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="requestId" value={requestId} />

      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink">Status</span>
        <Select
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value as AuthorityRequestStatus)}
        >
          {(Object.keys(AUTHORITY_STATUS_LABELS) as AuthorityRequestStatus[]).map((option) => (
            <option key={option} value={option}>
              {AUTHORITY_STATUS_LABELS[option]}
            </option>
          ))}
        </Select>
      </label>

      {concluding && (
        <label className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-ink">The decision, and why</span>
          <Textarea
            name="decision"
            rows={3}
            required
            minLength={3}
            maxLength={4000}
            placeholder="Registration date only. The request for review content had no basis under the cited schedule."
          />
          <span className="text-micro text-ink-subtle">
            &ldquo;Declined&rdquo; with no reasoning is exactly the record somebody will be asked
            about later.
          </span>
        </label>
      )}

      <div>
        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Update
        </Button>
      </div>

      <Feedback state={state} />
    </form>
  );
}

export function RecordDisclosureControls({ requestId }: { requestId: string }) {
  const [state, formAction, pending] = useActionState(recordDisclosure, initialModerationState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="requestId" value={requestId} />

      <div className="rounded-md border-l-2 border-caution bg-caution-soft/50 p-3.5 text-label text-ink">
        This records that <em>you</em> disclosed something. It does not gather or send anything —
        no part of Livd does. Name exactly what left.
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink">Fields disclosed</span>
        <Input
          name="disclosedFields"
          required
          maxLength={500}
          placeholder="account_created_at, country_code"
        />
        <span className="text-micro text-ink-subtle">
          One field at a time, comma separated. There is no &ldquo;all account data&rdquo; option.
        </span>
      </label>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-label font-medium text-ink">Who received it</span>
          <Input
            name="disclosedTo"
            required
            minLength={2}
            maxLength={200}
            placeholder="DC Smith, MPS"
          />
        </label>

        <label className="flex flex-col gap-1.5 sm:w-48">
          <span className="text-label font-medium text-ink">How</span>
          <Select name="method" defaultValue="secure_email">
            <option value="secure_email">Secure email</option>
            <option value="portal">Portal</option>
            <option value="post">Post</option>
            <option value="in_person">In person</option>
            <option value="other">Other</option>
          </Select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-ink">
          Notes
          <span className="ml-1.5 font-normal text-ink-subtle">Optional</span>
        </span>
        <Textarea name="notes" rows={2} maxLength={2000} />
      </label>

      <div>
        <Button type="submit" variant="danger" size="sm" loading={pending}>
          Record this disclosure
        </Button>
      </div>

      <Feedback state={state} />
    </form>
  );
}
