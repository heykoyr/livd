import 'server-only';

import type {
  ModerationAction,
  ReviewInvestigation,
  ReviewReportEntry,
  ReviewVerificationEntry,
} from '@/types/domain';

/**
 * Review investigation.
 *
 * Reads, not writes — and deliberately not audited. A moderator opening the
 * review they were asked to look at is the job, and recording every glance
 * would bury the entries that matter under thousands that do not. What is
 * audited is crossing the identity boundary, which does not happen here: this
 * returns an account id and never an address.
 *
 * Acting on the review is a separate operation with its own reason and its own
 * audit entry, and lives in `moderation.ts`. Keeping the two apart is why the
 * page can show everything without any of it being one click from a removal.
 */

export async function readReviewInvestigation(reviewId: string): Promise<{
  review: ReviewInvestigation;
  verification: ReviewVerificationEntry[];
  reports: ReviewReportEntry[];
  history: ModerationAction[];
} | null> {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();

  const review = await repository.getReviewInvestigation(reviewId);
  if (!review) return null;

  const [verification, reports, history] = await Promise.all([
    repository.listReviewVerification(reviewId),
    repository.listReviewReports(reviewId),
    repository.listModerationActions(reviewId, 50),
  ]);

  return { review, verification, reports, history };
}
