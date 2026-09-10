'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import * as admin from '@/server/admin';
import type { ModerationActionState } from './action-state';

/**
 * Case actions.
 *
 * Thin adapters, like every other administrative Server Action in this
 * codebase: read the form, hand it to the layer, turn the result into a form
 * state. Authorisation, the business rules and the timeline entry all live
 * below, and the `livd_*_case` functions are what actually decide — each of
 * these could be called directly over HTTP and would give the same answer.
 */

function toState(result: { ok: boolean; error?: string }, message: string): ModerationActionState {
  if (!result.ok) return { error: result.error ?? 'Something went wrong.', message: null };
  return { error: null, message };
}

/**
 * Opens a case, usually from a report.
 *
 * Redirects to the new case on success, because the next thing anybody does
 * after opening one is work it — and a form that leaves you on the reports
 * page with a green message is a form you then have to go looking for.
 */
export async function openCase(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const result = await admin.openCase({
    category: formData.get('category'),
    summary: formData.get('summary'),
    fromReportId: (formData.get('reportId') as string | null) || null,
    reviewId: (formData.get('reviewId') as string | null) || null,
    priority: (formData.get('priority') as string | null) || null,
  });

  if (!result.ok) return { error: result.error, message: null };

  revalidatePath('/admin/reports');
  revalidatePath('/admin/cases');

  // Throws a control-flow exception; nothing after it runs.
  redirect(`/admin/cases/${result.data.caseId}`);
}

export async function assignCase(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const caseId = formData.get('caseId') as string;
  const raw = formData.get('assigneeId');

  const result = await admin.assignCase({
    caseId,
    // An empty select value means "nobody", which is a real choice rather than
    // a missing one.
    assigneeId: raw === '' || raw === null ? null : raw,
  });

  revalidatePath(`/admin/cases/${caseId}`);
  revalidatePath('/admin/cases');

  return toState(result, raw ? 'Case assigned.' : 'Case unassigned.');
}

export async function setCaseStatus(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const caseId = formData.get('caseId') as string;

  const result = await admin.setCaseStatus({
    caseId,
    status: formData.get('status'),
    outcome: (formData.get('outcome') as string | null) || null,
  });

  revalidatePath(`/admin/cases/${caseId}`);
  revalidatePath('/admin/cases');
  revalidatePath('/admin');

  return toState(result, 'Case updated.');
}

export async function setCasePriority(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const caseId = formData.get('caseId') as string;

  const result = await admin.setCasePriority({
    caseId,
    priority: formData.get('priority'),
    why: (formData.get('why') as string | null) || null,
  });

  revalidatePath(`/admin/cases/${caseId}`);
  revalidatePath('/admin/cases');

  return toState(result, 'Priority updated.');
}

export async function addCaseNote(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const caseId = formData.get('caseId') as string;

  const result = await admin.addCaseNote({
    caseId,
    body: formData.get('body'),
  });

  revalidatePath(`/admin/cases/${caseId}`);

  return toState(result, 'Note added.');
}

export async function setCasePreservation(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const caseId = formData.get('caseId') as string;
  const hold = formData.get('hold') === 'on' || formData.get('hold') === 'true';

  const result = await admin.setCasePreservation({
    caseId,
    hold,
    reason: formData.get('reason'),
  });

  revalidatePath(`/admin/cases/${caseId}`);

  return toState(result, hold ? 'Preservation hold applied.' : 'Preservation hold lifted.');
}
