import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { copy } from '@/content/copy';
import { googleSignInEnabled, resolveDataBackend } from '@/config/site';
import { safeNextPath } from '@/lib/auth/safe-redirect';
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

  if (user) redirect(next);

  return (
    <div className="container-shell flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <h1 className="font-display text-display-md tracking-display text-ink">
          {copy.auth.signInTitle}
        </h1>
        <p className="mt-3 text-body text-ink-muted">{copy.auth.signInLead}</p>

        {/* A link that has expired or been used already lands back here. Saying
            nothing would look like the sign-in simply failed for no reason. */}
        {params.error === 'link' && (
          <div
            role="status"
            className="mt-6 rounded-lg border border-caution/25 bg-caution-soft p-5"
          >
            <h2 className="text-label font-semibold text-caution">{copy.auth.linkFailedTitle}</h2>
            <p className="mt-1.5 text-label text-ink-muted">{copy.auth.linkFailedBody}</p>
          </div>
        )}

        <SignInForm
          next={next}
          isLocalAdapter={resolveDataBackend() === 'local'}
          googleEnabled={googleSignInEnabled()}
        />

        <div className="mt-10 rounded-lg border border-border bg-surface-sunken/60 p-5">
          <h2 className="text-label font-semibold text-ink">{copy.auth.whyAccount}</h2>
          <p className="mt-2 text-label text-ink-muted">{copy.auth.whyAccountBody}</p>
        </div>
      </div>
    </div>
  );
}
