import Link from 'next/link';

import { copy } from '@/content/copy';
import { cn } from '@/lib/utils';

/**
 * Pagination as real links.
 *
 * Anchors rather than buttons, so a page is bookmarkable, shareable, indexable
 * and openable in a new tab — which matters for a search surface that is
 * intended to be found through search engines.
 */
export function Pagination({
  page,
  pageSize,
  total,
  buildHref,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  buildHref: (page: number) => string;
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const pages = pageWindow(page, totalPages);

  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-center gap-1', className)}>
      <PageLink
        href={buildHref(page - 1)}
        disabled={page <= 1}
        label={copy.common.previous}
        className="px-3"
      >
        <ChevronIcon className="rotate-180" />
        <span className="hidden sm:inline">{copy.common.previous}</span>
      </PageLink>

      <ol className="flex items-center gap-1">
        {pages.map((entry, index) =>
          entry === 'gap' ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-1.5 text-ink-subtle">
              …
            </li>
          ) : (
            <li key={entry}>
              <Link
                href={buildHref(entry)}
                aria-current={entry === page ? 'page' : undefined}
                aria-label={copy.common.page(entry)}
                className={cn(
                  'grid h-10 min-w-10 place-items-center rounded-md px-2 text-label tabular transition-colors duration-fast',
                  entry === page
                    ? 'bg-brand text-canvas'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {entry}
              </Link>
            </li>
          ),
        )}
      </ol>

      <PageLink
        href={buildHref(page + 1)}
        disabled={page >= totalPages}
        label={copy.common.next}
        className="px-3"
      >
        <span className="hidden sm:inline">{copy.common.next}</span>
        <ChevronIcon />
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
  className,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex h-10 items-center gap-1.5 rounded-md text-label text-ink-subtle opacity-45',
          className,
        )}
      >
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        'flex h-10 items-center gap-1.5 rounded-md text-label text-ink-muted transition-colors duration-fast hover:bg-surface-sunken hover:text-ink',
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** First, last, current and its neighbours; gaps elsewhere. */
function pageWindow(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const result: Array<number | 'gap'> = [];
  let previous = 0;

  for (const page of sorted) {
    if (previous && page - previous > 1) result.push('gap');
    result.push(page);
    previous = page;
  }

  return result;
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3.5', className)} fill="none" aria-hidden="true">
      <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
