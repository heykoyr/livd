'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ButtonLink, IconButton } from '@/components/ui/button';
import { NAV_LINKS } from '@/config/site';
import { copy } from '@/content/copy';
import { cn } from '@/lib/utils';
import type { UserProfile } from '@/types/domain';
import { SignOutButton } from './sign-out-button';

/**
 * Mobile navigation drawer.
 *
 * A full-height panel rather than a dropdown: on a phone the navigation is a
 * destination, and a cramped menu anchored to a corner is harder to hit and
 * harder to read.
 */
export function MobileNav({ user, isStaff }: { user: UserProfile | null; isStaff: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navigating closes the drawer — otherwise it stays open over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <IconButton
        label={open ? copy.nav.closeMenu : copy.nav.openMenu}
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="livd-mobile-nav"
        className="text-ink-muted hover:text-ink lg:hidden"
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </IconButton>

      <div
        id="livd-mobile-nav"
        hidden={!open}
        className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto border-t border-border bg-canvas lg:hidden"
      >
        <nav aria-label="Main" className="container-shell py-6">
          <ul className="flex flex-col">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={cn(
                    'flex items-center justify-between border-b border-border py-4 text-title-md text-ink',
                    pathname === link.href && 'text-brand',
                  )}
                >
                  {link.label}
                  <ChevronIcon />
                </Link>
              </li>
            ))}

            {user && (
              <>
                <li>
                  <Link
                    href="/shortlist"
                    className="flex items-center justify-between border-b border-border py-4 text-title-md text-ink"
                  >
                    {copy.nav.shortlist}
                    <ChevronIcon />
                  </Link>
                </li>
                <li>
                  <Link
                    href="/account"
                    className="flex items-center justify-between border-b border-border py-4 text-title-md text-ink"
                  >
                    {copy.nav.account}
                    <ChevronIcon />
                  </Link>
                </li>
              </>
            )}

            {isStaff && (
              <li>
                <Link
                  href="/admin"
                  className="flex items-center justify-between border-b border-border py-4 text-title-md text-accent"
                >
                  {copy.nav.admin}
                  <ChevronIcon />
                </Link>
              </li>
            )}
          </ul>

          <div className="mt-8 flex flex-col gap-3">
            <ButtonLink href="/review" size="lg" fullWidth>
              {copy.nav.writeReview}
            </ButtonLink>

            {user ? (
              <SignOutButton fullWidth />
            ) : (
              <ButtonLink href="/sign-in" variant="secondary" size="lg" fullWidth>
                {copy.nav.signIn}
              </ButtonLink>
            )}
          </div>
        </nav>
      </div>
    </>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-5" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-5" fill="none" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 text-ink-subtle" fill="none" aria-hidden="true">
      <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
