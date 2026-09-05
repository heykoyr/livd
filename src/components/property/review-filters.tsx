import Link from 'next/link';

import { copy } from '@/content/copy';
import { cn } from '@/lib/utils';
import type { PropertyIntelligence } from '@/types/domain';

export interface ReviewViewOptions {
  residency: 'all' | 'current' | 'former';
  verifiedOnly: boolean;
  sort: 'recent' | 'helpful' | 'highest' | 'lowest';
  page: number;
}

/**
 * Review filters, as links.
 *
 * Server-rendered anchors rather than client state: every filtered view has its
 * own URL, so it can be shared, bookmarked, opened in a new tab and reached
 * with JavaScript disabled. It also means the filter bar ships no JavaScript at
 * all, on the heaviest page in the product.
 */
export function ReviewFilters({
  options,
  intelligence,
  buildHref,
}: {
  options: ReviewViewOptions;
  intelligence: PropertyIntelligence;
  buildHref: (next: Partial<ReviewViewOptions>) => string;
}) {
  const residencyTabs = [
    { value: 'all' as const, label: copy.property.filterAll, count: intelligence.reviewCount },
    {
      value: 'former' as const,
      label: copy.property.filterFormer,
      count: intelligence.formerResidentCount,
    },
    {
      value: 'current' as const,
      label: copy.property.filterCurrent,
      count: intelligence.currentResidentCount,
    },
  ];

  const sorts = [
    { value: 'recent' as const, label: copy.property.sortRecent },
    { value: 'helpful' as const, label: copy.property.sortHelpful },
    { value: 'highest' as const, label: copy.property.sortHighest },
    { value: 'lowest' as const, label: copy.property.sortLowest },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {residencyTabs.map((tab) => {
          const active = options.residency === tab.value;
          return (
            <Link
              key={tab.value}
              href={buildHref({ residency: tab.value, page: 1 })}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-2 text-label transition-colors duration-fast',
                active
                  ? 'border-brand bg-brand-soft font-medium text-brand-ink'
                  : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink',
              )}
            >
              {tab.label}
              <span className="ml-1.5 tabular text-ink-subtle">{tab.count}</span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={buildHref({ verifiedOnly: !options.verifiedOnly, page: 1 })}
          aria-pressed={options.verifiedOnly}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-label transition-colors duration-fast',
            options.verifiedOnly
              ? 'border-positive/40 bg-positive-soft font-medium text-positive'
              : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink',
          )}
        >
          <CheckIcon />
          {copy.property.filterVerified}
          <span className="tabular text-ink-subtle">{intelligence.verifiedReviewCount}</span>
        </Link>

        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-label text-ink-subtle">{copy.search.sortLabel}</span>
          {sorts.map((sort) => {
            const active = options.sort === sort.value;
            return (
              <Link
                key={sort.value}
                href={buildHref({ sort: sort.value, page: 1 })}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-label transition-colors duration-fast',
                  active
                    ? 'bg-surface-sunken font-medium text-ink'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {sort.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden="true">
      <path
        d="m2 6.3 2.3 2.3L10 2.9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
