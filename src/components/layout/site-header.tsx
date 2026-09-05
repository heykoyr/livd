import Link from 'next/link';

import { Logo } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';
import { NAV_LINKS } from '@/config/site';
import { copy } from '@/content/copy';
import { hasRole } from '@/server/auth/guards';
import type { UserProfile } from '@/types/domain';
import { MobileNav } from './mobile-nav';
import { ThemeToggle } from './theme-toggle';
import { AccountMenu } from './account-menu';

/**
 * The application header.
 *
 * A server component, so the signed-in state is correct on first paint and
 * there is no authentication flicker. Only the three genuinely interactive
 * pieces — the mobile drawer, the theme toggle and the account menu — ship
 * JavaScript.
 */
export function SiteHeader({ user }: { user: UserProfile | null }) {
  const isStaff = hasRole(user, 'moderator');

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-canvas/85 backdrop-blur-md">
      <div className="container-shell flex h-16 items-center gap-3">
        <Link
          href="/"
          className="flex shrink-0 items-center rounded-sm py-1 pr-2"
          aria-label={`${copy.brand.name} — home`}
        >
          <Logo />
        </Link>

        <nav aria-label="Main" className="ml-2 hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="rounded-md px-3 py-2 text-label font-medium text-ink-muted transition-colors duration-fast hover:bg-surface-sunken hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            {isStaff && (
              <li>
                <Link
                  href="/admin"
                  className="rounded-md px-3 py-2 text-label font-medium text-accent transition-colors duration-fast hover:bg-accent-soft"
                >
                  {copy.nav.admin}
                </Link>
              </li>
            )}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />

          <ButtonLink
            href="/review"
            variant="secondary"
            size="sm"
            className="hidden sm:inline-flex"
          >
            {copy.nav.writeReview}
          </ButtonLink>

          {user ? (
            <AccountMenu user={user} />
          ) : (
            <ButtonLink href="/sign-in" size="sm" className="hidden sm:inline-flex">
              {copy.nav.signIn}
            </ButtonLink>
          )}

          <MobileNav user={user} isStaff={isStaff} />
        </div>
      </div>
    </header>
  );
}
