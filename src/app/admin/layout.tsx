import type { Metadata } from 'next';
import Link from 'next/link';

import { copy } from '@/content/copy';
import { requireRolePage } from '@/server/auth/guards';

export const metadata: Metadata = {
  title: copy.admin.title,
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

/**
 * The console's information architecture.
 *
 * Grouped rather than flat, because eight undifferentiated links stopped
 * telling anybody what this tool is for. The groups say it: content is
 * moderated, verification is judged, people are managed, and Trust & Safety is
 * the layer that holds all three accountable.
 *
 * Cases sit first under Moderation because a case is what the work is now
 * organised around — a report is an input to one, not a thing to be dealt with
 * on its own.
 */
const SECTION_GROUPS: Array<{ label: string; items: Array<{ href: string; label: string }> }> = [
  {
    label: 'Overview',
    items: [{ href: '/admin', label: copy.admin.dashboard }],
  },
  {
    label: 'Moderation',
    items: [
      { href: '/admin/cases', label: copy.admin.cases },
      { href: '/admin/queue', label: copy.admin.queue },
      { href: '/admin/reports', label: copy.admin.reports },
      { href: '/admin/flags', label: copy.admin.flags },
    ],
  },
  {
    label: 'Verification',
    items: [
      { href: '/admin/verification', label: copy.admin.verificationQueue },
      { href: '/admin/verification-attempts', label: copy.admin.verificationAttempts },
      { href: '/admin/claims', label: copy.admin.claims },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/admin/users', label: copy.admin.users },
      { href: '/admin/sanctions', label: copy.admin.sanctions },
    ],
  },
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
          {/* Horizontal and scrollable below lg, grouped and vertical above.
              An admin console is desktop work, but a moderator checking a case
              from a phone should not meet a broken layout. */}
          <div className="flex gap-5 overflow-x-auto pb-2 lg:flex-col lg:gap-6 lg:overflow-visible lg:pb-0">
            {SECTION_GROUPS.map((group) => (
              <div key={group.label} className="shrink-0">
                <h2 className="mb-1.5 px-3 text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                  {group.label}
                </h2>
                <ul className="flex gap-1 lg:flex-col">
                  {group.items.map((section) => (
                    <li key={section.href}>
                      <Link
                        href={section.href}
                        className="block shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-label font-medium text-ink-muted transition-colors duration-fast hover:bg-surface-sunken hover:text-ink"
                      >
                        {section.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
