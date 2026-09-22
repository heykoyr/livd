'use client';

import { useActionState, useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/field';
import { copy } from '@/content/copy';
import {
  initialAuthState,
  initialSignInCodeState,
  type AuthActionState,
} from '@/server/actions/action-state';
import { requestSignIn, verifySignInCode } from '@/server/actions/auth';
import { GoogleButton } from './google-button';

export function SignInForm({
  next,
  isLocalAdapter,
  googleEnabled,
  linkLifetimeMinutes,
}: {
  next: string;
  isLocalAdapter: boolean;
  /**
   * Whether Google sign-in is actually configured — an OAuth client in Google
   * Cloud and a matching secret in Supabase. Livd cannot see either, and a
   * sign-in button that leads to an error page is worse than no button: it is
   * the control a new visitor is most likely to press first.
   */
  googleEnabled: boolean;
  linkLifetimeMinutes: number;
}) {
  const [state, formAction, pending] = useActionState(requestSignIn, initialAuthState);

  // "Use a different email" returns to the form without forgetting that a
  // link was sent. It holds for the response it was chosen on, so the next
  // request's result ends it without an effect having to.
  const [editingFrom, setEditingFrom] = useState<AuthActionState | null>(null);
  const editing = editingFrom === state;

  const waiting = useCountdown(state);

  if (state.sentTo && !editing) {
    return (
      <CheckYourEmail
        state={state}
        next={next}
        formAction={formAction}
        pending={pending}
        waiting={waiting}
        linkLifetimeMinutes={linkLifetimeMinutes}
        onChangeEmail={() => setEditingFrom(state)}
      />
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      {/* Google first: one tap, and nothing to wait for in an inbox. */}
      {googleEnabled && !isLocalAdapter && (
        <>
          <GoogleButton next={next} />

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            <span className="text-label text-ink-subtle">{copy.auth.or}</span>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
        </>
      )}

      <form action={formAction} onSubmit={ignoreWhile(pending)} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />

        <FormError message={editing ? null : state.error} />

        <Field label={copy.auth.email}>
          {(props) => (
            <Input
              {...props}
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              defaultValue={state.email ?? state.sentTo ?? ''}
            />
          )}
        </Field>

        <Button
          type="submit"
          size="lg"
          loading={pending}
          loadingLabel={copy.auth.sending}
          disabled={waiting > 0 && !editing}
          fullWidth
        >
          {isLocalAdapter
            ? 'Continue'
            : waiting > 0 && !editing
              ? copy.auth.resendIn(waiting)
              : copy.auth.sendLink}
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

/**
 * The screen after a link is sent.
 *
 * Says where it went and how to use it, offers the code for the person whose
 * email opened on another device, and lets them resend or change the address —
 * so nobody is left wondering whether anything happened.
 */
function CheckYourEmail({
  state,
  next,
  formAction,
  pending,
  waiting,
  linkLifetimeMinutes,
  onChangeEmail,
}: {
  state: AuthActionState;
  next: string;
  formAction: (formData: FormData) => void;
  pending: boolean;
  waiting: number;
  linkLifetimeMinutes: number;
  onChangeEmail: () => void;
}) {
  const sentTo = state.sentTo ?? '';
  const [codeState, codeAction, codePending] = useActionState(
    verifySignInCode,
    initialSignInCodeState,
  );

  useEffect(() => {
    // A full navigation rather than the router, so every server component —
    // the header above all — renders again with the new session.
    if (codeState.status === 'signed-in' && codeState.redirectTo) {
      window.location.assign(codeState.redirectTo);
    }
  }, [codeState]);

  return (
    <div className="mt-8 flex flex-col gap-6">
      <div
        role="status"
        className="rounded-lg border border-positive/25 bg-positive-soft p-6"
      >
        <h2 className="font-display text-title-md tracking-tightish text-positive">
          {copy.auth.linkSentTitle}
        </h2>
        <p className="mt-2 text-body text-ink">
          {(state.sentCount ?? 1) > 1
            ? copy.auth.linkResentBody(sentTo)
            : copy.auth.linkSentBody(sentTo)}
        </p>
        <p className="mt-2 text-label text-ink-muted">
          {copy.auth.linkSentHowTo(linkLifetimeMinutes)}
        </p>
        <p className="mt-2 text-label text-ink-muted">{copy.auth.linkSentSpam}</p>
      </div>

      <form
        action={codeAction}
        onSubmit={ignoreWhile(codePending || codeState.status === 'signed-in')}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="email" value={sentTo} />
        <input type="hidden" name="next" value={next} />

        <Field label={copy.auth.codeLabel} hint={copy.auth.codeHint} error={codeState.error}>
          {(props) => (
            <Input
              {...props}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 \-]*"
              maxLength={14}
              required
              className="tracking-[0.2em]"
            />
          )}
        </Field>

        <Button
          type="submit"
          variant="secondary"
          loading={codePending || codeState.status === 'signed-in'}
          loadingLabel={copy.auth.codeWorking}
          fullWidth
        >
          {copy.auth.codeSubmit}
        </Button>
      </form>

      <form action={formAction} onSubmit={ignoreWhile(pending || waiting > 0)} className="flex flex-col gap-3">
        <input type="hidden" name="email" value={sentTo} />
        <input type="hidden" name="next" value={next} />

        {/* A refused resend: the cooldown, or the hourly cap. The link already
            sent is still good, which is why this screen stays. */}
        <FormError message={state.error} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            loading={pending}
            loadingLabel={copy.auth.sending}
            disabled={waiting > 0}
          >
            {waiting > 0 ? copy.auth.resendIn(waiting) : copy.auth.resend}
          </Button>

          <button
            type="button"
            onClick={onChangeEmail}
            className="text-label font-medium text-ink-muted underline underline-offset-4 hover:text-ink"
          >
            {copy.auth.changeEmail}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Seconds left before a request would be accepted, counted down from the
 * figure the server returned. It starts again with each new response, and it
 * only ever runs when the server named a figure: a wait nobody knows is not
 * shown as a countdown.
 */
function useCountdown(state: AuthActionState): number {
  const [remaining, setRemaining] = useState(() => state.cooldownSeconds ?? 0);

  // A new response restarts the count from its own figure, during render
  // rather than in an effect, so the button is never drawn with the last
  // response's number.
  const [countedFrom, setCountedFrom] = useState(state);
  if (countedFrom !== state) {
    setCountedFrom(state);
    setRemaining(state.cooldownSeconds ?? 0);
  }

  useEffect(() => {
    const seconds = state.cooldownSeconds ?? 0;
    if (seconds <= 0) return;

    const endsAt = Date.now() + seconds * 1000;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  return remaining;
}

/**
 * Enter in a field submits a form even while its button shows a spinner, and
 * each submission here is an email sent or a code spent. So a form that is
 * already working ignores the next one.
 */
function ignoreWhile(busy: boolean) {
  return (event: FormEvent<HTMLFormElement>) => {
    if (busy) event.preventDefault();
  };
}
