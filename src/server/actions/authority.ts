'use server';

import { revalidatePath } from 'next/cache';

import * as admin from '@/server/admin';
import type { ModerationActionState } from './action-state';

/**
 * Authority request actions.
 *
 * Thin adapters onto the administrative layer, and — like everything in this
 * area — they record rather than disclose. Nothing reachable from here gathers
 * or transmits the information a request asks for.
 */

export async function openAuthorityRequest(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const result = await admin.openAuthorityRequest({
    requestingAuthority: formData.get('requestingAuthority'),
    jurisdiction: formData.get('jurisdiction'),
    requestType: formData.get('requestType'),
    requestedInformation: formData.get('requestedInformation'),
    externalReference: (formData.get('externalReference') as string | null) || null,
    legalBasis: (formData.get('legalBasis') as string | null) || null,
    documentationReceived: formData.get('documentationReceived') === 'on',
    subjectUserId: (formData.get('subjectUserId') as string | null) || null,
    caseId: (formData.get('caseId') as string | null) || null,
  });

  revalidatePath('/admin/authority-requests');

  if (!result.ok) return { error: result.error, message: null };
  return { error: null, message: 'Request recorded. Nothing has been disclosed.' };
}

export async function decideAuthorityRequest(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const raw = formData.get('documentationReceived');

  const result = await admin.decideAuthorityRequest({
    requestId: formData.get('requestId'),
    status: formData.get('status'),
    decision: (formData.get('decision') as string | null) || null,
    documentationReceived: raw === null ? null : raw === 'on',
  });

  revalidatePath('/admin/authority-requests');

  if (!result.ok) return { error: result.error, message: null };
  return { error: null, message: 'Request updated.' };
}

/**
 * Records a disclosure that a person made.
 *
 * The fields arrive as a comma-separated list because naming them one at a time
 * is the point — there is no "all account data" option, and there is not going
 * to be one.
 */
export async function recordDisclosure(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const fields = String(formData.get('disclosedFields') ?? '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);

  const result = await admin.recordDisclosure({
    requestId: formData.get('requestId'),
    disclosedFields: fields,
    disclosedTo: formData.get('disclosedTo'),
    method: formData.get('method'),
    notes: (formData.get('notes') as string | null) || null,
  });

  revalidatePath('/admin/authority-requests');

  if (!result.ok) return { error: result.error, message: null };
  return { error: null, message: 'Disclosure recorded.' };
}
