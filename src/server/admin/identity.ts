import 'server-only';

import { z } from 'zod';

import type { IdentityAccessReason, IdentityAccessRecord, IdentityReveal } from '@/server/data';
import { fromDatabaseError, notAuthorised, refused } from './errors';
import { runAdminAction, type AdminResult } from './run';

/**
 * The identity boundary.
 *
 * Everything else in this console is designed so that a moderator never needs
 * to know who wrote a review. This is the exception, and it is deliberately
 * expensive to use: a higher role, a chosen category, a written reason, an
 * explicit confirmation, and a permanent record naming the person who asked.
 *
 * The friction is the feature. An identity that can be looked at casually is
 * an identity that will be, and the promise Livd makes to somebody writing an
 * honest review about the flat they still live in is that this does not happen
 * casually.
 */

const revealSchema = z.object({
  userId: z.string().min(1).max(80),
  reasonKey: z.string().min(1).max(64),
  reasonDetail: z.string().trim().max(1000).nullable().default(null),
  /**
   * A case or ticket this access belongs to. Optional today because the case
   * system arrives in the next phase; the column and the audit field exist now
   * so that history written before then is not missing a link it could have had.
   */
  caseReference: z.string().trim().max(64).nullable().default(null),
});

export type RevealIdentityInput = z.infer<typeof revealSchema>;

/**
 * Reveals an account's email address.
 *
 * `auditSuccess: false` because `livd_reveal_user_identity` writes the entry
 * itself, in the same transaction that reads the address — so a disclosure
 * without a record is not a reachable state. A *refused* attempt never gets
 * that far, so the layer records those, which is why the action is named here
 * rather than set to null.
 *
 * Somebody repeatedly trying to cross this boundary and failing is precisely
 * what an access log is for.
 */
export async function revealIdentity(raw: unknown): Promise<AdminResult<IdentityReveal>> {
  return runAdminAction<RevealIdentityInput, IdentityReveal>(
    {
      action: 'identity_revealed',
      auditSuccess: false,
      requires: 'trust_admin',
      schema: revealSchema,
      subject: (input) => ({ type: 'user', id: input.userId }),
      reason: (input) => input.reasonDetail || input.reasonKey,
      detail: (input) => ({
        reasonKey: input.reasonKey,
        caseReference: input.caseReference,
      }),

      run: async ({ actor, repository }, input) => {
        // Reading your own address does not need this machinery — the account
        // page shows it — and letting it through here would fill the access log
        // with entries nobody needs to review.
        if (input.userId === actor.id) {
          throw refused('This is your own account. Your address is on your account page.');
        }

        const reasons = await repository.listIdentityAccessReasons();
        const reason = reasons.find((entry) => entry.key === input.reasonKey);

        if (!reason) throw refused('Select a reason for this access.');

        if (reason.requiresDetail && (input.reasonDetail ?? '').trim().length < 10) {
          throw refused('This reason needs a written explanation.');
        }

        try {
          return await repository.revealUserIdentity({
            userId: input.userId,
            reasonKey: input.reasonKey,
            reasonDetail: input.reasonDetail,
            caseReference: input.caseReference,
            // The layer's own origin hash is not threaded down; the database
            // stamps the entry and this is the value it records.
            actorIpHash: null,
            actorId: actor.id,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : '';

          if (message.includes('Trust and Safety authorisation')) {
            throw notAuthorised(
              'Revealing an account identity requires Trust & Safety authorisation.',
            );
          }
          if (message.includes('No such account')) throw refused('No such account.');
          if (message.includes('written explanation')) {
            throw refused('This reason needs a written explanation.');
          }
          if (message.includes('Select a reason')) throw refused('Select a reason for this access.');

          throw fromDatabaseError(error, 'That account could not be revealed.');
        }
      },
    },
    raw,
  );
}

/** The categories an identity may be accessed for. */
export async function identityAccessReasons(): Promise<IdentityAccessReason[]> {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();
  return repository.listIdentityAccessReasons();
}

/**
 * Who has looked at this account's identity.
 *
 * Deliberately readable by a moderator, who cannot perform the access itself.
 * Seeing that an identity was looked at, by whom and why is the deterrent, and
 * an access log only its own subjects can read deters nobody.
 */
export async function identityAccessHistory(userId: string): Promise<IdentityAccessRecord[]> {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();

  try {
    return await repository.listIdentityAccess(userId);
  } catch {
    // The history is context on a page that works without it.
    return [];
  }
}
