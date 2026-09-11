'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

export interface AdminNavItem {
  href: string;
  label: string;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

/**
 * The console's navigation, at two sizes.
 *
 * It used to be one arrangement stretched across both: a row of five groups
 * laid out horizontally below `lg`, inside a scroll container, on the
 * reasoning that an admin console is desktop work. Two things were wrong with
 * that.
 *
 * The first was a layout bug rather than a judgement. The row sat in a grid
 * whose only track was implicitly `auto`, so the track sized to the row's
 * *content* — 1,284px — and the whole console overflowed a 375px viewport
 * sideways, taking the page with it. A scroll container does not stop its
 * contents contributing an intrinsic width to an auto-sized track; only a
 * definite track (`minmax(0, 1fr)`) or `min-width: 0` on the item does. The
 * fix for that is in the layout, and the lesson is that `overflow-x-auto`
 * prevents a *visible* overflow only when something upstream has already
 * decided how wide the box is.
 *
 * The second was the judgement. Even scrolling correctly, reaching Sanctions
 * meant swiping past nine other links with no indication they were there.
 * Below `lg` the whole thing is now one disclosure, closed by default, whose
 * summary names the page you are on — so the console opens on its content
 * rather than on its own furniture, and every destination is one tap and a
 * vertical scan away.
 *
 * Marking the current page is new at both sizes, and was the other thing
 * missing: ten links that never said which one you had followed.
 */
export function AdminNav({ groups }: { groups: AdminNavGroup[] }) {
  const pathname = usePathname();
  const disclosure = useRef<HTMLDetailsElement>(null);

  const current = findCurrent(groups, pathname);

  // A client-side navigation does not reload the page, so the disclosure would
  // otherwise stay open over the content the reader just asked for.
  useEffect(() => {
    if (disclosure.current) disclosure.current.open = false;
  }, [pathname]);

  return (
    <nav aria-label="Admin sections" className="min-w-0">
      {/* ---- Below lg: one disclosure ---------------------------------- */}

      <details ref={disclosure} className="group min-w-0 lg:hidden">
        <summary
          className={cn(
            'flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg',
            'border border-border bg-surface px-4 py-3 text-label font-medium text-ink',
            'transition-colors duration-fast hover:bg-surface-sunken',
            // Safari renders a disclosure triangle through ::marker and
            // ignores list-style on the summary itself.
            '[&::-webkit-details-marker]:hidden',
          )}
        >
          <span className="min-w-0 truncate">
            <span className="text-ink-subtle">Section</span>
            <span aria-hidden="true" className="mx-2 text-border-strong">
              /
            </span>
            {current?.label ?? 'Choose'}
          </span>
          <ChevronIcon className="size-4 shrink-0 text-ink-subtle transition-transform duration-fast group-open:rotate-180" />
        </summary>

        <div className="mt-2 flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          {groups.map((group) => (
            <div key={group.label} className="min-w-0">
              <h2 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                {group.label}
              </h2>
              <ul className="mt-1.5 flex flex-col">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} active={item.href === current?.href} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>

      {/* ---- lg and up: the grouped column ----------------------------- */}

      <div className="hidden lg:flex lg:flex-col lg:gap-6">
        {groups.map((group) => (
          <div key={group.label} className="min-w-0">
            <h2 className="mb-1.5 px-3 text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              {group.label}
            </h2>
            <ul className="flex flex-col">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={item.href === current?.href} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

function NavLink({ item, active }: { item: AdminNavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // 44px minimum target, which the old 36px links did not meet.
        'flex min-h-11 items-center rounded-md px-3 py-2 text-label transition-colors duration-fast',
        active
          ? 'bg-brand-soft font-semibold text-brand'
          : 'font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink',
      )}
    >
      {item.label}
    </Link>
  );
}

/**
 * The deepest entry the current path sits under.
 *
 * Longest match wins, so `/admin/users/abc` resolves to Users rather than to
 * Dashboard, which `/admin` would otherwise claim by prefix.
 */
function findCurrent(groups: AdminNavGroup[], pathname: string): AdminNavItem | null {
  let best: AdminNavItem | null = null;

  for (const group of groups) {
    for (const item of group.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (!best || item.href.length > best.href.length)) best = item;
    }
  }

  return best;
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
