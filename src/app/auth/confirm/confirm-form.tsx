'use client';

import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { copy } from '@/content/copy';

/**
 * The one tap that redeems a sign-in link.
 *
 * A plain form POST to `/auth/verify` rather than a Server Action, so it works
 * with JavaScript switched off and the session cookies arrive on an ordinary
 * redirect response — nothing depends on a client router committing them.
 *
 * The only script here stops a double tap from sending the token twice: the
 * second request would find it spent and bounce the person to "already used"
 * while the first was signing them in.
 */
export function ConfirmSignInForm({
  tokenHash,
  type,
  next,
}: {
  tokenHash: string;
  type: string;
  next: string;
}) {
  const submitted = useRef(false);
  const [pending, setPending] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    if (submitted.current) {
      event.preventDefault();
      return;
    }
    submitted.current = true;
    setPending(true);
  }

  return (
    <form method="post" action="/auth/verify" onSubmit={onSubmit} className="mt-8">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="next" value={next} />

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={pending}
        loadingLabel={copy.auth.confirmWorking}
      >
        {copy.auth.confirmButton}
      </Button>
    </form>
  );
}
