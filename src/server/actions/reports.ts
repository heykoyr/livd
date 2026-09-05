'use server';

import { headers } from 'next/headers';

import { copy } from '@/content/copy';
import { checkDualRateLimit } from '@/lib/safety/rate-limit';
import { reportSchema } from '@/lib/validation/review';
import type { ReportActionState } from './action-state';
import { AuthorisationError, requireUser } from '@/server/auth/guards';
import { getRepository } from '@/server/data';

/**
 * Reporting a review.
 *
 * Reporting is the cheapest action on the platform to abuse — it costs nothing
 * and, if it silently removed content, would hand anyone a veto over reviews
 * they dislike. So a report does exactly one thing: it opens a moderation item.
 * It never changes a review's status, and the reviewer is never told who
 * reported them.
 */

export async function submitReport(
  _previous: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
    };
  }

  const parsed = reportSchema.safeParse({
    reviewId: formData.get('reviewId'),
    reason: formData.get('reason'),
    detail: formData.get('detail') || null,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      error: parsed.error.issues[0]?.message ?? copy.errors.validationTitle,
    };
  }

  const origin = await originIdentifier();
  const limit = await checkDualRateLimit('reportSubmit', user.id, origin);
  if (!limit.allowed) {
    return { status: 'error', error: copy.errors.rateLimitedBody };
  }

  const repository = await getRepository();

  const review = await repository.getReviewById(parsed.data.reviewId);
  if (!review || review.status === 'removed') {
    return { status: 'error', error: copy.errors.removedBody };
  }

  // Reporting your own review is almost always a misunderstanding of the
  // control; the edit window is what that person actually wants.
  if (review.authorId === user.id) {
    return {
      status: 'error',
      error: 'This is your own review. You can correct it from your account instead.',
    };
  }

  await repository.createReport({
    reviewId: parsed.data.reviewId,
    reporterId: user.id,
    reason: parsed.data.reason,
    detail: parsed.data.detail,
  });

  return { status: 'success', error: null };
}

/**
 * A coarse origin signal for rate limiting.
 *
 * Hashed with a per-deployment salt before it is ever stored — see
 * `hashActor` in `src/lib/safety/rate-limit.ts`.
 */
export async function originIdentifier(): Promise<string> {
  const headerList = await headers();
  return (
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    'unknown'
  );
}
