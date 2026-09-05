'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { copy } from '@/content/copy';
import type { SaveActionState } from '@/server/actions/action-state';
import { toggleSavedProperty } from '@/server/actions/saved';

/**
 * Save to shortlist.
 *
 * A signed-out visitor is sent to sign-in with a return path rather than being
 * shown a disabled control — the whole product is browsable without an account,
 * so the first request for one should explain itself and then bring them back
 * to exactly what they were doing.
 */
export function SaveButton({
  propertyId,
  propertySlug,
  initiallySaved,
  isSignedIn,
  size = 'md',
}: {
  propertyId: string;
  propertySlug: string;
  initiallySaved: boolean;
  isSignedIn: boolean;
  size?: 'sm' | 'md';
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, formAction, pending] = useActionState<SaveActionState, FormData>(
    toggleSavedProperty,
    { saved: initiallySaved, error: null },
  );

  // Announce only real transitions, not the initial render.
  const previousSaved = useRef(initiallySaved);
  useEffect(() => {
    if (state.error) {
      toast.show(state.error, 'critical');
      return;
    }
    if (state.saved !== previousSaved.current) {
      previousSaved.current = state.saved;
      toast.show(state.saved ? copy.shortlist.added : copy.shortlist.removed, 'positive');
    }
  }, [state, toast]);

  if (!isSignedIn) {
    return (
      <Button
        variant="secondary"
        size={size}
        onClick={() => router.push(`/sign-in?next=${encodeURIComponent(`/property/${propertySlug}`)}`)}
      >
        <BookmarkIcon filled={false} />
        {copy.property.save}
      </Button>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <Button
        type="submit"
        variant={state.saved ? 'quiet' : 'secondary'}
        size={size}
        loading={pending}
        aria-pressed={state.saved}
      >
        <BookmarkIcon filled={state.saved} />
        {state.saved ? copy.property.saved : copy.property.save}
      </Button>
    </form>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
    >
      <path
        d="M4 2.75h8a.75.75 0 0 1 .75.75v9.9a.4.4 0 0 1-.62.33L8 11.2l-4.13 2.53a.4.4 0 0 1-.62-.33V3.5A.75.75 0 0 1 4 2.75Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
