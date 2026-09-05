'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/primitives';
import { MARKET_LIST, PROPERTY_TYPE_KEYS, propertyTypeLabel } from '@/config/markets';
import { copy } from '@/content/copy';
import { buildSearchHref, countActiveFilters } from '@/lib/validation/search';
import { cn } from '@/lib/utils';
import type { PropertyTypeKey, SearchFilters, SearchSort } from '@/types/domain';

/**
 * Search filters.
 *
 * A bottom sheet on mobile and a dialog on desktop, rather than a sidebar that
 * would consume a third of a phone screen permanently. Nothing applies until
 * "Apply" — on a small screen, results reshuffling under a half-set filter is
 * disorienting and makes the panel feel unreliable.
 *
 * Sort is separate and applies immediately, because it never changes *which*
 * properties are shown, only their order.
 */
export function SearchFilters({ filters }: { filters: SearchFilters }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(filters);

  const activeCount = countActiveFilters(filters);

  function apply(): void {
    setOpen(false);
    startTransition(() => router.push(buildSearchHref(draft, { page: 1 })));
  }

  function reset(): void {
    const cleared: SearchFilters = {
      ...filters,
      countryCode: null,
      locality: null,
      propertyTypes: [],
      minScore: null,
      minReviews: null,
      verifiedOnly: false,
      page: 1,
    };
    setDraft(cleared);
    setOpen(false);
    startTransition(() => router.push(buildSearchHref(cleared)));
  }

  function changeSort(sort: SearchSort): void {
    startTransition(() => router.push(buildSearchHref(filters, { sort, page: 1 })));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setDraft(filters);
          setOpen(true);
        }}
        aria-haspopup="dialog"
      >
        <FilterIcon />
        {copy.search.filters}
        {activeCount > 0 && (
          <Badge tone="brand" className="ml-0.5 px-1.5 py-0.5">
            {activeCount}
          </Badge>
        )}
      </Button>

      <label className="flex items-center gap-2 text-label text-ink-muted">
        <span className="sr-only sm:not-sr-only">{copy.search.sortLabel}</span>
        <select
          value={filters.sort}
          onChange={(event) => changeSort(event.target.value as SearchSort)}
          disabled={pending}
          className="h-9 rounded-md border border-border-strong bg-surface px-2.5 pr-8 text-label text-ink transition-colors duration-fast hover:border-ink-subtle"
        >
          {(Object.entries(copy.search.sorts) as Array<[SearchSort, string]>).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={copy.search.filters}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={reset}>
              {copy.search.resetFilters}
            </Button>
            <Button onClick={apply}>{copy.search.applyFilters}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-7 py-2">
          <fieldset>
            <legend className="text-label font-medium text-ink">{copy.search.filterCountry}</legend>
            <select
              value={draft.countryCode ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, countryCode: event.target.value || null })
              }
              className="mt-2.5 h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-body text-ink"
            >
              <option value="">{copy.search.anyCountry}</option>
              {MARKET_LIST.map((market) => (
                <option key={market.code} value={market.code}>
                  {market.name}
                </option>
              ))}
            </select>
          </fieldset>

          <fieldset>
            <legend className="text-label font-medium text-ink">{copy.search.filterType}</legend>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {PROPERTY_TYPE_KEYS.map((type) => {
                const selected = draft.propertyTypes.includes(type);
                return (
                  <label
                    key={type}
                    className={cn(
                      'cursor-pointer rounded-full border px-3.5 py-2 text-label transition-colors duration-fast',
                      'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
                      selected
                        ? 'border-brand bg-brand-soft text-brand-ink'
                        : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          propertyTypes: selected
                            ? draft.propertyTypes.filter((t) => t !== type)
                            : [...draft.propertyTypes, type as PropertyTypeKey],
                        })
                      }
                      className="sr-only"
                    />
                    {propertyTypeLabel(type, draft.countryCode)}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-label font-medium text-ink">
              {copy.search.filterMinScore}
            </legend>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {[null, 50, 65, 80].map((score) => (
                <button
                  key={String(score)}
                  type="button"
                  onClick={() => setDraft({ ...draft, minScore: score })}
                  className={cn(
                    'rounded-full border px-3.5 py-2 text-label tabular transition-colors duration-fast',
                    draft.minScore === score
                      ? 'border-brand bg-brand-soft text-brand-ink'
                      : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink',
                  )}
                >
                  {score === null ? copy.search.anyScore : `${score}+`}
                </button>
              ))}
            </div>
            <p className="mt-2 text-micro text-ink-subtle">
              Only properties with enough reviews to be scored are included.
            </p>
          </fieldset>

          <fieldset>
            <legend className="text-label font-medium text-ink">
              {copy.search.filterMinReviews}
            </legend>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {[null, 3, 10, 20].map((count) => (
                <button
                  key={String(count)}
                  type="button"
                  onClick={() => setDraft({ ...draft, minReviews: count })}
                  className={cn(
                    'rounded-full border px-3.5 py-2 text-label tabular transition-colors duration-fast',
                    draft.minReviews === count
                      ? 'border-brand bg-brand-soft text-brand-ink'
                      : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink',
                  )}
                >
                  {count === null ? 'Any' : `${count}+`}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4">
            <input
              type="checkbox"
              checked={draft.verifiedOnly}
              onChange={(event) => setDraft({ ...draft, verifiedOnly: event.target.checked })}
              className="mt-0.5 size-4 accent-brand"
            />
            <span>
              <span className="block text-body font-medium text-ink">
                {copy.search.filterVerified}
              </span>
              <span className="mt-0.5 block text-label text-ink-muted">
                Show only properties where at least one resident has been verified.
              </span>
            </span>
          </label>
        </div>
      </Dialog>
    </div>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path
        d="M2 4h12M4.5 8h7M6.5 12h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
