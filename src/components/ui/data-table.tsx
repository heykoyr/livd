import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * One administrative table, at two sizes.
 *
 * The console has two genuinely tabular datasets — accounts and sanctions —
 * and both were a seven- or eight-column `<table>` inside `overflow-x-auto`.
 * On a desktop that is right. On a phone it meant swiping a 46rem table
 * sideways through a 20rem window, reading one column at a time with the
 * account it belongs to scrolled off the left edge. A scroll container had
 * made the layout survivable without making the data readable.
 *
 * So the same columns are declared once and rendered twice: a real `<table>`
 * from `lg` up, and a stack of cards below it. Only one is in the accessibility
 * tree at a time — `hidden` is `display: none`, which removes a subtree from it
 * — so a screen reader meets one representation, not two.
 *
 * Declaring the columns rather than writing both markups by hand is the point.
 * Two representations written separately drift: a column gets added to the
 * table and not the card, and nobody notices because nobody reviews the
 * console on a phone.
 */
export interface DataColumn<T> {
  /** Stable key. Not rendered. */
  key: string;
  /** Column heading, and the card's label for the same value. */
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-aligned in the table. Figures, not text. */
  numeric?: boolean;
  /**
   * The column that identifies the row. Rendered as the card's heading
   * instead of as a labelled pair, and given the widest treatment in the
   * table. Exactly one column should set it.
   */
  primary?: boolean;
  /**
   * Card layout hint. `full` gives the pair the whole card width, for values
   * long enough that half of one would wrap badly.
   */
  span?: 'half' | 'full';
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  className,
}: {
  /** Describes the table for a screen reader. Visually hidden. */
  caption: string;
  columns: Array<DataColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  className?: string;
}) {
  const primary = columns.find((column) => column.primary);
  const rest = columns.filter((column) => !column.primary);

  return (
    <div className={cn('min-w-0', className)}>
      {/* ---- Below lg: one card per record ------------------------------ */}

      <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border lg:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="bg-surface p-4">
            {/* The record's own link is the one control on a card, and it
                was a 15px line of monospace. `tap-target` on the cell gives
                the thumb the whole 44px without changing the type. */}
            {primary && (
              <div className="[&_a]:tap-target min-w-0">{primary.cell(row)}</div>
            )}

            <dl className={cn('grid grid-cols-2 gap-x-4 gap-y-3', primary && 'mt-3.5')}>
              {rest.map((column) => (
                <div
                  key={column.key}
                  className={cn('min-w-0', column.span === 'full' && 'col-span-2')}
                >
                  <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                    {column.header}
                  </dt>
                  <dd className={cn('mt-1 text-label text-ink', column.numeric && 'tabular')}>
                    {column.cell(row)}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {/* ---- lg and up: the table --------------------------------------- */}

      <div className="hidden overflow-x-auto rounded-lg border border-border lg:block">
        <table className="w-full border-collapse text-label">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-surface-sunken/60 text-left">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'px-3 py-2 text-micro font-semibold uppercase tracking-micro text-ink-subtle',
                    column.numeric && 'text-right',
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-border last:border-0 hover:bg-surface-sunken/40"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-3 py-2.5 align-top',
                      column.numeric && 'tabular text-right',
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
