import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { copy } from '@/content/copy';
import { resolveDataBackend } from '@/config/site';
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
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  // Only same-origin paths are accepted as a return destination, so the `next`
  // parameter cannot be used to bounce a signed-in user off-site.
  const next = params.next?.startsWith('/') && !params.next.startsWith('//') ? params.next : '/';

  if (user) redirect(next);

  return (
    <div className="container-shell flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <h1 className="font-display text-display-md tracking-display text-ink">
          {copy.auth.signInTitle}
        </h1>
        <p className="mt-3 text-body text-ink-muted">{copy.auth.signInLead}</p>

        <SignInForm next={next} isLocalAdapter={resolveDataBackend() === 'local'} />

        <div className="mt-10 rounded-lg border border-border bg-surface-sunken/60 p-5">
          <h2 className="text-label font-semibold text-ink">{copy.auth.whyAccount}</h2>
          <p className="mt-2 text-label text-ink-muted">{copy.auth.whyAccountBody}</p>
        </div>
      </div>
    </div>
  );
}
