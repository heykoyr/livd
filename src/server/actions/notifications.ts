'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { copy } from '@/content/copy';
import { AuthorisationError, requireUser } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import type { PreferencesState } from './action-state';

/**
 * Notification preferences.
 *
 * Three switches, and a deliberate refusal to build a fourth. They correspond
 * to the three reasons Livd would ever write to somebody; anything that does
 * not fit one of them should have to argue for its own existence rather than
 * quietly appearing as a row in a settings screen nobody reads.
 *
 * Two kinds of message are not governed by any of them, and the page says so
 * rather than offering a switch that would be a lie. A decision about your own
 * content — your review was removed, your claim was refused — reaches you
 * whatever you have turned off, because the alternative is a platform that can
 * take your writing down and is under no obligation to mention it. Operational
 * mail to staff follows the role, not a preference.
 *
 * The write runs as the person themselves. Migration 0044 grants UPDATE on
 * exactly these three columns to `authenticated`, and `profiles_update_own`
 * narrows it to their own row — so this action holds no power the person does
 * not already have, and the 0020 trigger still refuses any change to `role` or
 * `status` from any role including the service one.
 */

/*
 * The state shape lives in `action-state.ts` with every other one, and not
 * here. A `'use server'` module may export nothing but async functions —
 * Next rejects the file outright otherwise, at runtime rather than at build,
 * with "A 'use server' file can only export async functions, found object".
 */

const schema = z.object({
  reviewUpdates: z.boolean(),
  propertyResponses: z.boolean(),
  trustSafety: z.boolean(),
});

export async function saveNotificationPreferences(
  _previous: PreferencesState,
  formData: FormData,
): Promise<PreferencesState> {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
    };
  }

  // An unchecked checkbox sends nothing at all, which is the difference
  // between "off" and "absent" — and reading it as absent would make every
  // save turn everything on.
  const parsed = schema.safeParse({
    reviewUpdates: formData.get('reviewUpdates') === 'on',
    propertyResponses: formData.get('propertyResponses') === 'on',
    trustSafety: formData.get('trustSafety') === 'on',
  });

  if (!parsed.success) {
    return { status: 'error', error: copy.errors.validationTitle };
  }

  try {
    const repository = await getRepository();
    await repository.setNotificationPreferences(user.id, parsed.data);
  } catch (error) {
    console.error('[livd] notification preferences could not be saved', error);
    return { status: 'error', error: copy.errors.genericBody };
  }

  revalidatePath('/account/notifications');
  return { status: 'saved', error: null };
}
