import 'server-only';

import { headers } from 'next/headers';
import type { z } from 'zod';

import { saltedHash } from '@/lib/safety/rate-limit';
import { AuthorisationError, hasRole, requireUser } from '@/server/auth/guards';
import { getRepository, type LivdRepository } from '@/server/data';
import type { AdminRole, UserProfile } from '@/types/domain';
import {
  REASON_REQUIRED,
  type AdminAuditAction,
  type AdminAuditOutcome,
  type AdminSubjectType,
} from './audit';
import { AdminActionError } from './errors';

/**
 * The privileged administrative action layer.
 *
 * Every sensitive administrative operation runs through `runAdminAction`, in
 * this order:
 *
 *     authenticate  →  authorise  →  validate  →  business rule
 *                   →  mutate/read  →  audit
 *
 * The last step is the reason the layer exists. Auditing used to be something
 * each repository method did or did not remember to do — so `setUserRole` wrote
 * a row and `createVerificationEvidenceLink`, which hands a moderator a tenancy
 * agreement carrying a name, an address and a signature, wrote nothing at all.
 * Here it is not the operation's job. The wrapper emits the entry whatever the
 * operation did, including when the operation was refused, so "somebody tried
 * and could not" is recorded as well as "somebody did".
 *
 * A denial is audited before it is returned, which is deliberate: an attempt to
 * cross the identity boundary is exactly the thing worth knowing about, and a
 * system that logs only successes cannot tell you somebody has been trying.
 *
 * WHAT THIS LAYER IS NOT
 *
 * It is not the security boundary. Row Level Security, column privileges and
 * the `livd_*` functions are, and each of them re-checks the caller against
 * `auth.uid()` rather than trusting anything decided here. This layer makes the
 * rules legible and the audit automatic; the database makes them true. A future
 * reviewer should be able to delete this file and find that the data is still
 * protected — slower to reason about, but protected.
 */

export interface AdminContext {
  actor: UserProfile;
  repository: LivdRepository;
}

export type AdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface AdminActionSpec<TInput, TOutput> {
  /**
   * The audit vocabulary entry for this operation.
   *
   * `null` means the database writes the record itself, inside the same
   * transaction as the change — which is stronger, because the two cannot come
   * apart. `livd_set_user_role` is the example: it writes to
   * `moderation_actions` in the transaction that moves the column, so a role
   * that changed without a reason is not a reachable state. Auditing it here
   * as well would produce two rows for one act.
   */
  action: AdminAuditAction | null;

  /** The tier required to attempt this at all. Re-checked in the database. */
  requires: AdminRole;

  schema: z.ZodType<TInput>;

  /** What the entry is about, derived from the validated input. */
  subject: (input: TInput) => { type: AdminSubjectType; id: string | null };

  /** Structured context for the entry. Never the value being protected. */
  detail?: (input: TInput, output: TOutput | null) => Record<string, string | number | boolean | null>;

  /** Where the written reason lives in the input, when there is one. */
  reason?: (input: TInput) => string | null;

  run: (context: AdminContext, input: TInput) => Promise<TOutput>;
}

/**
 * A coarse origin signal, salted before it is stored.
 *
 * The question it answers is "did the same origin do this forty times", which
 * is worth being able to ask about administrative access. A raw address would
 * make the audit log a second sensitive database, so it never becomes one.
 */
async function originHash(): Promise<string | null> {
  try {
    const headerList = await headers();
    const origin =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headerList.get('x-real-ip');

    return origin ? saltedHash(origin).slice(0, 32) : null;
  } catch {
    // Outside a request scope — a scheduled job, a test. The entry is still
    // worth writing without it.
    return null;
  }
}

export async function runAdminAction<TInput, TOutput>(
  spec: AdminActionSpec<TInput, TOutput>,
  raw: unknown,
): Promise<AdminResult<TOutput>> {
  /* --- 1. Authenticate ------------------------------------------------ */

  let actor: UserProfile;
  try {
    actor = await requireUser();
  } catch (error) {
    // Nothing is audited here on purpose. There is no established identity to
    // attribute an entry to, and writing "somebody unknown tried something"
    // for every expired session would bury the entries that matter.
    return {
      ok: false,
      error:
        error instanceof AuthorisationError
          ? error.message
          : 'You need to be signed in to do this.',
    };
  }

  const repository = await getRepository();
  const context: AdminContext = { actor, repository };
  const ipHash = await originHash();

  /* --- 2. Validate, so the subject and reason can be read -------------- */

  const parsed = spec.schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That request was not valid.' };
  }
  const input = parsed.data;

  const subject = spec.subject(input);
  const reason = spec.reason?.(input)?.trim() || null;

  const audit = async (outcome: AdminAuditOutcome, output: TOutput | null) => {
    if (spec.action === null) return;

    try {
      await repository.recordAdminAudit({
        actorId: actor.id,
        action: spec.action,
        subjectType: subject.type,
        subjectId: subject.id,
        outcome,
        reason,
        detail: spec.detail?.(input, output) ?? {},
        actorIpHash: ipHash,
      });
    } catch {
      // An audit write that fails must not take the operation's result with
      // it — but nor should it pass silently. There is nowhere better than the
      // server log to say so, and the message deliberately carries no subject.
      console.error(
        `[livd] audit write failed for ${spec.action}; the action itself was ${outcome}`,
      );
    }
  };

  /* --- 3. Authorise ---------------------------------------------------- */

  if (!hasRole(actor, spec.requires)) {
    await audit('denied', null);
    return { ok: false, error: 'You are not authorised to do this.' };
  }

  /* --- 4. Business rules the layer owns -------------------------------- */

  if (spec.action !== null && REASON_REQUIRED.has(spec.action) && !reason) {
    await audit('denied', null);
    return { ok: false, error: 'A reason is required, for the audit trail.' };
  }

  /* --- 5. Run ---------------------------------------------------------- */

  let output: TOutput;
  try {
    output = await spec.run(context, input);
  } catch (error) {
    const known = error instanceof AdminActionError;
    await audit(known ? error.outcome : 'failed', null);

    if (known) return { ok: false, error: error.message };

    // Nothing else reaches the caller. See src/server/admin/errors.ts.
    console.error('[livd] admin action failed', error);
    return { ok: false, error: 'Something went wrong. Nothing was changed.' };
  }

  /* --- 6. Audit -------------------------------------------------------- */

  await audit('succeeded', output);

  return { ok: true, data: output };
}
