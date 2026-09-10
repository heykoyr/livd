'use server';

import { createHash } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { copy } from '@/content/copy';
import { checkDualRateLimit } from '@/lib/safety/rate-limit';
import {
  VERIFICATION_LIMITS,
  isBlocked,
  runVerificationChecks,
} from '@/lib/safety/verification-checks';
import { AuthorisationError, requireRole, requireUser } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import { openVerificationEvidence } from '@/server/admin';
import { invalidateProperty } from '@/server/data/cache';
import type { ModerationActionState, VerificationSubmitState } from './action-state';
import { originIdentifier } from './reports';

/**
 * Residency verification.
 *
 * A resident offers a document; a moderator decides. Between the two sits
 * `runVerificationChecks`, which settles what a machine can settle so the human
 * minute goes on the judgement rather than the arithmetic.
 *
 * Three things this deliberately does not do:
 *
 *   - It never grants a level automatically. `verified_resident` multiplies a
 *     review's weight by 1.8, and nothing but a person decides to apply that.
 *   - It never reads the document. No OCR, no extraction. The file is hashed,
 *     stored where no client role can reach it, and shown to a moderator through
 *     a link measured in minutes.
 *   - Rejecting a request does not mark the review disputed. Failing to produce
 *     a tenancy agreement is not evidence of having lied, and conflating the two
 *     would punish everyone who moved house and threw the paperwork away.
 */

const submitSchema = z.object({
  reviewId: z.string().min(1).max(80),
  method: z.enum(['tenancy_agreement', 'utility_bill', 'correspondence', 'other']),
});

export async function submitVerificationEvidence(
  _previous: VerificationSubmitState,
  formData: FormData,
): Promise<VerificationSubmitState> {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return {
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
      message: null,
      checks: [],
    };
  }

  const parsed = submitSchema.safeParse({
    reviewId: formData.get('reviewId'),
    method: formData.get('method'),
  });
  if (!parsed.success) {
    return { error: copy.errors.validationTitle, message: null, checks: [] };
  }

  const limit = await checkDualRateLimit(
    'verificationSubmit',
    user.id,
    await originIdentifier(),
  );
  if (!limit.allowed) {
    return { error: copy.errors.rateLimitedBody, message: null, checks: [] };
  }

  const file = formData.get('evidence');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Attach the document you want to submit.', message: null, checks: [] };
  }

  // Read once. The size is checked against the same limit the bucket enforces,
  // before anything is held in memory for longer than it takes to hash.
  if (file.size > VERIFICATION_LIMITS.maxBytes) {
    return {
      error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${
        VERIFICATION_LIMITS.maxBytes / 1024 / 1024
      }MB.`,
      message: null,
      checks: [],
    };
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(data).digest('hex');

  const repository = await getRepository();
  const context = await repository.gatherVerificationContext({
    reviewId: parsed.data.reviewId,
    submitterId: user.id,
    evidenceSha256: sha256,
  });

  // Null covers both "no such review" and "not yours", deliberately: telling
  // the difference would let someone enumerate review ids.
  if (!context) {
    return { error: 'That review is not one you can verify.', message: null, checks: [] };
  }

  const existing = await repository.listVerificationsForReview(parsed.data.reviewId);
  if (existing.some((record) => record.outcome === 'pending')) {
    return {
      error: 'There is already a request waiting on this review.',
      message: null,
      checks: [],
    };
  }
  if (existing.some((record) => record.outcome === 'approved')) {
    return { error: 'This review is already verified.', message: null, checks: [] };
  }

  const checks = runVerificationChecks({
    ...context,
    file: { type: file.type, bytes: file.size },
  });

  if (isBlocked(checks)) {
    // Refused before anything is stored. The reasons go back to the person, in
    // the words the check was written in — a refusal nobody can act on is
    // indistinguishable from a bug.
    return {
      error: 'This cannot be submitted as it stands.',
      message: null,
      checks: checks.filter((check) => check.severity === 'blocking'),
    };
  }

  await repository.recordVerificationSubmission({
    reviewId: parsed.data.reviewId,
    submitterId: user.id,
    method: parsed.data.method,
    checks,
    file: { data, type: file.type, bytes: file.size, sha256 },
  });

  revalidatePath('/account/reviews');
  revalidatePath('/admin/verification');

  return {
    error: null,
    message:
      'Submitted. A moderator will look at it, and your review is unchanged in the meantime.',
    checks: [],
  };
}

/* -------------------------------------------------------------------------
 * The decision
 * ---------------------------------------------------------------------- */

const decideSchema = z.object({
  recordId: z.string().min(1).max(80),
  outcome: z.enum(['approved', 'rejected']),
  notes: z.string().trim().min(3, 'Record why, for the audit trail.').max(500),
});

export async function decideVerification(
  _previous: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  let actor;
  try {
    // Deciding a residency verification means reading the document, so it sits
    // behind the same boundary as opening one. A moderator can still triage the
    // queue — the automated checks, the claimed tenancy, whether a document
    // exists — which is the part that does not require seeing it.
    actor = await requireRole('trust_admin');
  } catch (error) {
    return {
      error:
        error instanceof AuthorisationError
          ? 'Deciding a residency verification requires Trust & Safety authorisation.'
          : copy.errors.genericBody,
      message: null,
    };
  }

  const parsed = decideSchema.safeParse({
    recordId: formData.get('recordId'),
    outcome: formData.get('outcome'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? copy.errors.validationTitle, message: null };
  }

  const repository = await getRepository();
  const pending = await repository.listPendingVerifications();
  const target = pending.find((entry) => entry.record.id === parsed.data.recordId);

  if (!target) {
    return { error: 'That request has already been decided.', message: null };
  }

  await repository.decideVerification(
    parsed.data.recordId,
    parsed.data.outcome,
    actor.id,
    parsed.data.notes,
  );

  // Approving changes the review's weight, so the property's score moves.
  if (parsed.data.outcome === 'approved') {
    await invalidateProperty(target.review.propertyId);
  }

  revalidatePath('/admin/verification');
  revalidatePath('/admin');

  return {
    error: null,
    message:
      parsed.data.outcome === 'approved'
        ? 'Verified. The review now carries more weight in the score.'
        : 'Rejected. The review is unchanged and still published.',
  };
}

/**
 * A short-lived link to one residency document.
 *
 * This used to be a `requireRole('moderator')` and a repository call, and it
 * wrote nothing anywhere. The audit found it: a signed URL to a document
 * carrying a name, an address and a signature — handed over by somebody whose
 * entire reason for handing it over was to stay anonymous — minted on a click,
 * with no record of who clicked or why.
 *
 * It now goes through the administrative layer, which refuses it without Trust
 * & Safety authorisation and a written reason, and writes the audit entry
 * before the link exists.
 *
 * Returning a shape rather than a bare string is deliberate: the caller has to
 * handle a refusal, so "no link" cannot be mistaken for "no document".
 */
export async function getVerificationEvidenceLink(
  recordId: string,
  reason: string,
): Promise<{ url: string } | { error: string }> {
  const result = await openVerificationEvidence({ recordId, reason });
  return result.ok ? { url: result.data.url } : { error: result.error };
}
