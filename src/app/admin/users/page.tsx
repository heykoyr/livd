import Link from 'next/link';

import { Badge, EmptyState } from '@/components/ui/primitives';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { formatRelativeTime } from '@/lib/format';
import type { AdminUserSummary } from '@/types/domain';
import { readUserDirectory } from '@/server/admin';
import { hasRole } from '@/server/auth/guards';
import { getCurrentUser } from '@/server/auth/session';
import { ROLE_LABELS, STATUS_TONES } from './labels';
import { DirectoryFilters } from './filters';

/**
 * The account directory.
 *
 * This page used to print every account's real email address. The adapter
 * fetched them with the service-role key and the page rendered `user.email`
 * for all 124 of them, to anyone the layout guard admitted — which includes
 * moderators. Nothing was recorded, because reading an address was not
 * modelled as an act at all. On a product whose promise is that a reviewer
 * stays anonymous, that was the largest privacy hole in it.
 *
 * Now the whole query — masking, counting, filtering, paging — happens in
 * `livd_admin_user_directory`. No object in this process carries a real
 * address, so this page could not leak one if it tried.
 *
 * What it shows instead is what an investigation actually runs on: how much
 * somebody has written, how much of it was verified, and whether any of it has
 * been reported. Those three numbers answer "is this account worth a closer
 * look" without answering "who is this", which is a different question with a
 * different authorisation and an audit entry of its own.
 */

export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

/** `yes` → true, `no` → false, anything else → no opinion. */
function tristate(value: string): boolean | null {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const requestedPage = Number(first(params.page) || '1');
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;

  const query = {
    search: first(params.q),
    role: first(params.role),
    status: first(params.status),
    verified: first(params.verified),
    reported: first(params.reported),
  };

  const viewer = await getCurrentUser();
  const canEditRoles = hasRole(viewer, 'admin');
  const canSearchByEmail = hasRole(viewer, 'trust_admin');

  // Through the administrative layer rather than the repository, so the read is
  // authorised and recorded. Nothing sensitive comes back, but who pages
  // through the whole membership of the platform is worth being able to answer.
  const result = await readUserDirectory({
    page,
    pageSize: 25,
    search: query.search || null,
    role: query.role || null,
    status: query.status || null,
    hasVerifiedReviews: tristate(query.verified),
    hasReports: tristate(query.reported),
  });

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-5">
        <DirectoryFilters query={query} canSearchByEmail={canSearchByEmail} resultCount={0} />
        <EmptyState title="Not available" description={result.error} />
      </div>
    );
  }

  const directory = result.data;

  const keepQuery = (next: number) => {
    const search = new URLSearchParams();
    if (query.search) search.set('q', query.search);
    if (query.role) search.set('role', query.role);
    if (query.status) search.set('status', query.status);
    if (query.verified) search.set('verified', query.verified);
    if (query.reported) search.set('reported', query.reported);
    search.set('page', String(next));
    return `/admin/users?${search.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <DirectoryFilters
        query={query}
        canSearchByEmail={canSearchByEmail}
        resultCount={directory.total}
      />

      {!canEditRoles && (
        <p className="text-label text-ink-subtle">
          Roles can only be changed by an administrator.
        </p>
      )}

      {directory.items.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          description="No account fits those filters. Clearing them shows everyone."
        />
      ) : (
        <DataTable
          caption="Accounts, most recently joined first. Email addresses are masked."
          columns={directoryColumns(viewer?.id ?? null)}
          rows={directory.items}
          rowKey={(user) => user.id}
        />
      )}

      <Pagination
        page={directory.page}
        pageSize={directory.pageSize}
        total={directory.total}
        buildHref={keepQuery}
      />
    </div>
  );
}

/**
 * The directory's columns, declared once for both representations.
 *
 * `viewerId` is threaded in only to mark the reader's own row. Recognising
 * yourself in a list of masked addresses is otherwise guesswork, and the
 * moment that matters is the one where somebody is about to act on an account.
 */
function directoryColumns(viewerId: string | null): Array<DataColumn<AdminUserSummary>> {
  return [
    {
      key: 'account',
      header: 'Account',
      primary: true,
      cell: (user) => (
        <>
          <Link
            href={`/admin/users/${user.id}`}
            className="font-mono text-label text-ink underline-offset-4 hover:underline"
          >
            {user.maskedEmail}
          </Link>
          <span className="mt-0.5 block font-mono text-micro text-ink-subtle">
            {user.id.slice(0, 8)}
            {viewerId === user.id && ' · you'}
          </span>
        </>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (user) => (
        <Badge tone={user.role === 'resident' ? 'neutral' : 'brand'}>{ROLE_LABELS[user.role]}</Badge>
      ),
    },
    {
      key: 'standing',
      header: 'Standing',
      cell: (user) =>
        user.status === 'active' ? (
          <span className="text-ink-muted">Active</span>
        ) : (
          <Badge tone={STATUS_TONES[user.status]}>{user.status}</Badge>
        ),
    },
    { key: 'reviews', header: 'Reviews', numeric: true, cell: (user) => user.reviewCount },
    {
      key: 'verified',
      header: 'Verified',
      numeric: true,
      cell: (user) => <span className="text-ink-muted">{user.verifiedReviewCount}</span>,
    },
    {
      key: 'reports',
      header: 'Reports',
      numeric: true,
      // A count, not an accusation. Colour only where there is something to
      // look at, and never the only signal.
      cell: (user) => (
        <span className={user.reportsAgainst > 0 ? 'font-medium text-caution' : 'text-ink-muted'}>
          {user.reportsAgainst}
        </span>
      ),
    },
    {
      key: 'joined',
      header: 'Joined',
      cell: (user) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatRelativeTime(user.createdAt)}
        </span>
      ),
    },
  ];
}
