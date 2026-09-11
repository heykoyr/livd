'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';

import * as admin from '@/server/admin';
import { getRepository } from '@/server/data';
import { notifyStaff } from '@/server/notify';
import type { CasePriority } from '@/types/domain';
import type { ModerationActionState } from './action-state';

/**
 * When a case is worth an email.
 *
 * Not on every case. A case is opened from a report several times a week and
 * the console is where that work is picked up; mailing every moderator each
 * time would train them to filter the address, and then the one that matters
 * arrives in the same folder as the rest.
 *
 * High and critical are different. Those are the two that mean "this is not
 * waiting for the next time somebody opens the queue", and they are set
 * deliberately by a person who has decided exactly that.
 */
const URGENT: CasePriority[] = ['high', 'critical'];

/**
 * Reads the case back so the email can name it.
 *
 * Done before `after` rather than inside it, so the read happens while the
 * request's own session is unambiguously available. A reference — LV-1048 —
 * is the difference between an email somebody can act on from a phone and
 * one that only says a case exists somewhere.
 */
async function notifyAboutUrgentCase(caseId: string): Promise<void> {
  const repository = await getRepository();
  const summary = await repository.getCase(caseId);
  if (!summary || !URGENT.includes(summary.priority)) return;

  const { reference, priority } = summary;
  const text = summary.summary;

  after(async () => {
    await notifyStaff({
      minRole: 'trust_admin',
      // Keyed on the priority as well as the case, so raising one to
      // critical after it was already high sends the second escalation and
      // re-raising it to the same level does not.
      dedupe: `case_${priority}:${caseId}`,
      message: { kind: 'staff_case_opened', reference, caseId, priority, summary: text },
    });
  });
}

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

  await notifyAboutUrgentCase(result.data.caseId);

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

  if (result.ok) await notifyAboutUrgentCase(caseId);

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
