import 'server-only';

import { z } from 'zod';

import { fromDatabaseError, refused } from './errors';
import { runAdminAction, type AdminResult } from './run';

/**
 * Evidence.
 *
 * The audit found the hole this file closes: `createVerificationEvidenceLink`
 * minted a signed URL to a tenancy agreement — a document carrying a name, an
 * address and a signature, handed over by somebody whose entire reason for
 * handing it over was to stay anonymous — and wrote nothing anywhere. Not
 * because anybody decided reading it did not matter, but because auditing was
 * each repository method's own business and that one had never been given the
 * job.
 *
 * Opening a residency document now requires Trust & Safety authorisation and a
 * written reason, and the access is recorded before the link is minted.
 *
 * WHY IT MOVED ABOVE MODERATOR
 *
 * A moderator moderates content. A tenancy agreement is not content — it is the
 * single most identifying artefact in the system, and reading one tells you who
 * wrote a review as surely as reading the email address does. Putting it behind
 * the same boundary as the identity reveal is the only consistent place for it.
 *
 * The cost is real and worth stating: deciding a residency verification means
 * reading the document, so that decision moves above moderator too. The
 * verification queue stays visible to moderators — the automated checks, the
 * claimed tenancy, whether a document exists — so triage is unaffected. Only
 * the two acts that require seeing the document are gated.
 */

const linkSchema = z.object({
  recordId: z.string().min(1).max(80),
  reason: z.string().trim().min(3, 'Record why, for the audit trail.').max(500),
});

/**
 * A short-lived link to one residency document.
 *
 * The audit entry is written by `runAdminAction` before the link is returned,
 * and the layer refuses the action outright without a reason — so there is no
 * path that produces a URL without a record naming who asked for it and why.
 */
export async function openVerificationEvidence(
  raw: unknown,
): Promise<AdminResult<{ url: string }>> {
  return runAdminAction<z.infer<typeof linkSchema>, { url: string }>(
    {
      action: 'verification_evidence_accessed',
      requires: 'trust_admin',
      schema: linkSchema,
      subject: (input) => ({ type: 'verification', id: input.recordId }),
      reason: (input) => input.reason,

      run: async ({ repository }, input) => {
        const url = await repository
          .createVerificationEvidenceLink(input.recordId)
          .catch((error: unknown) => {
            throw fromDatabaseError(error, 'That document could not be opened.');
          });

        if (!url) throw refused('That document could not be retrieved.');

        return { url };
      },
    },
    raw,
  );
}

const addSchema = z.object({
  caseId: z.string().min(1).max(80),
  kind: z.enum(['file', 'link', 'note', 'review_snapshot']),
  title: z.string().trim().min(1, 'Evidence needs a title.').max(200),
  description: z.string().trim().max(2000).nullable().default(null),
  supersedes: z.string().max(80).nullable().default(null),
});

/**
 * Attaches evidence to a case.
 *
 * Immutable once written. A correction is a new version pointing at the one it
 * replaces, and both remain readable — evidence that can be edited is evidence
 * somebody can quietly improve once the outcome is known.
 */
export async function addCaseEvidence(raw: unknown): Promise<AdminResult<{ evidenceId: string }>> {
  return runAdminAction<z.infer<typeof addSchema>, { evidenceId: string }>(
    {
      action: 'evidence_added',
      requires: 'moderator',
      schema: addSchema,
      subject: (input) => ({ type: 'case', id: input.caseId }),
      detail: (input, output) => ({
        kind: input.kind,
        evidenceId: output?.evidenceId ?? null,
        supersedes: input.supersedes,
      }),

      run: async ({ actor, repository }, input) => {
        try {
          const evidenceId = await repository.addCaseEvidence({
            caseId: input.caseId,
            kind: input.kind,
            title: input.title,
            description: input.description,
            supersedes: input.supersedes,
            actorId: actor.id,
          });

          return { evidenceId };
        } catch (error) {
          throw fromDatabaseError(error, 'That evidence could not be added.');
        }
      },
    },
    raw,
  );
}

const withdrawSchema = z.object({
  evidenceId: z.string().min(1).max(80),
  reason: z.string().trim().min(3, 'Record why, for the audit trail.').max(500),
});

/** Withdraws evidence. Marks the row; never removes it. */
export async function withdrawCaseEvidence(raw: unknown): Promise<AdminResult<null>> {
  return runAdminAction<z.infer<typeof withdrawSchema>, null>(
    {
      action: 'evidence_withdrawn',
      requires: 'moderator',
      schema: withdrawSchema,
      subject: (input) => ({ type: 'evidence', id: input.evidenceId }),
      reason: (input) => input.reason,

      run: async ({ actor, repository }, input) => {
        try {
          await repository.withdrawCaseEvidence(input.evidenceId, input.reason, actor.id);
          return null;
        } catch (error) {
          throw fromDatabaseError(error, 'That evidence could not be withdrawn.');
        }
      },
    },
    raw,
  );
}

/**
 * The preserved copies of one review.
 *
 * Not audited. Reading what a review used to say is the ordinary work of an
 * investigation, and it identifies nobody — the snapshot holds the content, not
 * its author.
 */
export async function reviewSnapshots(reviewId: string) {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();
  return repository.listReviewSnapshots(reviewId);
}

/** Evidence attached to a case. The rows, never the storage keys. */
export async function caseEvidence(caseId: string) {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();
  return repository.listCaseEvidence(caseId);
}
