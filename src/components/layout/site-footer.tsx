import Link from 'next/link';

import { Logo } from '@/components/brand/logo';
import { copy } from '@/content/copy';

const COLUMNS = [
  {
    heading: copy.footer.product,
    links: [
      { href: '/search', label: copy.nav.search },
      { href: '/places', label: copy.nav.explore },
      { href: '/review', label: copy.nav.writeReview },
      { href: '/shortlist', label: copy.nav.shortlist },
    ],
  },
  {
    heading: copy.footer.company,
    links: [
      { href: '/how-it-works', label: copy.nav.howItWorks },
      { href: '/trust', label: copy.nav.trust },
      { href: '/for-owners', label: copy.footer.forOwners },
    ],
  },
  {
    heading: copy.footer.legal,
    links: [
      { href: '/legal/privacy', label: copy.footer.privacy },
      { href: '/legal/terms', label: copy.footer.terms },
      { href: '/legal/content-policy', label: copy.footer.contentPolicy },
    ],
  },
] as const;

/**
 * The site footer.
 *
 * Deliberately carries no top margin. Every page already ends with its own
 * bottom padding, and the footer adding 6rem on top of that is what produced a
 * screen-height void between the last card and the rule. The tinted band and
 * the border are the separation; the gap above them belongs to the page.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface-sunken/50">
      <div className="container-shell py-14">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-label text-ink-muted">{copy.footer.tagline}</p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                {column.heading}
              </h2>
              <ul className="mt-3 flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {/* `py-2 -my-2` doubles the tap target to 31px without
                        moving anything: the padding grows the box, the
                        negative margin gives the space back to the layout.
                        Not the full 44 — these sit 34px apart, and expanding
                        past that would make neighbouring links overlap,
                        which is a worse outcome than a small one. They clear
                        WCAG 2.2 AA either way through the undersized-target
                        spacing exception. */}
                    <Link
                      href={link.href}
                      className="-my-2 block py-2 text-label text-ink-muted transition-colors duration-fast hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-micro text-ink-subtle">{copy.footer.rights(new Date().getFullYear())}</p>
          <p className="max-w-lg text-micro text-ink-subtle">
            Reviews on Livd are written by residents and are their own accounts of living
            somewhere. Property owners may respond; they cannot remove a review.
          </p>
        </div>
      </div>
    </footer>
  );
}
