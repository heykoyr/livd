import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { Pagination } from '@/components/ui/pagination';
import { formatRelativeTime } from '@/lib/format';
import { hasRole } from '@/server/auth/guards';
import { getCurrentUser } from '@/server/auth/session';
import { getRepository } from '@/server/data';
import type { UserRole, UserStatus } from '@/types/domain';
import { RoleControls, StatusControls } from '../moderation-controls';

/**
 * Accounts.
 *
 * This page used to print every account's real email address. The adapter
 * fetched them with the service-role key and the page rendered `user.email`
 * for all 124 of them, to anyone the layout guard admitted — which includes
 * moderators. Nothing was recorded, because reading an address was not
 * modelled as an act at all. On a product whose promise is that a reviewer
 * stays anonymous, that was the largest privacy hole in it.
 *
 * Now the directory is built by `livd_admin_user_directory`, which masks
 * inside Postgres. No object in this process carries a real address, so this
 * page could not leak one if it tried. Reading an actual address becomes a
 * separate, authorised, audited operation in a later phase; until then nothing
 * in this application can read an account's email but the account itself.
 *
 * Only an administrator may change a role. The layout guard admits moderators,
 * so this page checks the higher bar itself and renders read-only otherwise —
 * and `livd_set_user_role` enforces the same rule regardless of what this
 * chooses to show.
 */

export const dynamic = 'force-dynamic';

const ROLE_LABELS: Record<UserRole, string> = {
  resident: 'Resident',
  owner: 'Owner',
  moderator: 'Moderator',
  trust_admin: 'Trust & Safety',
  admin: 'Administrator',
};

const STATUS_TONES: Record<UserStatus, 'neutral' | 'caution' | 'critical'> = {
  active: 'neutral',
  restricted: 'caution',
  suspended: 'critical',
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedPage = Number(typeof params.page === 'string' ? params.page : '1');
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;

  const [repository, viewer] = await Promise.all([getRepository(), getCurrentUser()]);
  const directory = await repository.listAdminUsers({ page });
  const canEditRoles = hasRole(viewer, 'admin');

  if (directory.total === 0) {
    return (
      <EmptyState title="No accounts yet" description="Accounts appear here as people sign up." />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-label text-ink-muted">
          <span className="tabular font-medium text-ink">{directory.total}</span>{' '}
          {directory.total === 1 ? 'account' : 'accounts'}
        </p>
        {!canEditRoles && (
          <p className="text-label text-ink-subtle">Roles can only be changed by an administrator.</p>
        )}
      </div>

      <Card className="border-border bg-surface-sunken/50 p-4">
        <h2 className="text-label font-semibold text-ink">Email addresses are masked</h2>
        <p className="mt-1.5 max-w-prose text-label text-ink-muted">
          Enough to recognise the same person across two cases, and not enough to identify anyone.
          The full address is never loaded into this page — the masking happens in the database.
        </p>
      </Card>

      <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
        {directory.items.map((user) => (
          <li key={user.id} className="bg-surface p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="truncate font-mono text-label text-ink">{user.maskedEmail}</p>

                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-micro text-ink-subtle">
                  <Badge tone={user.role === 'resident' ? 'neutral' : 'brand'}>
                    {ROLE_LABELS[user.role]}
                  </Badge>
                  {user.status !== 'active' && (
                    <Badge tone={STATUS_TONES[user.status]}>{user.status}</Badge>
                  )}
                  <span className="font-mono">{user.id.slice(0, 8)}</span>
                  <span>Joined {formatRelativeTime(user.createdAt)}</span>
                  {viewer?.id === user.id && <span className="text-ink-muted">— you</span>}
                </p>
              </div>

              {viewer?.id !== user.id && (
                <div className="flex shrink-0 flex-col gap-4 border-t border-border pt-4 lg:w-80 lg:border-0 lg:pt-0">
                  {canEditRoles && <RoleControls userId={user.id} currentRole={user.role} />}
                  <StatusControls userId={user.id} currentStatus={user.status} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Pagination
        page={directory.page}
        pageSize={directory.pageSize}
        total={directory.total}
        buildHref={(next) => `/admin/users?page=${next}`}
      />
    </div>
  );
}
