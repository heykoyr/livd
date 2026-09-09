import 'server-only';

import { z } from 'zod';

import type { AdminUserPage } from '@/types/domain';
import { fromDatabaseError, refused } from './errors';
import { runAdminAction, type AdminResult } from './run';

/**
 * Administrative operations on accounts.
 *
 * Each one is a `runAdminAction` spec rather than a function that does its own
 * checking, which is what makes the pipeline — authenticate, authorise,
 * validate, business rule, mutate, audit — a property of every operation
 * instead of a convention each author follows.
 *
 * Note the `action: null` on the two mutations. Both are audited *inside the
 * database*, in the same transaction as the change, by `livd_set_user_role`
 * and `livd_set_user_status`. That is stronger than auditing here, because the
 * record and the change cannot come apart — a role that moved without a reason
 * is not a state Postgres can be left in. Emitting an entry from this layer as
 * well would produce two rows for one act.
 *
 * The read below is the opposite case: nothing in the database records that
 * somebody listed the directory, so the layer records it.
 */

const roleSchema = z.object({
  userId: z.string().min(1).max(80),
  role: z.enum(['resident', 'owner', 'moderator', 'trust_admin', 'admin']),
  reason: z.string().trim().min(3, 'Record why, for the audit trail.').max(500),
});

export type ChangeRoleInput = z.infer<typeof roleSchema>;

export async function changeUserRole(raw: unknown): Promise<AdminResult<null>> {
  return runAdminAction<ChangeRoleInput, null>(
    {
      // Audited by livd_set_user_role, transactionally. See above.
      action: null,
      requires: 'admin',
      schema: roleSchema,
      subject: (input) => ({ type: 'user', id: input.userId }),
      reason: (input) => input.reason,

      run: async ({ actor, repository }, input) => {
        // Repeated in the database, which is what actually enforces it. Here so
        // the refusal is a sentence rather than a raised exception.
        if (input.userId === actor.id) {
          throw refused('You cannot change your own role.');
        }

        try {
          await repository.setUserRole(input.userId, input.role, actor.id, input.reason);
        } catch (error) {
          throw fromDatabaseError(error, 'That role could not be changed.');
        }

        return null;
      },
    },
    raw,
  );
}

const statusSchema = z.object({
  userId: z.string().min(1).max(80),
  status: z.enum(['active', 'restricted', 'suspended']),
  reason: z.string().trim().min(3, 'Record why, for the audit trail.').max(500),
});

export type ChangeStatusInput = z.infer<typeof statusSchema>;

export async function changeUserStatus(raw: unknown): Promise<AdminResult<null>> {
  return runAdminAction<ChangeStatusInput, null>(
    {
      // Audited by livd_set_user_status, transactionally.
      action: null,
      requires: 'moderator',
      schema: statusSchema,
      subject: (input) => ({ type: 'user', id: input.userId }),
      reason: (input) => input.reason,

      run: async ({ actor, repository }, input) => {
        if (input.userId === actor.id) {
          throw refused('You cannot change your own standing.');
        }

        try {
          await repository.setUserStatus(input.userId, input.status, actor.id, input.reason);
        } catch (error) {
          throw fromDatabaseError(error, 'That account could not be changed.');
        }

        return null;
      },
    },
    raw,
  );
}

const directorySchema = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

/**
 * One page of the account directory.
 *
 * Audited, unlike an ordinary list. Nothing sensitive is returned — the
 * addresses are masked in SQL before they leave the database — but who is
 * paging through the whole membership of the platform, and how often, is worth
 * being able to answer. It is a read the database does not record for itself.
 */
export async function readUserDirectory(raw: unknown): Promise<AdminResult<AdminUserPage>> {
  return runAdminAction<z.infer<typeof directorySchema>, AdminUserPage>(
    {
      action: 'user_directory_searched',
      requires: 'moderator',
      schema: directorySchema,
      subject: () => ({ type: 'user', id: null }),
      detail: (input, output) => ({
        page: input.page,
        pageSize: input.pageSize,
        returned: output?.items.length ?? 0,
      }),

      run: async ({ repository }, input) => {
        try {
          return await repository.listAdminUsers({
            page: input.page,
            pageSize: input.pageSize,
          });
        } catch (error) {
          throw fromDatabaseError(error, 'The directory could not be loaded.');
        }
      },
    },
    raw,
  );
}
