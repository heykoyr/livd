'use server';

import { revalidatePath } from 'next/cache';

import { revealIdentity } from '@/server/admin';
import type { IdentityRevealState } from './action-state';

/**
 * Revealing an account identity.
 *
 * A thin adapter, like the other administrative actions: it reads the form,
 * hands it to the layer and turns the result into a form state. The
 * authorisation, the reason rules and the audit entry all live below it, and
 * `livd_reveal_user_identity` is what actually decides — this function could be
 * called directly over HTTP and would give exactly the same answer.
 *
 * The address comes back in the action's return value rather than being written
 * into the page. It is never server-rendered, never cached and never stored, so
 * a screenshot or a tab left open overnight is the only way it persists at all —
 * which is a decision made by the person looking at it rather than by the
 * system.
 */
export async function revealAccountIdentity(
  _previous: IdentityRevealState,
  formData: FormData,
): Promise<IdentityRevealState> {
  const result = await revealIdentity({
    userId: formData.get('userId'),
    reasonKey: formData.get('reasonKey'),
    reasonDetail: (formData.get('reasonDetail') as string | null) || null,
    caseReference: (formData.get('caseReference') as string | null) || null,
  });

  if (!result.ok) {
    return { status: 'error', error: result.error, email: null, auditEntryId: null };
  }

  // So the access history on the page picks up the entry that was just written.
  revalidatePath(`/admin/users/${result.data.accountId}`);

  return {
    status: 'revealed',
    error: null,
    email: result.data.email,
    auditEntryId: result.data.auditEntryId,
  };
}
