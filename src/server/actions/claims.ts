'use server';

import { after } from 'next/server';

import { copy } from '@/content/copy';
import { propertyDisplayName } from '@/lib/format';
import { lintContent } from '@/lib/safety/content-linter';
import { checkDualRateLimit } from '@/lib/safety/rate-limit';
import { claimSchema, ownerResponseSchema } from '@/lib/validation/review';
import { AuthorisationError, requireUser } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import { invalidateProperty } from '@/server/data/cache';
import { notify, notifyStaff } from '@/server/notify';
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

  const claim = await repository.createClaim({
    propertyId: property.id,
    claimantId: user.id,
    roleClaimed: parsed.data.roleClaimed,
    organisation: parsed.data.organisation,
    contactEmail: parsed.data.contactEmail,
  });

  /* --- Tell whoever decides claims ----------------------------------- */

  // Claims are rare and each one is a decision with a written reason on both
  // sides, so this is the opposite of noise — it is a queue that would
  // otherwise sit unread for a week. The claimant is not named: who is
  // asking is on the claim, and the claim is read in the console.
  const propertyName = propertyDisplayName(property.address);
  const organisation = parsed.data.organisation;
  const claimId = claim.id;

  after(async () => {
    await notifyStaff({
      minRole: 'moderator',
      dedupe: `claim_submitted:${claimId}`,
      message: { kind: 'staff_claim_submitted', propertyName, organisation },
    });
  });

  return { status: 'submitted', error: null, fieldErrors: {} };
}

/**
 * A property's public reply to a review.
 *
 * This action has existed since the claim system was built and nothing has
 * ever called it. The property page had no form, the account area had no
 * owner view, and `for-owners` described a capability that could not be
 * reached — so "I claimed my property and cannot reply" was not a permission
 * bug at all. It was a feature with a server and no front door.
 *
 * Two things are added here now that there is one.
 *
 * **An authorisation check before the database's.** RLS is still what makes
 * the rule true — `owner_responses_insert` requires `livd_owns_property` and
 * would refuse this write from a Server Action holding the service key. But
 * a policy refusal arrives as a generic PostgREST error, and a property
 * manager who is told "something went wrong" learns nothing about whether
 * their claim was approved. Checking first turns that into a sentence. The
 * check never replaces the policy; it only produces a better message than the
 * policy can.
 *
 * **Published reviews only.** A reply to a review that is held or removed
 * would sit on a page nobody can see, and would tell a claimant something
 * about the moderation state of content the platform has not published.
 *
 * What a claimant still cannot do is unchanged, and none of it is enforced
 * here — there is no column and no grant anywhere in the schema that would
 * let them edit a review, remove one, or learn who wrote it.
 */
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
  if (!review || review.status === 'removed') {
    return { status: 'error', error: copy.errors.removedBody };
  }

  if (review.status !== 'published') {
    return {
      status: 'error',
      error: 'That review is not currently public, so there is nothing to respond to yet.',
    };
  }

  /* --- May this person speak for this property? ---------------------- */

  const claimed = await repository.listClaimedPropertyIds(user.id);
  if (!claimed.includes(review.propertyId)) {
    return {
      status: 'error',
      error:
        'Only the approved claimant of this property can respond to its reviews. If you have submitted a claim, it has not been approved yet.',
    };
  }

  try {
    await repository.createOwnerResponse({
      reviewId: parsed.data.reviewId,
      responderId: user.id,
      body: parsed.data.body,
      isResolutionNotice: parsed.data.isResolutionNotice,
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : '';

    // One reply per review, enforced by a unique index on `review_id`. Two
    // people from the same managing agent pressing publish is a normal
    // Tuesday; it should read as "already answered", not as a fault.
    if (raw.includes('already has a response') || raw.includes('23505') || raw.includes('duplicate key')) {
      return { status: 'error', error: 'This review already has a response from the property.' };
    }

    console.error('[livd] owner response failed', raw);
    return { status: 'error', error: copy.errors.genericBody };
  }

  await invalidateProperty(review.propertyId);

  /* --- Tell the person who wrote the review -------------------------- */

  // The reviewer is entitled to know that the property has answered them in
  // public. The email carries no part of the response and no hint of who
  // wrote it — a link to the page, where the reply is anyway.
  const authorId = review.authorId;
  const propertyId = review.propertyId;
  const reviewId = parsed.data.reviewId;

  if (authorId) {
    after(async () => {
      const repo = await getRepository();
      const property = await repo.getPropertyById(propertyId);
      if (!property) return;

      await notify({
        to: authorId,
        dedupe: `owner_responded:${reviewId}`,
        message: {
          kind: 'owner_responded',
          propertyName: propertyDisplayName(property.address),
          propertySlug: property.slug,
        },
      });
    });
  }

  return { status: 'published', error: null };
}
