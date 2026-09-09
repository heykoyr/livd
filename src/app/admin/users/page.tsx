import { Badge, EmptyState } from '@/components/ui/primitives';
import { formatRelativeTime } from '@/lib/format';
import { hasRole } from '@/server/auth/guards';
import { getCurrentUser } from '@/server/auth/session';
import { getRepository } from '@/server/data';
import { RoleControls, StatusControls } from '../moderation-controls';

/**
 * Accounts.
 *
 * Only an admin may change a role. The layout guard admits moderators, so this
 * page checks the higher bar itself and renders read-only otherwise — and the
 * Server Action enforces the same rule regardless of what this chooses to show.
 */
export default async function UsersPage() {
  const [repository, viewer] = await Promise.all([getRepository(), getCurrentUser()]);
  const users = await repository.listUsers(100);
  const canEdit = hasRole(viewer, 'admin');

  if (users.length === 0) {
    return (
      <EmptyState title="No accounts yet" description="Accounts appear here as people sign up." />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && (
        <p className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5 text-label text-ink-muted">
          Roles can only be changed by an administrator.
        </p>
      )}

      <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
        {users.map((user) => (
          <li key={user.id} className="bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-body text-ink">{user.email || user.id}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-micro text-ink-subtle">
                  <Badge tone={user.role === 'resident' ? 'neutral' : 'brand'}>{user.role}</Badge>
                  {user.status !== 'active' && <Badge tone="caution">{user.status}</Badge>}
                  Joined {formatRelativeTime(user.createdAt)}
                </p>
              </div>

              {viewer?.id !== user.id && (
                <div className="flex w-full flex-col gap-4 border-t border-border pt-4 lg:w-auto lg:border-0 lg:pt-0">
                  {canEdit && <RoleControls userId={user.id} currentRole={user.role} />}
                  <StatusControls userId={user.id} currentStatus={user.status} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
