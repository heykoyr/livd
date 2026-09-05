'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { RadioCardGroup } from '@/components/ui/choice';
import { Field, FormError, Input } from '@/components/ui/field';
import { Card } from '@/components/ui/primitives';
import { initialClaimState } from '@/server/actions/action-state';
import { submitClaim } from '@/server/actions/claims';
import { useState } from 'react';

export function ClaimForm({ propertyId }: { propertyId: string }) {
  const [role, setRole] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(submitClaim, initialClaimState);

  if (state.status === 'submitted') {
    return (
      <Card className="mt-8 border-positive/30 bg-positive-soft p-6">
        <h2 className="font-display text-title-md tracking-tightish text-positive">
          Claim submitted
        </h2>
        <p className="mt-2 text-body text-ink-muted">
          A moderator will review it and contact you at the address you gave. We verify claims
          before approving them, so this is not instant.
        </p>
      </Card>
    );
  }

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-6">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="roleClaimed" value={role ?? ''} />

      <FormError message={state.error} />

      <RadioCardGroup
        name="role-choice"
        legend="Your relationship to this property"
        options={[
          { value: 'owner', label: 'Owner', description: 'You own the property' },
          { value: 'manager', label: 'Property manager', description: 'You manage it day to day' },
          { value: 'agent', label: 'Letting agent', description: 'You let it on the owner’s behalf' },
        ]}
        value={role}
        onChange={setRole}
      />

      <Field
        label="Organisation"
        hint="If you are claiming on behalf of a company."
        error={state.fieldErrors.organisation}
        optional
      >
        {(props) => <Input {...props} name="organisation" maxLength={160} />}
      </Field>

      <Field
        label="Contact email"
        hint="We use this to verify the claim. It is never shown publicly."
        error={state.fieldErrors.contactEmail}
      >
        {(props) => <Input {...props} name="contactEmail" type="email" required maxLength={320} />}
      </Field>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <Button type="submit" size="lg" loading={pending} disabled={role === null}>
          Submit claim
        </Button>
        <p className="text-label text-ink-subtle">
          Claims are verified before approval.
        </p>
      </div>
    </form>
  );
}
