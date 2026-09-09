'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { copy } from '@/content/copy';
import { checkDualRateLimit } from '@/lib/safety/rate-limit';
import { AuthorisationError, requireUser } from '@/server/auth/guards';
import { destroySession } from '@/server/auth/session';
import { getRepository } from '@/server/data';
import type { DeleteAccountState } from './action-state';
import { originIdentifier } from './reports';

/**
 * Deleting a Livd account.
 *
 * The published promise, on all three legal pages, is that the account goes and
 * the reviews stay — permanently severed from the person who wrote them. The
 * reasoning is that a property record other renters rely on is not a record if
 * it can be withdrawn later.
 *
 * Until migration 0017 the schema did the opposite, and account deletion was
 * not implemented at all, so nothing had yet exposed the contradiction. Both
 * halves are fixed together: the database now severs where the pages say it
 * severs, and this is the path that actually performs it.
 *
 * Three things this deliberately does:
 *
 *   - It asks the person to type a word. Not a dark pattern in reverse — the
 *     action is irreversible and unattributable afterwards, and a stray click
 *     on a button labelled "delete" is not consent to that.
 *
 *   - It destroys residency documents before it removes the account, because a
 *     cascade deletes the row that names the file and not the file itself. The
 *     repository refuses to continue if the storage removal fails.
 *
 *   - It reports what actually happened rather than a generic success. Somebody
 *     deleting an account is entitled to know that four of their reviews are
 *     still on the site, unattributable, because that is what they were
 *     promised and it is the part people are surprised by.
 */

const deleteSchema = z.object({
  // The literal word, in the user's own hand. Case-insensitive because the
  // point is deliberateness, not typing accuracy.
  confirmation: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => value === 'DELETE', {
      message: copy.account.deleteConfirmMismatch,
    }),
});

export async function deleteAccount(
  _previous: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
      summary: null,
    };
  }

  // Tight, and by origin as well as by account. Deletion is irreversible, so
  // repeated attempts are worth slowing down whatever is making them.
  const limit = await checkDualRateLimit('accountDelete', user.id, await originIdentifier());
  if (!limit.allowed) {
    return { status: 'error', error: copy.errors.rateLimitedBody, summary: null };
  }

  const parsed = deleteSchema.safeParse({ confirmation: formData.get('confirmation') });
  if (!parsed.success) {
    return {
      status: 'error',
      error: parsed.error.issues[0]?.message ?? copy.account.deleteConfirmMismatch,
      summary: null,
    };
  }

  const repository = await getRepository();

  let summary;
  try {
    summary = await repository.deleteAccount(user.id);
  } catch (error) {
    // The most likely cause is the evidence removal refusing, which is the one
    // failure worth stopping for: the account is intact and can be deleted
    // again once storage is reachable.
    console.error('[livd] account deletion failed', error);
    return { status: 'error', error: copy.account.deleteFailed, summary: null };
  }

  // The account is gone; the cookie in this browser is not. Clearing it is what
  // makes the deletion visible to the person who just asked for it, and it
  // avoids a session pointing at a user id that no longer resolves.
  await destroySession();

  return { status: 'deleted', error: null, summary };
}

/**
 * Where someone lands afterwards.
 *
 * A separate action rather than a redirect inside the one above, so the
 * confirmation — what stayed, what went — can be shown before the browser
 * moves on. `redirect` throws, and throwing past a summary the person has not
 * read yet would defeat the point of producing one.
 */
export async function finishAccountDeletion(): Promise<void> {
  redirect('/?farewell=1');
}
