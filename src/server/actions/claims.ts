'use server';

import { copy } from '@/content/copy';
import { lintContent } from '@/lib/safety/content-linter';
import { checkDualRateLimit } from '@/lib/safety/rate-limit';
import { claimSchema, ownerResponseSchema } from '@/lib/validation/review';
import { AuthorisationError, requireUser } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import { invalidateProperty } from '@/server/data/cache';
import type { ClaimActionState, OwnerResponseState } from './action-state';
import { originIdentifier } from './reports';

/**
 * Property claims and owner responses.
 *
 * Claiming a property grants exactly two things: the ability to correct factual
 * details, and one public reply per review. It grants nothing over the reviews
 * themselves — there is no column and no policy anywhere in the schema that
 * would let a claimant change a review's status.
 *
 * Owner responses go through the same content linter as reviews. A landlord
 * naming a former tenant in a reply is the most predictable way this feature
 * gets abused, and it is exactly what the named-individual rule catches.
 */

export async function submitClaim(
  _previous: ClaimActionState,
  formData: FormData,
): Promise<ClaimActionState> {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
      fieldErrors: {},
    };
  }

  const limit = await checkDualRateLimit('claimSubmit', user.id, await originIdentifier());
  if (!limit.allowed) {
    return { status: 'error', error: copy.errors.rateLimitedBody, fieldErrors: {} };
  }

  const parsed = claimSchema.safeParse({
    propertyId: formData.get('propertyId'),
    roleClaimed: formData.get('roleClaimed'),
    organisation: formData.get('organisation') || null,
    contactEmail: formData.get('contactEmail'),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return { status: 'error', error: copy.errors.validationTitle, fieldErrors };
  }

  const repository = await getRepository();

  const property = await repository.getPropertyById(parsed.data.propertyId);
  if (!property) {
    return { status: 'error', error: copy.errors.propertyNotFoundBody, fieldErrors: {} };
  }

  const existing = await repository.getApprovedClaim(property.id);
  if (existing) {
    return {
      status: 'error',
      error: 'This property has already been claimed. Contact us if that is wrong.',
      fieldErrors: {},
    };
  }

  // A claimant may not also be a reviewer of the same property. Checked here so
  // the conflict is caught before a moderator spends time on the claim.
  const ownReviews = await repository.listReviewsByAuthor(user.id);
  if (ownReviews.some((review) => review.propertyId === property.id)) {
    return {
      status: 'error',
      error:
        'You have reviewed this property as a resident, so you cannot also claim it. Contact us if you believe that is wrong.',
      fieldErrors: {},
    };
  }

  await repository.createClaim({
    propertyId: property.id,
    claimantId: user.id,
    roleClaimed: parsed.data.roleClaimed,
    organisation: parsed.data.organisation,
    contactEmail: parsed.data.contactEmail,
  });

  return { status: 'submitted', error: null, fieldErrors: {} };
}

export async function submitOwnerResponse(
  _previous: OwnerResponseState,
  formData: FormData,
): Promise<OwnerResponseState> {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
    };
  }

  const limit = await checkDualRateLimit('ownerResponse', user.id, await originIdentifier());
  if (!limit.allowed) {
    return { status: 'error', error: copy.errors.rateLimitedBody };
  }

  const parsed = ownerResponseSchema.safeParse({
    reviewId: formData.get('reviewId'),
    body: formData.get('body'),
    isResolutionNotice: formData.get('isResolutionNotice') === 'on',
  });

  if (!parsed.success) {
    return { status: 'error', error: parsed.error.issues[0]?.message ?? copy.errors.validationTitle };
  }

  // The same rules apply to a landlord's reply as to a resident's review.
  const safety = lintContent(parsed.data.body);
  if (!safety.ok) {
    const codes = new Set(safety.blocks.map((issue) => issue.code));
    return {
      status: 'error',
      error: codes.has('named_individual')
        ? copy.safety.namedIndividual
        : codes.has('contact_details')
          ? copy.safety.contactDetails
          : copy.safety.blockedTitle,
    };
  }

  const repository = await getRepository();
  const review = await repository.getReviewById(parsed.data.reviewId);
  if (!review) return { status: 'error', error: copy.errors.removedBody };

  try {
    await repository.createOwnerResponse({
      reviewId: parsed.data.reviewId,
      responderId: user.id,
      body: parsed.data.body,
      isResolutionNotice: parsed.data.isResolutionNotice,
    });
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : copy.errors.genericBody,
    };
  }

  await invalidateProperty(review.propertyId);
  return { status: 'published', error: null };
}
