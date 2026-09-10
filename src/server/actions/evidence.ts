'use server';

import { revalidatePath } from 'next/cache';

import * as admin from '@/server/admin';
import type { ModerationActionState } from './action-state';

/**
 * Evidence actions.
 *
 * Thin adapters onto the administrative layer, like every other administrative
 * Server Action here. The authorisation, the versioning rule and the timeline
 * entry live below; `livd_add_case_evidence` and `livd_withdraw_case_evidence`
 * are what actually decide.
 */

export async function addCaseEvidence(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const caseId = formData.get('caseId') as string;

  const result = await admin.addCaseEvidence({
    caseId,
    kind: formData.get('kind'),
    title: formData.get('title'),
    description: (formData.get('description') as string | null) || null,
    supersedes: (formData.get('supersedes') as string | null) || null,
  });

  revalidatePath(`/admin/cases/${caseId}`);

  if (!result.ok) return { error: result.error, message: null };
  return { error: null, message: 'Evidence added.' };
}

/**
 * Withdraws evidence.
 *
 * Marks the row; never removes it. Evidence that can disappear is evidence
 * somebody can make disappear once the outcome is known.
 */
export async function withdrawCaseEvidence(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const caseId = formData.get('caseId') as string;

  const result = await admin.withdrawCaseEvidence({
    evidenceId: formData.get('evidenceId'),
    reason: formData.get('reason'),
  });

  revalidatePath(`/admin/cases/${caseId}`);

  if (!result.ok) return { error: result.error, message: null };
  return { error: null, message: 'Evidence withdrawn. The record remains.' };
}
