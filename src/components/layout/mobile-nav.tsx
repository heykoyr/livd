'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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
 *
 * The panel is positioned `absolute` against the header, which is `sticky` at
 * the top of the viewport, and NOT `fixed`. That is not a stylistic choice.
 * The header carries `backdrop-blur`, and `backdrop-filter` makes an element
 * the containing block for every `position: fixed` descendant — so a `fixed`
 * panel resolved `top: 4rem; bottom: 0` against the 4rem-tall header and
 * rendered exactly one border tall. The button worked; there was simply
 * nothing to see. Anchoring to the header instead also keeps the panel next
 * to its trigger in the DOM, so Tab moves from the button straight into the
 * menu without any focus juggling.
 */
export function MobileNav({ user, isStaff }: { user: UserProfile | null; isStaff: boolean }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  // Navigating closes the drawer — otherwise it stays open over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /**
   * Closing on the press as well as on the path change.
   *
   * The effect above is keyed on the pathname, so tapping the link for the
   * page you are already on changed nothing and left the drawer sitting open
   * over it with the body still scroll-locked. That is reachable from every
   * page in the navigation, and closing on the press costs one handler.
   */
  const close = (): void => setOpen(false);

  useEffect(() => {
    if (!open) return;

    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Focus returns to the trigger, not to the top of the document.
      buttonRef.current?.focus();
    }

    // At `lg` the drawer is display:none and the inline navigation takes over.
    // Without this, rotating a phone into a wide landscape while the drawer is
    // open leaves the page scroll-locked with nothing on screen to close.
    const wide = window.matchMedia('(min-width: 64rem)');
    function handleWiden(): void {
      if (wide.matches) setOpen(false);
    }

    document.addEventListener('keydown', handleKeyDown);
    wide.addEventListener('change', handleWiden);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
      wide.removeEventListener('change', handleWiden);
    };
  }, [open]);

  return (
    <>
      <IconButton
        ref={buttonRef}
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
        // `top-full` reads the header's height rather than repeating it. The
        // 4rem in the height is that same header, and is the one place the
        // value has to be written out, because no unit expresses "everything
        // below my top edge". `overscroll-contain` stops a scroll that reaches
        // the end of the menu from carrying on into the page beneath it.
        className={
          'absolute inset-x-0 top-full z-40 h-[calc(100dvh-4rem)] lg:hidden ' +
          'overflow-y-auto overscroll-contain border-t border-border bg-canvas'
        }
      >
        <nav aria-label="Main" className="container-shell py-6">
          <ul className="flex flex-col">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={close}
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
                    onClick={close}
                    className="flex items-center justify-between border-b border-border py-4 text-title-md text-ink"
                  >
                    {copy.nav.shortlist}
                    <ChevronIcon />
                  </Link>
                </li>
                <li>
                  <Link
                    href="/account"
                    onClick={close}
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
                  onClick={close}
                  className="flex items-center justify-between border-b border-border py-4 text-title-md text-accent"
                >
                  {copy.nav.admin}
                  <ChevronIcon />
                </Link>
              </li>
            )}
          </ul>

          <div className="mt-8 flex flex-col gap-3">
            <ButtonLink href="/review" onClick={close} size="lg" fullWidth>
              {copy.nav.writeReview}
            </ButtonLink>

            {user ? (
              <SignOutButton fullWidth />
            ) : (
              <ButtonLink href="/sign-in" onClick={close} variant="secondary" size="lg" fullWidth>
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
