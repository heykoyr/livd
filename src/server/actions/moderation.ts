'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { copy } from '@/content/copy';
import { AuthorisationError, hasRole, requireRole } from '@/server/auth/guards';
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

const roleSchema = z.object({
  userId: z.string().min(1).max(80),
  role: z.enum(['resident', 'owner', 'moderator', 'trust_admin', 'admin']),
  reason: z.string().trim().min(3, 'Record why, for the audit trail.').max(500),
});

/**
 * Grants a role.
 *
 * The guard here is the first of three, and the weakest — it decides what this
 * form is allowed to attempt. The database decides what actually happens:
 * `livd_set_user_role` reads the actor from the session rather than from
 * anything this function passes, so a request that reaches PostgREST directly
 * is judged by exactly the same rules. Every check below is repeated there,
 * which is why they can be relied on.
 */
export async function setUserRole(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  let actor;
  try {
    // Granting roles is an administrator's power, not a moderator's.
    actor = await requireRole('admin');
  } catch (error) {
    return {
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
      message: null,
    };
  }

  const parsed = roleSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? copy.errors.validationTitle, message: null };
  }

  if (parsed.data.userId === actor.id) {
    return { error: 'You cannot change your own role.', message: null };
  }

  const repository = await getRepository();

  try {
    await repository.setUserRole(
      parsed.data.userId,
      parsed.data.role,
      actor.id,
      parsed.data.reason,
    );
  } catch (error) {
    // The database is the authority on whether this was allowed, and its
    // refusals are written to be read by a person.
    return { error: refusalMessage(error), message: null };
  }

  revalidatePath('/admin/users');
  return { error: null, message: 'Role updated.' };
}

const statusSchema = z.object({
  userId: z.string().min(1).max(80),
  status: z.enum(['active', 'restricted', 'suspended']),
  reason: z.string().trim().min(3, 'Record why, for the audit trail.').max(500),
});

/**
 * Changes an account's standing.
 *
 * Separate from anything that happens to what the account wrote: suspending
 * someone does not touch their reviews, and removing a review does not touch
 * their account. Phase 8 wraps this in a sanction record carrying duration and
 * a related case; the authorisation rules already live in the database.
 */
export async function setUserStatus(
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

  const parsed = statusSchema.safeParse({
    userId: formData.get('userId'),
    status: formData.get('status'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? copy.errors.validationTitle, message: null };
  }

  if (parsed.data.userId === actor.id) {
    return { error: 'You cannot change your own standing.', message: null };
  }

  // Suspension is a Trust & Safety decision. Checked here so the form can say
  // so plainly, and checked again in the database, which is what decides.
  if (parsed.data.status === 'suspended' && !hasRole(actor, 'trust_admin')) {
    return {
      error: 'Suspending an account requires Trust & Safety authorisation.',
      message: null,
    };
  }

  const repository = await getRepository();

  try {
    await repository.setUserStatus(
      parsed.data.userId,
      parsed.data.status,
      actor.id,
      parsed.data.reason,
    );
  } catch (error) {
    return { error: refusalMessage(error), message: null };
  }

  revalidatePath('/admin/users');
  return { error: null, message: 'Account standing updated.' };
}

/**
 * Turns a database refusal into something a moderator can act on.
 *
 * The messages raised by `livd_set_user_role` and `livd_set_user_status` are
 * written for a person to read, so they are passed through. Anything else —
 * a connection failure, a constraint nobody anticipated — is not, because an
 * unexpected error message is where internal detail leaks.
 */
function refusalMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';

  const recognised = [
    'Only an administrator may change a role',
    'Only a moderator may change an account standing',
    'Only an administrator may act on a privileged account',
    'Suspending an account requires Trust and Safety authorisation',
    'You cannot change your own role',
    'You cannot change your own standing',
    'A reason is required, for the audit trail',
    'This is the last administrator and cannot be demoted',
    'No such account',
  ];

  const match = recognised.find((message) => raw.includes(message));
  return match ? `${match}.` : copy.errors.genericBody;
}

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
