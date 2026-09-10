'use server';

import { revalidatePath } from 'next/cache';

import * as admin from '@/server/admin';
import type { ModerationActionState } from './action-state';

/**
 * Sanction actions.
 *
 * Thin adapters onto the administrative layer. The tier required rises with
 * severity and is decided in the database — `livd_apply_sanction` refuses a
 * suspension from a moderator and a ban from anyone but an administrator,
 * whatever this function was asked to do.
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
  return { error: null, message: 'Sanction applied, and recorded.' };
}

export async function liftSanction(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const result = await admin.liftSanction({
    sanctionId: formData.get('sanctionId'),
    reason: formData.get('reason'),
  });

  revalidatePath('/admin/sanctions');
  revalidatePath('/admin/users');

  if (!result.ok) return { error: result.error, message: null };
  return { error: null, message: 'Sanction lifted. The record remains.' };
}
