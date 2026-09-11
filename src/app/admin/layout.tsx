import type { Metadata } from 'next';

import { copy } from '@/content/copy';
import { requireRolePage } from '@/server/auth/guards';
import { AdminNav, type AdminNavGroup } from './admin-nav';

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
const SECTION_GROUPS: AdminNavGroup[] = [
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
    label: 'Trust & Safety',
    items: [
      { href: '/admin/audit', label: copy.admin.auditTrail },
      { href: '/admin/authority-requests', label: copy.admin.authorityRequests },
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
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border pb-5">
        <h1 className="font-display text-display-md tracking-display text-ink">
          {copy.admin.title}
        </h1>
        <p className="text-label text-ink-subtle">Moderator tools</p>
      </div>

      {/*
        `grid-cols-1` below lg is load-bearing, not tidiness.

        Without it the single implicit track is `auto`, which sizes to the
        widest content in it rather than to the container — and one wide child
        then stretches the track past the viewport and scrolls the whole
        document sideways. `grid-cols-1` is `repeat(1, minmax(0, 1fr))`, a
        definite track, so a child that cannot fit scrolls inside its own box
        instead of taking the page with it.
      */}
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <AdminNav groups={SECTION_GROUPS} />

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
