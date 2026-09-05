'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { copy } from '@/content/copy';
import { AuthorisationError, requireUser } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import type { SaveActionState } from './action-state';

/**
 * Saved properties — the shortlist.
 *
 * Private to the owner by Row Level Security. Nothing about what a person is
 * considering is ever visible to anyone else, including the property's owner:
 * a landlord learning who is researching them is an obvious way for this data
 * to hurt the people it is meant to serve.
 */

const propertyIdSchema = z.object({ propertyId: z.string().min(1).max(80) });

export async function toggleSavedProperty(
  previous: SaveActionState,
  formData: FormData,
): Promise<SaveActionState> {
  const parsed = propertyIdSchema.safeParse({ propertyId: formData.get('propertyId') });
  if (!parsed.success) {
    return { saved: previous.saved, error: copy.errors.genericBody };
  }

  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return {
      saved: previous.saved,
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
    };
  }

  const repository = await getRepository();
  const { propertyId } = parsed.data;

  // Read the stored state rather than trusting the client's idea of it, so a
  // stale tab cannot flip the wrong way.
  const currentlySaved = await repository.isPropertySaved(user.id, propertyId);

  if (currentlySaved) {
    await repository.unsaveProperty(user.id, propertyId);
  } else {
    await repository.saveProperty(user.id, propertyId);
  }

  revalidatePath('/shortlist');

  return { saved: !currentlySaved, error: null };
}

const noteSchema = z.object({
  propertyId: z.string().min(1).max(80),
  note: z.string().trim().max(500).nullable(),
});

export async function setShortlistNote(formData: FormData): Promise<void> {
  const parsed = noteSchema.safeParse({
    propertyId: formData.get('propertyId'),
    note: formData.get('note') || null,
  });
  if (!parsed.success) return;

  const user = await requireUser();
  const repository = await getRepository();

  await repository.setSavedPropertyNote(
    user.id,
    parsed.data.propertyId,
    parsed.data.note && parsed.data.note.length > 0 ? parsed.data.note : null,
  );

  revalidatePath('/shortlist');
}

export async function removeSavedProperty(formData: FormData): Promise<void> {
  const parsed = propertyIdSchema.safeParse({ propertyId: formData.get('propertyId') });
  if (!parsed.success) return;

  const user = await requireUser();
  const repository = await getRepository();

  await repository.unsaveProperty(user.id, parsed.data.propertyId);
  revalidatePath('/shortlist');
}
