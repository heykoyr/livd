import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { copy } from '@/content/copy';
import { livdOrigins } from '@/config/site';
import { destinationFromLink, parseEmailLinkParams } from '@/lib/auth/confirm-link';
import { ConfirmSignInForm } from './confirm-form';

export const metadata: Metadata = {
  title: copy.auth.confirmTitle,
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Where a sign-in email lands.
 *
 * Opening this page signs nobody in, and that is the point of it. Email
 * security scanners — Gmail's, Outlook's Safe Links, corporate gateways — open
 * the links in a message to see where they go, sometimes before the recipient
 * has seen it. A link that signed in on opening would be spent by the scanner,
 * and its owner would arrive to "this link has already been used". So the
 * token is redeemed only by the button below, which is a POST a scanner does
 * not make.
 *
 * Redeeming it needs nothing from the browser that asked for the email. The
 * token hash is checked by Supabase with `verifyOtp`, so a link requested in
 * Safari and opened in Chrome — which iOS does whenever Chrome is the default
 * browser — completes in Chrome. The previous design stored a PKCE secret in
 * the requesting browser and could not.
 */
export default async function ConfirmSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = destinationFromLink(params.next, livdOrigins());
  const link = parseEmailLinkParams(params);

  if (!link) {
    redirect(`/sign-in?error=invalid&next=${encodeURIComponent(next)}`);
  }

  return (
    <div className="container-shell flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <h1 className="font-display text-display-md tracking-display text-ink">
          {copy.auth.confirmTitle}
        </h1>
        <p className="mt-3 text-body text-ink-muted">{copy.auth.confirmLead}</p>

        <ConfirmSignInForm tokenHash={link.tokenHash} type={link.type} next={next} />

        <p className="mt-6 text-label text-ink-subtle">{copy.auth.confirmWhy}</p>
      </div>
    </div>
  );
}
