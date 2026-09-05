'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { copy } from '@/content/copy';
import { cn } from '@/lib/utils';
import type { UserProfile } from '@/types/domain';
import { SignOutButton } from './sign-out-button';

/**
 * Account menu.
 *
 * A disclosure rather than a full menubar: three links and a sign-out do not
 * warrant the `menu`/`menuitem` roles, which would then owe the user typeahead
 * and full arrow-key semantics. A button that expands a list of links is the
 * honest description of what this is.
 */
export function AccountMenu({ user }: { user: UserProfile }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Focus returns to the trigger, not to the top of the document.
      buttonRef.current?.focus();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const initial = user.email.charAt(0).toUpperCase();

  return (
    <div ref={containerRef} className="relative hidden sm:block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="livd-account-menu"
        className={cn(
          'grid size-9 place-items-center rounded-full border text-label font-semibold transition-colors duration-fast',
          open
            ? 'border-brand bg-brand text-canvas'
            : 'border-border-strong bg-surface text-ink hover:bg-surface-sunken',
        )}
      >
        <span aria-hidden="true">{initial}</span>
        <span className="sr-only">{copy.nav.account}</span>
      </button>

      <div
        id="livd-account-menu"
        hidden={!open}
        className="absolute right-0 top-full z-50 mt-2 w-60 rounded-lg border border-border bg-surface p-1.5 shadow-popover"
      >
        <div className="border-b border-border px-3 py-2.5">
          <p className="truncate text-label font-medium text-ink" title={user.email}>
            {user.email}
          </p>
          <p className="mt-0.5 text-micro capitalize text-ink-subtle">{user.role}</p>
        </div>

        <ul className="py-1">
          {[
            { href: '/shortlist', label: copy.nav.shortlist },
            { href: '/account', label: copy.account.title },
            { href: '/account/reviews', label: copy.account.myReviews },
          ].map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block rounded-md px-3 py-2 text-label text-ink transition-colors duration-fast hover:bg-surface-sunken"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="border-t border-border p-1.5 pt-2">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
