'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/field';
import { copy } from '@/content/copy';
import { initialAuthState } from '@/server/actions/action-state';
import { requestSignIn } from '@/server/actions/auth';
import { GoogleButton } from './google-button';

export function SignInForm({
  next,
  isLocalAdapter,
}: {
  next: string;
  isLocalAdapter: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    requestSignIn,
    initialAuthState,
  );

  if (state.sentTo) {
    return (
      <div className="mt-8 rounded-lg border border-positive/25 bg-positive-soft p-6">
        <h2 className="font-display text-title-md tracking-tightish text-positive">
          {copy.auth.linkSentTitle}
        </h2>
        <p className="mt-2 text-body text-ink-muted">
          {copy.auth.linkSentBody(state.sentTo)}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      {/* Google first. Nothing is emailed on this path, so nothing can be
          consumed by a mail scanner before the person gets to it — which is
          currently the difference between signing in and not. */}
      {!isLocalAdapter && (
        <>
          <GoogleButton next={next} />

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            <span className="text-label text-ink-subtle">{copy.auth.or}</span>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
        </>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />

        <FormError message={state.error} />

        <Field label={copy.auth.email}>
          {(props) => (
            <Input
              {...props}
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
            />
          )}
        </Field>

        <Button
          type="submit"
          size="lg"
          loading={pending}
          loadingLabel={copy.auth.sending}
          fullWidth
        >
          {isLocalAdapter ? "Continue" : copy.auth.sendLink}
        </Button>

        {isLocalAdapter && (
          <p className="rounded-md border border-caution/25 bg-caution-soft px-3.5 py-3 text-label text-caution">
            {copy.auth.devNotice}
          </p>
        )}
      </form>
    </div>
  );
}
