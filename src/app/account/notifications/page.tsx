import type { Metadata } from 'next';
import Link from 'next/link';

import { requireUserPage } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import { PreferencesForm } from './preferences-form';

export const metadata: Metadata = {
  title: 'Email preferences',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * What Livd may email you about.
 *
 * Reached from the footer of every notification, which is also where the
 * `List-Unsubscribe` header points. One-click unsubscribe (RFC 8058) would
 * mean an unauthenticated POST that changes an account's settings from a
 * token in a URL, and these are transactional messages about a person's own
 * content rather than a mailing list — the trade is not worth a new
 * unauthenticated mutation surface when the page behind the link turns
 * everything off in two clicks.
 */
export default async function NotificationPreferencesPage() {
  const user = await requireUserPage('/account/notifications');

  const repository = await getRepository();
  const preferences = await repository.getNotificationPreferences(user.id);

  return (
    <div className="container-shell py-12 md:py-16">
      <div className="prose-measure">
        <Link
          href="/account"
          className="rounded-sm text-label text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          Account
        </Link>

        <h1 className="mt-4 font-display text-display-lg tracking-display text-ink">
          Email preferences
        </h1>
        <p className="mt-3 text-body-lg text-ink-muted">
          Livd writes to you about your own reviews and claims, and about nothing else. There is
          no newsletter, no digest and no marketing list, so there is nothing here to turn off
          that you did not ask for in the first place.
        </p>

        <PreferencesForm preferences={preferences} />

        <div className="mt-12 border-t border-border pt-6">
          <h2 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            Always sent
          </h2>
          <p className="mt-3 text-label text-ink-muted">
            Two things reach you whatever is switched off above. A sign-in link, because it is
            the only way into your account. And a decision that removes something you wrote or
            changes your account&rsquo;s standing — a platform that can take your writing down and
            is under no obligation to mention it is not one worth writing for.
          </p>
        </div>
      </div>
    </div>
  );
}
