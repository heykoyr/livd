'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { copy } from '@/content/copy';
import { AuthorisationError, requireRole } from '@/server/auth/guards';
import { changeUserRole } from '@/server/admin';
import { getRepository } from '@/server/data';
import { invalidateProperty } from '@/server/data/cache';
import type { ModerationActionState } from './action-state';

/**
 * Moderation.
 *
 * Every action here is guarded by `requireRole('moderator')` *and* by an RLS
 * policy on the table it touches. Neither is trusted alone.
 *
 * Two rules are structural rather than conventional:
 *
 *   - A review is never deleted. Its status changes, and the change is written
 *     to an append-only audit log with the actor, both statuses and a reason.
 *     A published record that can vanish without trace is not a record.
 *
 *   - Upholding a report does not by itself remove anything. Removal is a
 *     separate, deliberate decision, so a coordinated reporting campaign cannot
 *     mechanically take a review down.
 */

const reviewStatusSchema = z.object({
  reviewId: z.string().min(1).max(80),
  status: z.enum(['published', 'pending_moderation', 'held', 'removed']),
  reason: z.string().trim().min(3, 'Record why, for the audit trail.').max(500),
});

export async function setReviewStatus(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  let actor;
  try {
    actor = await requireRole('moderator');
  } catch (error) {
    return {
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
      message: null,
    };
  }

  const parsed = reviewStatusSchema.safeParse({
    reviewId: formData.get('reviewId'),
    status: formData.get('status'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? copy.errors.validationTitle, message: null };
  }

  const repository = await getRepository();
  const review = await repository.getReviewById(parsed.data.reviewId);
  if (!review) return { error: 'That review no longer exists.', message: null };

  await repository.setReviewStatus(
    parsed.data.reviewId,
    parsed.data.status,
    actor.id,
    parsed.data.reason,
  );

  // The property's aggregates change the moment a review's visibility does.
  await invalidateProperty(review.propertyId);
  revalidatePath('/admin/queue');
  revalidatePath('/admin/reports');

  return { error: null, message: `Review ${parsed.data.status.replace('_', ' ')}.` };
}

const verificationSchema = z.object({
  reviewId: z.string().min(1).max(80),
  level: z.enum(['unverified', 'verified_resident', 'disputed']),
});

export async function setReviewVerification(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  let actor;
  try {
    actor = await requireRole('moderator');
  } catch (error) {
    return {
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
      message: null,
    };
  }

  const parsed = verificationSchema.safeParse({
    reviewId: formData.get('reviewId'),
    level: formData.get('level'),
  });
  if (!parsed.success) return { error: copy.errors.validationTitle, message: null };

  const repository = await getRepository();
  const review = await repository.getReviewById(parsed.data.reviewId);
  if (!review) return { error: 'That review no longer exists.', message: null };

  await repository.setReviewVerification(parsed.data.reviewId, parsed.data.level, actor.id);

  // Verification changes a review's weight, so the score moves with it.
  await invalidateProperty(review.propertyId);
  revalidatePath('/admin/queue');

  return { error: null, message: 'Verification updated.' };
}

const resolveReportSchema = z.object({
  reportId: z.string().min(1).max(80),
  status: z.enum(['upheld', 'dismissed']),
  resolution: z.string().trim().min(3, 'Record why, for the audit trail.').max(500),
});

export async function resolveReport(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  let actor;
  try {
    actor = await requireRole('moderator');
  } catch (error) {
    return {
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
      message: null,
    };
  }

  const parsed = resolveReportSchema.safeParse({
    reportId: formData.get('reportId'),
    status: formData.get('status'),
    resolution: formData.get('resolution'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? copy.errors.validationTitle, message: null };
  }

  const repository = await getRepository();

  // Upholding records the decision. Removing the review is a separate action,
  // so reports cannot mechanically take content down.
  await repository.resolveReport(
    parsed.data.reportId,
    parsed.data.status,
    actor.id,
    parsed.data.resolution,
  );

  revalidatePath('/admin/reports');

  return {
    error: null,
    message:
      parsed.data.status === 'upheld'
        ? 'Report upheld. Remove the review separately if that is the right outcome.'
        : 'Report dismissed.',
  };
}

const claimDecisionSchema = z.object({
  claimId: z.string().min(1).max(80),
  status: z.enum(['approved', 'rejected']),
});

export async function decideClaim(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  let actor;
  try {
    actor = await requireRole('moderator');
  } catch (error) {
    return {
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
      message: null,
    };
  }

  const parsed = claimDecisionSchema.safeParse({
    claimId: formData.get('claimId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return { error: copy.errors.validationTitle, message: null };

  const repository = await getRepository();
  await repository.decideClaim(parsed.data.claimId, parsed.data.status, actor.id);

  revalidatePath('/admin/claims');
  return { error: null, message: `Claim ${parsed.data.status}.` };
}

/**
 * Grants a role.
 *
 * A thin adapter now: it reads the form, hands it to the administrative layer
 * and turns the result into a form state. Every check — that the caller is an
 * administrator, that they are not changing their own role, that a reason was
 * written, that this is not the last administrator — lives in
 * `src/server/admin/users.ts` and again in `livd_set_user_role`, which is the
 * one that actually decides.
 */
export async function setUserRole(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const result = await changeUserRole({
    userId: formData.get('userId'),
    role: formData.get('role'),
    reason: formData.get('reason'),
  });

  if (!result.ok) return { error: result.error, message: null };

  revalidatePath('/admin/users');
  return { error: null, message: 'Role updated.' };
}

/*
 * `setUserStatus` used to live here, and is gone.
 *
 * The sanction system replaced it: the same effect on an account's standing,
 * plus the category, the duration, the related case and the written reason that
 * make a decision reviewable six months later. It lives in
 * src/server/admin/sanctions.ts and calls `livd_apply_sanction`.
 *
 * `livd_set_user_status` stays in the database as the narrower path. It is what
 * 0020 built to close the "standing changed with no record" hole, and removing
 * it would take that guarantee with it — but nothing in the console calls it
 * any more, so the Server Action that exposed it is gone rather than left
 * sitting there as an endpoint nobody uses.
 */

/* -------------------------------------------------------------------------
 * Automated signals
 * ---------------------------------------------------------------------- */

const decideFlagSchema = z.object({
  flagId: z.string().min(1).max(120),
  status: z.enum(['reviewed', 'dismissed']),
});

/**
 * Records what a moderator decided about a burst-detection flag.
 *
 * Deciding a flag does nothing to the reviews behind it. If the pattern turns
 * out to be a campaign, each review is still held or removed one at a time,
 * with a written reason — the same path as any other moderation decision, and
 * the same audit trail. A signal is not evidence, and this action does not
 * pretend otherwise.
 */
export async function decidePropertyFlag(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  let actor;
  try {
    actor = await requireRole('moderator');
  } catch (error) {
    return {
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
      message: null,
    };
  }

  const parsed = decideFlagSchema.safeParse({
    flagId: formData.get('flagId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return { error: copy.errors.validationTitle, message: null };

  const repository = await getRepository();
  await repository.decidePropertyFlag(parsed.data.flagId, parsed.data.status, actor.id);

  revalidatePath('/admin/flags');
  revalidatePath('/admin');

  return {
    error: null,
    message:
      parsed.data.status === 'dismissed'
        ? 'Dismissed. It will not be raised again for a week.'
        : 'Marked as looked at.',
  };
}
