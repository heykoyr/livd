import 'server-only';

import { z } from 'zod';

import { hasRole } from '@/server/auth/guards';
import type { LivdRepository } from '@/server/data';
import type { AdminUserDetail, AdminUserPage, ModerationAction } from '@/types/domain';
import { fromDatabaseError, notAuthorised, refused } from './errors';
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
  search: z.string().trim().max(320).nullable().default(null),
  role: z.enum(['resident', 'owner', 'moderator', 'trust_admin', 'admin']).nullable().default(null),
  status: z.enum(['active', 'restricted', 'suspended']).nullable().default(null),
  hasVerifiedReviews: z.boolean().nullable().default(null),
  hasReports: z.boolean().nullable().default(null),
  minReviews: z.number().int().min(1).max(1000).nullable().default(null),
});

/**
 * One page of the account directory.
 *
 * Audited, unlike an ordinary list. Nothing sensitive comes back — the
 * addresses are masked in SQL before they leave the database — but who pages
 * through the whole membership of the platform, and how often, is worth being
 * able to answer. It is a read the database does not record for itself.
 *
 * The search term is deliberately not in the audit detail when it is an
 * address. An audit log that records the email it was asked about has become
 * another copy of the thing it protects; what is recorded is that an email
 * search happened.
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
        returned: output?.items.length ?? 0,
        matched: output?.total ?? 0,
        // The kind, never the term. See above.
        searchKind: input.search ? (input.search.includes('@') ? 'email' : 'id') : 'none',
        filtered: Boolean(
          input.role ||
            input.status ||
            input.hasVerifiedReviews !== null ||
            input.hasReports !== null ||
            input.minReviews,
        ),
      }),

      run: async ({ actor, repository }, input) => {
        // Typing an address into a box and getting a result back confirms that
        // address holds an account here. Small, but a disclosure — and exactly
        // the kind a property owner's lawyer would go looking for. So it needs
        // Trust & Safety authorisation.
        //
        // `livd_admin_user_directory` refuses it independently, which is what
        // protects production. This check exists so the refusal is the same
        // sentence whichever adapter is running, and so the local store — which
        // has no privilege system — does not quietly behave differently from
        // Postgres.
        if (input.search?.includes('@') && !hasRole(actor, 'trust_admin')) {
          throw notAuthorised(
            'Searching by email address requires Trust & Safety authorisation.',
          );
        }

        try {
          return await repository.listAdminUsers(input);
        } catch (error) {
          throw fromDatabaseError(error, 'The directory could not be loaded.');
        }
      },
    },
    raw,
  );
}

const detailSchema = z.object({
  userId: z.string().min(1).max(80),
});

/**
 * One account, with its reviews and the reports about them.
 *
 * Audited as `user_detail_viewed`. Everything returned is masked or a count —
 * this is not the identity boundary — but "who has been looking at this
 * account" is a question worth being able to answer, particularly about an
 * account somebody has a grievance with.
 *
 * The three reads run in parallel and are handed back together, so the page
 * makes one call into this layer and produces one audit entry rather than
 * three.
 */
export async function readUserDetail(raw: unknown): Promise<
  AdminResult<{
    detail: AdminUserDetail;
    reviews: Awaited<ReturnType<LivdRepository['listAdminUserReviews']>>;
    reports: Awaited<ReturnType<LivdRepository['listAdminUserReports']>>;
    history: ModerationAction[];
  }>
> {
  return runAdminAction(
    {
      action: 'user_detail_viewed',
      requires: 'moderator',
      schema: detailSchema,
      subject: (input) => ({ type: 'user', id: input.userId }),

      run: async ({ repository }, input) => {
        const detail = await repository.getAdminUserDetail(input.userId).catch((error: unknown) => {
          throw fromDatabaseError(error, 'That account could not be loaded.');
        });

        if (!detail) throw refused('No such account.');

        const [reviews, reports, history] = await Promise.all([
          repository.listAdminUserReviews(input.userId, { pageSize: 50 }),
          repository.listAdminUserReports(input.userId, { pageSize: 50 }),
          repository.listModerationActions(input.userId, 50),
        ]);

        return { detail, reviews, reports, history };
      },
    },
    raw,
  );
}
