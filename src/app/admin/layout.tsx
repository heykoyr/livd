import type { Metadata } from 'next';
import Link from 'next/link';

import { copy } from '@/content/copy';
import { requireRolePage } from '@/server/auth/guards';

export const metadata: Metadata = {
  title: copy.admin.title,
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

const SECTIONS = [
  { href: '/admin', label: copy.admin.dashboard },
  { href: '/admin/queue', label: copy.admin.queue },
  { href: '/admin/reports', label: copy.admin.reports },
  { href: '/admin/flags', label: copy.admin.flags },
  { href: '/admin/verification', label: copy.admin.verificationQueue },
  { href: '/admin/verification-attempts', label: copy.admin.verificationAttempts },
  { href: '/admin/claims', label: copy.admin.claims },
  { href: '/admin/users', label: copy.admin.users },
];

/**
 * Admin shell.
 *
 * The guard sits in the layout, so every page beneath it is protected by
 * construction rather than by each page remembering to check. It redirects to
 * not-found rather than to a forbidden page: an unauthorised visitor should not
 * learn that an admin area exists at this path.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRolePage('moderator', '/admin');

  return (
    <div className="container-shell py-10 md:py-14">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <h1 className="font-display text-display-md tracking-display text-ink">
          {copy.admin.title}
        </h1>
        <p className="text-label text-ink-subtle">Moderator tools</p>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Admin sections">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {SECTIONS.map((section) => (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className="block shrink-0 rounded-md px-3 py-2 text-label font-medium text-ink-muted transition-colors duration-fast hover:bg-surface-sunken hover:text-ink"
                >
                  {section.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
