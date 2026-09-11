'use client';

import { useActionState, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import type { NotificationPreferences } from '@/server/data/repository';
import { initialPreferencesState } from '@/server/actions/action-state';
import { saveNotificationPreferences } from '@/server/actions/notifications';

/**
 * Three switches.
 *
 * A plain form with a save button rather than toggles that persist on change.
 * An auto-saving switch is the right pattern when the state is obvious and
 * the cost of a mistake is nil; here the reader is deciding what a platform
 * may tell them about their own writing, and a deliberate save is worth the
 * extra press.
 *
 * Each one names what it actually sends, not a category. "Review updates" is
 * a label; "when a review you wrote is published, held, removed or restored"
 * is a decision somebody can make.
 */
export function PreferencesForm({ preferences }: { preferences: NotificationPreferences }) {
  const [state, formAction, pending] = useActionState(
    saveNotificationPreferences,
    initialPreferencesState,
  );
  const toast = useToast();

  useEffect(() => {
    if (state.status !== 'saved') return;
    toast.show('Your email preferences are saved.', 'positive');
  }, [state.status, toast]);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      <FormError message={state.error} />

      <Switch
        name="reviewUpdates"
        defaultChecked={preferences.reviewUpdates}
        label="Your reviews"
        description="When a review you wrote is published, or when it is being read by a moderator before it goes up."
      />

      <Switch
        name="propertyResponses"
        defaultChecked={preferences.propertyResponses}
        label="Replies from a property"
        description="When the property you reviewed posts a public response. If you have claimed a property, also when a new resident review is published on it."
      />

      <Switch
        name="trustSafety"
        defaultChecked={preferences.trustSafety}
        label="Your account and claims"
        description="Decisions about a property claim you have made, and anything affecting your account's standing."
      />

      <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-border pt-6">
        <Button type="submit" loading={pending}>
          Save preferences
        </Button>
        <p className="text-label text-ink-subtle">Sign-in links are always sent.</p>
      </div>
    </form>
  );
}

function Switch({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3.5 rounded-lg border border-border bg-surface p-4 transition-colors duration-fast hover:bg-surface-sunken/40 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 accent-brand"
      />
      <span className="min-w-0">
        <span className="block text-body font-medium text-ink">{label}</span>
        <span className="mt-1 block text-label text-ink-muted">{description}</span>
      </span>
    </label>
  );
}
