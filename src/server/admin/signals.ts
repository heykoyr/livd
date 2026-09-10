import 'server-only';

import { z } from 'zod';

import type { AccountSignal } from '@/types/domain';
import { fromDatabaseError, refused } from './errors';
import { runAdminAction, type AdminResult } from './run';

/**
 * Signals.
 *
 * A signal is a question put to a person, and everything in this file exists
 * to make sure it reaches one. Nothing here changes a review, a score or an
 * account's standing — the strongest thing any of it does is cause somebody to
 * be asked.
 *
 * That is not a limitation waiting to be lifted. A detector that could act
 * would eventually act on a property that had simply become popular, or on a
 * resident who moved twice in a year, and there is no threshold clever enough
 * to be trusted with that. The arithmetic decides what is unusual; a person
 * decides what it means.
 *
 * `investigateSignal` is the one that matters. Until Phase 12 a signal ended at
 * reviewed or dismissed — a verdict on the *signal* — which left no room for
 * the answer an unexplained pattern most often warrants: this needs looking
 * into. Now it opens a case, carrying the arithmetic into the timeline.
 */

const decideSchema = z.object({
  signalId: z.string().min(1).max(120),
  status: z.enum(['reviewed', 'dismissed']),
});

/**
 * Records a decision on an account signal.
 *
 * No written reason, unlike most of this directory, and for the same reason
 * `FlagControls` asks for none: nothing the public sees changes either way, so
 * the friction would buy nothing and would slow the one queue that has to be
 * cleared quickly to stay useful. Acting on the account still requires one.
 */
export async function decideAccountSignal(raw: unknown): Promise<AdminResult<null>> {
  return runAdminAction<z.infer<typeof decideSchema>, null>(
    {
      action: null,
      requires: 'moderator',
      schema: decideSchema,
      // The subject is an account, but the signal's id is not an account id
      // and the layer has not read the row. Naming the wrong subject would be
      // worse than naming none.
      subject: () => ({ type: 'user', id: null }),

      run: async ({ actor, repository }, input) => {
        try {
          await repository.decideAccountSignal(input.signalId, input.status, actor.id);
          return null;
        } catch (error) {
          throw signalRefusal(error, 'That signal could not be decided.');
        }
      },
    },
    raw,
  );
}

const investigateSchema = z.object({
  signalKind: z.enum(['property', 'account']),
  signalId: z.string().min(1).max(120),
  why: z.string().trim().min(3, 'Say what you want looked into.').max(500),
});

/** Opens a case from a signal, and hands back where the work now lives. */
export async function investigateSignal(
  raw: unknown,
): Promise<AdminResult<{ caseId: string }>> {
  return runAdminAction<z.infer<typeof investigateSchema>, { caseId: string }>(
    {
      action: 'case_created',
      requires: 'moderator',
      schema: investigateSchema,
      subject: () => ({ type: 'case', id: null }),
      detail: (input) => ({ signalKind: input.signalKind }),
      reason: (input) => input.why,

      run: async ({ actor, repository }, input) => {
        try {
          const caseId = await repository.openCaseFromSignal({
            signalKind: input.signalKind,
            signalId: input.signalId,
            why: input.why,
            actorId: actor.id,
          });
          return { caseId };
        } catch (error) {
          throw signalRefusal(error, 'A case could not be opened from that signal.');
        }
      },
    },
    raw,
  );
}

export async function listAccountSignals(
  status: AccountSignal['status'] | null = 'open',
): Promise<AccountSignal[]> {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();

  try {
    return await repository.listAccountSignals(status);
  } catch {
    // The database refuses anybody below moderator, and it already has.
    return [];
  }
}

function signalRefusal(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : '';

  const recognised = [
    'Only a moderator may decide a signal',
    'Only a moderator may open a case',
    'Say what you want looked into',
    'A signal is reviewed or dismissed',
    'A signal is about a property or an account',
    'No such signal',
  ];

  const match = recognised.find((message) => raw.includes(message));
  return match ? refused(`${match}.`) : fromDatabaseError(error, fallback);
}
