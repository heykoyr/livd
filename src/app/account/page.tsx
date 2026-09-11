import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge, Card, Stat } from '@/components/ui/primitives';
import { getMarket } from '@/config/markets';
import { copy } from '@/content/copy';
import { DeleteAccount } from './delete-account';
import { formatRelativeTime } from '@/lib/format';
import { requireUserPage } from '@/server/auth/guards';
import { getRepository } from '@/server/data';

export const metadata: Metadata = {
  title: copy.account.title,
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await requireUserPage('/account');
  const repository = await getRepository();

  const [reviews, saved] = await Promise.all([
    repository.listReviewsByAuthor(user.id),
    repository.listSavedProperties(user.id),
  ]);

  const published = reviews.filter((review) => review.status === 'published');

  return (
    <div className="container-shell py-12 md:py-16">
      <div className="max-w-2xl">
        <h1 className="font-display text-display-lg tracking-display text-ink">
          {copy.account.title}
        </h1>
        <p className="mt-3 text-body-lg text-ink-muted">{user.email}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={user.role === 'resident' ? 'neutral' : 'brand'}>{user.role}</Badge>
          {user.countryCode && <Badge tone="neutral">{getMarket(user.countryCode).name}</Badge>}
        </div>
      </div>

      <Card className="mt-10 p-6">
        <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3">
          <Stat label="Published reviews" value={published.length} />
          <Stat label="Saved properties" value={saved.length} />
          <Stat label="Member since" value={formatRelativeTime(user.createdAt)} />
        </dl>
      </Card>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/account/reviews" className="block">
          <Card interactive className="h-full p-5">
            <h2 className="font-display text-title-md tracking-tightish text-ink">
              {copy.account.myReviews}
            </h2>
            <p className="mt-2 text-label text-ink-muted">
              Everything you have written, and what can still be corrected.
            </p>
          </Card>
        </Link>

        <Link href="/shortlist" className="block">
          <Card interactive className="h-full p-5">
            <h2 className="font-display text-title-md tracking-tightish text-ink">
              {copy.shortlist.title}
            </h2>
            <p className="mt-2 text-label text-ink-muted">
              Properties you are considering, side by side. Visible only to you.
            </p>
          </Card>
        </Link>
      </div>

      <section className="mt-12 max-w-prose">
        <h2 className="font-display text-title-lg tracking-tightish text-ink">
          What Livd knows about you
        </h2>
        <ul className="mt-4 flex flex-col gap-2.5 text-body text-ink-muted">
          <li>Your email address, so you can sign in and so one person cannot review a property twice.</li>
          <li>Which properties you saved. Never shown to anyone, including property owners.</li>
          <li>Your reviews, stored against your account but published with no link back to you.</li>
        </ul>
        <p className="mt-4 text-body text-ink-muted">
          There is no name, phone number or address on your account, because none is ever
          collected.
        </p>
      </section>

      {/* Was a promise pointing at a support address the product does not have,
          for a deletion the schema would have performed incorrectly anyway.
          Both halves are now real: migration 0017 severs where the legal pages
          say it severs, and this does it. */}
      <section className="mt-12 max-w-prose">
        <DeleteAccount />
      </section>
    </div>
  );
}
