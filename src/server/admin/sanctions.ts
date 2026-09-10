import 'server-only';

import { z } from 'zod';

import type { Sanction, SanctionReason } from '@/types/domain';
import { fromDatabaseError, refused } from './errors';
import { runAdminAction, type AdminResult } from './run';

/**
 * Sanctions.
 *
 * `action: null` on both mutations, because the database writes the audit entry
 * in the same transaction as the sanction row and the standing change. Three
 * things moving together, or none of them — an account whose standing changed
 * without a recorded reason is not a state Postgres can be left in.
 *
 * The tier required rises with severity, and is enforced in the database:
 * restrict is a moderator's, suspend is Trust & Safety's, ban is an
 * administrator's. The point at which a decision becomes hard to reverse is the
 * point at which it should need somebody more senior.
 *
 * `requires: 'moderator'` here is only the floor. It admits the attempt; the
 * database decides the outcome.
 */

const applySchema = z.object({
  userId: z.string().min(1).max(80),
  action: z.enum(['restricted', 'suspended', 'banned']),
  reasonKey: z.string().min(1).max(64),
  reason: z.string().trim().min(3, 'Say what this is for, in your own words.').max(1000),
  durationDays: z.number().int().min(1).max(3650).nullable().default(null),
  caseId: z.string().max(80).nullable().default(null),
});

export type ApplySanctionInput = z.infer<typeof applySchema>;

export async function applySanction(raw: unknown): Promise<AdminResult<{ sanctionId: string }>> {
  return runAdminAction<ApplySanctionInput, { sanctionId: string }>(
    {
      // Audited by livd_apply_sanction, transactionally.
      action: null,
      requires: 'moderator',
      schema: applySchema,
      subject: (input) => ({ type: 'user', id: input.userId }),
      reason: (input) => input.reason,

      run: async ({ actor, repository }, input) => {
        if (input.userId === actor.id) {
          throw refused('You cannot sanction your own account.');
        }

        // A ban has no end date. Accepting one would imply it lifts by itself,
        // which is the one thing a ban does not do.
        if (input.action === 'banned' && input.durationDays !== null) {
          throw refused('A ban has no end date. Use a suspension for a fixed period.');
        }

        try {
          const sanctionId = await repository.applySanction({
            userId: input.userId,
            action: input.action,
            reasonKey: input.reasonKey,
            reason: input.reason,
            durationDays: input.durationDays,
            caseId: input.caseId,
            actorId: actor.id,
          });

          return { sanctionId };
        } catch (error) {
          throw sanctionRefusal(error, 'That sanction could not be applied.');
        }
      },
    },
    raw,
  );
}

const liftSchema = z.object({
  sanctionId: z.string().min(1).max(80),
  reason: z.string().trim().min(3, 'Record why, for the audit trail.').max(500),
});

/** Lifts a sanction early. Requires the tier that could have applied it. */
export async function liftSanction(raw: unknown): Promise<AdminResult<null>> {
  return runAdminAction<z.infer<typeof liftSchema>, null>(
    {
      action: null,
      requires: 'moderator',
      schema: liftSchema,
      subject: (input) => ({ type: 'sanction', id: input.sanctionId }),
      reason: (input) => input.reason,

      run: async ({ actor, repository }, input) => {
        try {
          await repository.liftSanction(input.sanctionId, input.reason, actor.id);
          return null;
        } catch (error) {
          throw sanctionRefusal(error, 'That sanction could not be lifted.');
        }
      },
    },
    raw,
  );
}

export async function listSanctions(options: {
  userId?: string | null;
  activeOnly?: boolean;
  limit?: number;
} = {}): Promise<Sanction[]> {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();

  try {
    return await repository.listSanctions(options);
  } catch {
    // Context on a page that works without it.
    return [];
  }
}

export async function sanctionReasons(): Promise<SanctionReason[]> {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();
  return repository.listSanctionReasons();
}

function sanctionRefusal(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : '';

  const recognised = [
    'Only a moderator may restrict an account',
    'Suspending an account requires Trust and Safety authorisation',
    'Only an administrator may ban an account',
    'Only an administrator may act on a privileged account',
    'Only a moderator may lift a restriction',
    'Lifting a suspension requires Trust and Safety authorisation',
    'Only an administrator may lift a ban',
    'You cannot sanction your own account',
    'Select a reason for this sanction',
    'A reason is required, for the audit trail',
    'No such account',
    'No such sanction',
  ];

  const match = recognised.find((message) => raw.includes(message));
  return match ? refused(`${match}.`) : fromDatabaseError(error, fallback);
}
