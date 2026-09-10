'use server';

import { revalidatePath } from 'next/cache';

import { decideAccountSignal, investigateSignal } from '@/server/admin';
import type { ModerationActionState } from './action-state';

/**
 * Signal actions.
 *
 * Thin, like every action in this directory. Every check lives in
 * `src/server/admin/signals.ts` and again in the database, which is the one
 * that decides.
 */

export async function decideSignal(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const result = await decideAccountSignal({
    signalId: formData.get('signalId'),
    status: formData.get('status'),
  });

  if (!result.ok) return { error: result.error, message: null };

  revalidatePath('/admin/flags');
  revalidatePath('/admin');

  return { error: null, message: 'Signal decided. Nothing about the account changed.' };
}

export async function openCaseFromSignal(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const result = await investigateSignal({
    signalKind: formData.get('signalKind'),
    signalId: formData.get('signalId'),
    why: formData.get('why'),
  });

  if (!result.ok) return { error: result.error, message: null };

  revalidatePath('/admin/flags');
  revalidatePath('/admin/cases');
  revalidatePath('/admin');

  return {
    error: null,
    message: 'A case is open. The numbers behind the signal are on its timeline.',
  };
}
