'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/field';
import { copy } from '@/content/copy';
import { startGoogleSignIn } from '@/server/actions/auth';
import { initialAuthState } from '@/server/actions/action-state';

/**
 * Continue with Google.
 *
 * Deliberately not `useActionState` with a form action. The server action sets
 * the PKCE verifier cookie and hands back a URL; the browser has to *commit*
 * that cookie before it leaves for Google, and a redirect thrown from inside
 * the action does not reliably let it. Navigating from the client, after the
 * response has landed and the cookie is written, is what makes the exchange at
 * `/auth/callback` work — the same exchange the magic-link flow keeps failing.
 *
 * `window.location.assign` rather than the router: Google is a different
 * origin, and Next's client router has no business trying to handle it.
 */
export function GoogleButton({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(): Promise<void> {
    setError(null);
    setPending(true);

    try {
      const formData = new FormData();
      formData.set('next', next);

      const result = await startGoogleSignIn(initialAuthState, formData);

      if (result.redirectTo) {
        window.location.assign(result.redirectTo);
        // Left pending on purpose. The page is on its way out, and returning
        // the button to its resting state first makes it look as though
        // nothing happened.
        return;
      }

      setError(result.error ?? copy.auth.googleFailed);
      setPending(false);
    } catch {
      setError(copy.auth.googleFailed);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        onClick={start}
        loading={pending}
        loadingLabel={copy.auth.googleWorking}
      >
        <GoogleMark />
        {copy.auth.continueWithGoogle}
      </Button>

      {error && <FormError message={error} />}
    </div>
  );
}

/**
 * Google's mark, inline.
 *
 * Inline because the content security policy allows images from `self` only,
 * and because a sign-in button that waits on a network round trip to render its
 * icon is a sign-in button that flickers.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-[1.125rem]" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
