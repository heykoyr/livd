import type { Metadata } from 'next';

import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/primitives';
import { LIMITS } from '@/config/site';
import { copy } from '@/content/copy';
import { requireUserPage } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import { ComparisonTable } from './comparison-table';
import { ShortlistItem } from './shortlist-item';

export const metadata: Metadata = {
  title: copy.shortlist.title,
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The shortlist.
 *
 * Private to its owner, by Row Level Security as well as by this guard. Nothing
 * about which properties a person is considering is visible to anyone else —
 * least of all to a landlord, for whom knowing who is researching them is an
 * obvious way to turn this data against the people it exists to serve.
 */
export default async function ShortlistPage() {
  const user = await requireUserPage('/shortlist');

  const repository = await getRepository();
  const saved = await repository.listSavedProperties(user.id);

  if (saved.length === 0) {
    return (
      <div className="container-shell py-12 md:py-16">
        <h1 className="font-display text-display-lg tracking-display text-ink">
          {copy.shortlist.title}
        </h1>
        <EmptyState
          className="mt-10"
          title={copy.shortlist.emptyTitle}
          description={copy.shortlist.emptyBody}
          action={
            <ButtonLink href="/search" size="lg">
              {copy.shortlist.findProperties}
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const comparable = saved.slice(0, LIMITS.maxShortlistCompare).map((entry) => entry.summary);

  return (
    <div className="container-shell py-12 md:py-16">
      <div className="max-w-2xl">
        <h1 className="font-display text-display-lg tracking-display text-ink">
          {copy.shortlist.title}
        </h1>
        <p className="mt-4 text-body-lg text-ink-muted">{copy.shortlist.lead}</p>
      </div>

      {comparable.length > 1 && (
        <section className="mt-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-title-lg tracking-tightish text-ink">
              {copy.shortlist.compare}
            </h2>
            {saved.length > LIMITS.maxShortlistCompare && (
              <p className="text-label text-ink-subtle">
                {copy.shortlist.compareLimit(LIMITS.maxShortlistCompare)}
              </p>
            )}
          </div>

          <ComparisonTable summaries={comparable} />
        </section>
      )}

      <section className="mt-14">
        <h2 className="font-display text-title-lg tracking-tightish text-ink">
          Saved properties
        </h2>

        <ul className="mt-5 flex flex-col gap-4">
          {saved.map((entry) => (
            <li key={entry.propertyId}>
              <ShortlistItem entry={entry} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
