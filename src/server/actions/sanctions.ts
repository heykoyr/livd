'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import * as admin from '@/server/admin';
import { notify } from '@/server/notify';
import type { SanctionAction } from '@/types/domain';
import type { ModerationActionState } from './action-state';

const SEVERITY: Record<SanctionAction, number> = { restricted: 1, suspended: 2, banned: 3 };

/**
 * Sanction actions.
 *
 * Thin adapters onto the administrative layer. The tier required rises with
 * severity and is decided in the database — `livd_apply_sanction` refuses a
 * suspension from a moderator and a ban from anyone but an administrator,
 * whatever this function was asked to do.
 *
 * Both tell the person the decision is about. Until 0050 nothing did: the
 * preferences page promised that a change to an account's standing is always
 * emailed, and a sanctioned person learned of it by finding they could no
 * longer sign in. The email carries the category and its public description,
 * never the moderator's written reason — that field is a note for the next
 * colleague, and it may describe what a report said.
 *
 * The details are read before `after()`, while the request is certainly
 * alive; only the send is deferred.
 */

export async function applySanction(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const userId = formData.get('userId') as string;
  const rawDays = formData.get('durationDays');
  const days = rawDays === null || rawDays === '' ? null : Number(rawDays);

  const result = await admin.applySanction({
    userId,
    action: formData.get('action'),
    reasonKey: formData.get('reasonKey'),
    reason: formData.get('reason'),
    durationDays: Number.isFinite(days) ? days : null,
    caseId: (formData.get('caseId') as string | null) || null,
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath('/admin/sanctions');
  revalidatePath('/admin/users');

  if (!result.ok) return { error: result.error, message: null };

  const sanctionId = result.data.sanctionId;
  const [sanctions, reasons] = await Promise.all([
    admin.listSanctions({ userId }),
    admin.sanctionReasons().catch(() => []),
  ]);

  const applied = sanctions.find((sanction) => sanction.id === sanctionId);
  const reason = applied ? reasons.find((entry) => entry.key === applied.reasonKey) : undefined;

  // A restriction recorded against an account that is already banned does not
  // change what the person can do, and an email saying "restricted" to
  // somebody who is banned would be true and misleading at once.
  const outranked =
    applied !== undefined &&
    sanctions.some(
      (sanction) =>
        sanction.id !== sanctionId &&
        sanction.isActive &&
        SEVERITY[sanction.action] > SEVERITY[applied.action],
    );

  if (applied && applied.userId && reason && !outranked) {
    const recipient = applied.userId;

    after(() =>
      notify({
        to: recipient,
        dedupe: `account_sanctioned:${sanctionId}`,
        message: {
          kind: 'account_sanctioned',
          action: applied.action,
          reasonLabel: reason.label,
          reasonDescription: reason.description,
          endsAt: applied.endsAt,
        },
      }),
    );
  }

  return { error: null, message: 'Sanction applied, and recorded.' };
}

export async function liftSanction(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const sanctionId = formData.get('sanctionId');
  const userId = (formData.get('userId') as string | null) || null;

  const result = await admin.liftSanction({
    sanctionId,
    reason: formData.get('reason'),
  });

  revalidatePath('/admin/sanctions');
  revalidatePath('/admin/users');
  if (userId) revalidatePath(`/admin/users/${userId}`);

  if (!result.ok) return { error: result.error, message: null };

  // The form's account id only says where to look. The sanction has to be
  // found on that account's own list, or nobody is written to.
  if (userId && typeof sanctionId === 'string') {
    const sanctions = await admin.listSanctions({ userId });
    const lifted = sanctions.find((sanction) => sanction.id === sanctionId);

    if (lifted && lifted.userId === userId) {
      const stillRestricted = sanctions.some(
        (sanction) => sanction.id !== sanctionId && sanction.isActive,
      );

      after(() =>
        notify({
          to: userId,
          dedupe: `account_sanction_lifted:${sanctionId}`,
          message: { kind: 'account_sanction_lifted', action: lifted.action, stillRestricted },
        }),
      );
    }
  }

  return { error: null, message: 'Sanction lifted. The record remains.' };
}
