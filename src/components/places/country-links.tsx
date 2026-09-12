import Link from 'next/link';

import { getMarket } from '@/config/markets';
import { copy } from '@/content/copy';
import { countryHref } from '@/lib/places';
import type { LocalitySummary } from '@/server/data/repository';

/**
 * The countries residents have written about.
 *
 * Derived from the data rather than from the market list, so every link leads
 * somewhere with something to read. Listing all twelve configured markets
 * would be listing dead ends, and a dead end is worse than an absence.
 *
 * This is the "local by default, never local only" escape hatch made concrete:
 * whatever country Livd guessed for a visitor, every other one it holds data
 * for is a single link away, and the search box above reaches the rest of the
 * world.
 */
export function CountryLinks({
  localities,
  activeCountry = null,
}: {
  localities: LocalitySummary[];
  activeCountry?: string | null;
}) {
  const byCountry = new Map<string, { cities: number; reviews: number }>();

  for (const locality of localities) {
    const existing = byCountry.get(locality.countryCode);
    byCountry.set(locality.countryCode, {
      cities: (existing?.cities ?? 0) + 1,
      reviews: (existing?.reviews ?? 0) + locality.reviewCount,
    });
  }

  const countries = [...byCountry.entries()]
    .map(([countryCode, counts]) => ({ countryCode, ...counts, name: getMarket(countryCode).name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (countries.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2">
      {countries.map((country) => {
        const isActive = activeCountry?.toUpperCase() === country.countryCode.toUpperCase();

        return (
          <li key={country.countryCode}>
            <Link
              href={countryHref(country.countryCode)}
              aria-current={isActive ? 'true' : undefined}
              className={
                'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-label transition-colors duration-fast ' +
                (isActive
                  ? 'border-brand-border bg-brand-soft text-brand-ink'
                  : 'border-border bg-surface text-ink hover:border-border-strong hover:bg-surface-sunken')
              }
            >
              {country.name}
              <span className="tabular text-ink-subtle">
                <span aria-hidden="true">{country.cities}</span>
                <span className="sr-only">{copy.explore.cityCount(country.cities)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
