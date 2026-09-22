import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { copy } from '@/content/copy';
import { SIGN_IN_EMAIL, googleSignInEnabled, resolveDataBackend } from '@/config/site';
import { safeNextPath } from '@/lib/auth/safe-redirect';
import { parseLinkFailure } from '@/lib/auth/sign-in-failures';
import { getCurrentUser } from '@/server/auth/session';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = {
  title: copy.auth.signInTitle,
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  // One rule, shared with the action that sends the link and the callback that
  // completes it — see `src/lib/auth/safe-redirect.ts`.
  const next = safeNextPath(params.next);

  // Signed in already — including a second tap on a link that has just
  // worked, which would otherwise read as "already used" to the person it
  // signed in.
  if (user) redirect(next);

  const failure = parseLinkFailure(params.error);

  return (
    <div className="container-shell flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <h1 className="font-display text-display-md tracking-display text-ink">
          {copy.auth.signInTitle}
        </h1>
        <p className="mt-3 text-body text-ink-muted">{copy.auth.signInLead}</p>

        {/* A link, code or Google return that did not finish lands back here,
            and says which of the things that can go wrong actually did. One
            sentence for all of them used to tell somebody whose link opened
            in the wrong browser that it had expired, which it had not. */}
        {failure && (
          <div
            role="status"
            className="mt-6 rounded-lg border border-caution/25 bg-caution-soft p-5"
          >
            <h2 className="text-label font-semibold text-caution">
              {copy.auth.linkFailures[failure].title}
            </h2>
            <p className="mt-1.5 text-label text-ink-muted">
              {copy.auth.linkFailures[failure].body(SIGN_IN_EMAIL.lifetimeMinutes)}
            </p>
          </div>
        )}

        <SignInForm
          next={next}
          isLocalAdapter={resolveDataBackend() === 'local'}
          googleEnabled={googleSignInEnabled()}
          linkLifetimeMinutes={SIGN_IN_EMAIL.lifetimeMinutes}
        />

        <div className="mt-10 rounded-lg border border-border bg-surface-sunken/60 p-5">
          <h2 className="text-label font-semibold text-ink">{copy.auth.whyAccount}</h2>
          <p className="mt-2 text-label text-ink-muted">{copy.auth.whyAccountBody}</p>
        </div>
      </div>
    </div>
  );
}
