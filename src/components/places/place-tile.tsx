import Link from 'next/link';

import { copy } from '@/content/copy';
import { cn } from '@/lib/utils';

/**
 * A city or a neighbourhood in a list.
 *
 * Deliberately quieter than a property card. A place is a step on the way to
 * a property rather than a thing to evaluate, so it carries identity and the
 * amount of evidence behind it, and stops there — a score at this level would
 * be an average of averages, which is a number that reads as intelligence
 * while meaning very little.
 *
 * The figures are labelled rather than bare. The old index put a lone integer
 * at the end of each row, which the reader had no way to know was a property
 * count and not a review count.
 */
export function PlaceTile({
  href,
  name,
  context,
  propertyCount,
  reviewCount,
  className,
}: {
  href: string;
  name: string;
  context?: string | null;
  propertyCount: number;
  reviewCount: number;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'block rounded-lg border border-border bg-surface px-4 py-3.5',
        'transition-colors duration-fast hover:border-border-strong hover:bg-surface-sunken/50',
        className,
      )}
    >
      {/* `truncate` rather than wrapping, because these tiles sit in a grid
          whose tracks are `minmax(0, 1fr)` — the name cannot widen the track,
          and a two-line place name would make the rows ragged. */}
      <span className="block truncate text-body font-medium text-ink">{name}</span>
      {context && (
        <span className="mt-0.5 block truncate text-label text-ink-muted">{context}</span>
      )}
      <span className="mt-1.5 block text-micro tabular text-ink-subtle">
        {copy.explore.propertyCount(propertyCount)} · {copy.property.reviewCount(reviewCount)}
      </span>
    </Link>
  );
}

/** The one grid the place tiles are laid out in, so every surface matches. */
export function PlaceGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ul className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {children}
    </ul>
  );
}

/** The one grid property cards are laid out in on a discovery surface. */
export function PropertyGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ul className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3', className)}>
      {children}
    </ul>
  );
}
