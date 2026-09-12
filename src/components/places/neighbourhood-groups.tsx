import Link from 'next/link';

import { getMarket } from '@/config/markets';
import { copy } from '@/content/copy';
import { localityHref } from '@/lib/places';
import type { NeighbourhoodSummary } from '@/server/data/repository';

/**
 * Neighbourhoods, under the city they belong to.
 *
 * The grouping is the point. A flat list of neighbourhood names is the same
 * database-index problem one level down — "Lekki" means nothing to somebody
 * who does not already know it is in Lagos. Naming the city first, and making
 * it a link, keeps the city → neighbourhood → property path visible in the
 * layout rather than only in the URL.
 *
 * Chips rather than tiles: a neighbourhood carries less to say than a city, and
 * a wrapping row of chips cannot overflow a narrow viewport however long the
 * names are.
 */
export function NeighbourhoodGroups({
  neighbourhoods,
  /** Per city, so one dense city cannot crowd out every other. */
  perLocality = 8,
  /**
   * Cities shown at all.
   *
   * Without this the section became the country index again, one level down:
   * fifteen city headings with a single chip under each, which is a list of
   * everywhere Livd has heard of rather than a few areas worth reading about.
   * Groups are ranked by the evidence behind them, so the cap keeps the ones
   * with something to say.
   */
  maxLocalities = 6,
}: {
  neighbourhoods: NeighbourhoodSummary[];
  perLocality?: number;
  maxLocalities?: number;
}) {
  const groups = new Map<
    string,
    { countryCode: string; locality: string; reviewCount: number; items: NeighbourhoodSummary[] }
  >();

  for (const neighbourhood of neighbourhoods) {
    const key = `${neighbourhood.countryCode}:${neighbourhood.locality.toLowerCase()}`;
    const group = groups.get(key);
    if (group) {
      group.items.push(neighbourhood);
      group.reviewCount += neighbourhood.reviewCount;
    } else {
      groups.set(key, {
        countryCode: neighbourhood.countryCode,
        locality: neighbourhood.locality,
        reviewCount: neighbourhood.reviewCount,
        items: [neighbourhood],
      });
    }
  }

  const ranked = [...groups.values()]
    .sort(
      (a, b) =>
        b.reviewCount - a.reviewCount ||
        b.items.length - a.items.length ||
        a.locality.localeCompare(b.locality),
    )
    .slice(0, maxLocalities);

  return (
    <div className="flex flex-col gap-8">
      {ranked.map((group) => (
        <div key={`${group.countryCode}:${group.locality}`}>
          <h3 className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <Link
              href={localityHref(group.countryCode, group.locality)}
              className="rounded-sm font-display text-title-md tracking-tightish text-ink underline decoration-transparent underline-offset-4 transition-colors duration-fast hover:decoration-border-strong"
            >
              {group.locality}
            </Link>
            <span className="text-micro text-ink-subtle">
              {getMarket(group.countryCode).name}
            </span>
          </h3>

          <ul className="mt-3 flex flex-wrap gap-2">
            {group.items.slice(0, perLocality).map((neighbourhood) => (
              <li key={neighbourhood.href}>
                <Link
                  href={neighbourhood.href}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-label text-ink transition-colors duration-fast hover:border-border-strong hover:bg-surface-sunken"
                >
                  {neighbourhood.neighbourhood}
                  {/* The figure is a review count, said out loud for a screen
                      reader rather than left as a naked number beside a name. */}
                  <span className="tabular text-ink-subtle">
                    <span aria-hidden="true">{neighbourhood.reviewCount}</span>
                    <span className="sr-only">
                      {copy.property.reviewCount(neighbourhood.reviewCount)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
