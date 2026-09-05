'use server';

import { redirect } from 'next/navigation';

import { copy } from '@/content/copy';
import { lintContent, type SafetyCode } from '@/lib/safety/content-linter';
import {
  initialNewPropertyState,
  initialReviewSubmitState,
  type NewPropertyState,
  type ReviewSubmitState,
} from './action-state';
import { checkDualRateLimit } from '@/lib/safety/rate-limit';
import { newPropertySchema, reviewDraftSchema } from '@/lib/validation/review';
import { AuthorisationError, requireUser } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import { invalidateProperty } from '@/server/data/cache';
import type { ReviewStatus } from '@/types/domain';
import { originIdentifier } from './reports';

/**
 * Review submission.
 *
 * The order of checks matters, and it is not the order that is cheapest to
 * implement:
 *
 *   1. Authentication and account standing.
 *   2. Rate limit — before any expensive work.
 *   3. Schema validation.
 *   4. The property exists.
 *   5. The author does not own the property. Reviewing a property you manage is
 *      the most direct form of manipulation available.
 *   6. Not a duplicate review of the same tenancy.
 *   7. Content safety.
 *
 * Every one of these is also enforced by a database constraint or an RLS policy.
 * This layer exists to produce a useful message; the database is what makes the
 * rule true.
 */

/** Maps a linter code to the specific fix the writer needs to make. */
const SAFETY_MESSAGES: Record<SafetyCode, string> = {
  contact_details: copy.safety.contactDetails,
  named_individual: copy.safety.namedIndividual,
  unit_number: copy.safety.unitNumber,
  threat: copy.safety.threat,
  discrimination: copy.safety.discrimination,
  unverified_allegation: copy.safety.allegation,
  aggressive_tone: copy.safety.harassment,
  excessive_caps: copy.safety.harassment,
};

export async function submitReview(
  _previous: ReviewSubmitState,
  formData: FormData,
): Promise<ReviewSubmitState> {
  /* --- 1. Who is asking --------------------------------------------- */

  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return {
      ...initialReviewSubmitState,
      status: 'error',
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
    };
  }

  /* --- 2. Rate limit ------------------------------------------------ */

  const limit = await checkDualRateLimit('reviewSubmit', user.id, await originIdentifier());
  if (!limit.allowed) {
    return {
      ...initialReviewSubmitState,
      status: 'error',
      error: copy.errors.rateLimitedBody,
    };
  }

  /* --- 3. Shape ----------------------------------------------------- */

  const raw = formData.get('draft');
  if (typeof raw !== 'string') {
    return { ...initialReviewSubmitState, status: 'error', error: copy.errors.genericBody };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { ...initialReviewSubmitState, status: 'error', error: copy.errors.genericBody };
  }

  const parsed = reviewDraftSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return {
      ...initialReviewSubmitState,
      status: 'error',
      fieldErrors,
      error: copy.errors.validationTitle,
    };
  }

  const draft = parsed.data;
  const repository = await getRepository();

  /* --- 4. The property exists --------------------------------------- */

  const property = await repository.getPropertyById(draft.propertyId);
  if (!property) {
    return {
      ...initialReviewSubmitState,
      status: 'error',
      error: copy.errors.propertyNotFoundBody,
    };
  }

  /* --- 5. Not the owner --------------------------------------------- */

  const claimedPropertyIds = await repository.listClaimedPropertyIds(user.id);
  if (claimedPropertyIds.includes(property.id)) {
    return {
      ...initialReviewSubmitState,
      status: 'error',
      error:
        'You have claimed this property, so you cannot review it. You can respond to reviews instead.',
    };
  }

  /* --- 6. Not a duplicate ------------------------------------------- */

  const alreadyReviewed = await repository.hasExistingReview(
    property.id,
    user.id,
    draft.movedInMonth,
  );
  if (alreadyReviewed) {
    return {
      ...initialReviewSubmitState,
      status: 'error',
      error:
        'You have already reviewed this property for that tenancy. You can edit that review from your account.',
    };
  }

  /* --- 7. Content safety -------------------------------------------- */

  const safety = lintContent(draft.body);

  if (!safety.ok) {
    // Deduplicated, because three phone numbers is one instruction to follow.
    const messages = [...new Set(safety.blocks.map((issue) => SAFETY_MESSAGES[issue.code]))];
    return {
      ...initialReviewSubmitState,
      status: 'error',
      error: copy.safety.blockedTitle,
      safetyMessages: messages,
    };
  }

  // Flagged content is published pending a moderator, except where the flag is
  // a serious allegation — those are held until a human has read them, because
  // an unfounded accusation against a named business does damage while it is up.
  const held = safety.flags.some((issue) => issue.code === 'unverified_allegation');
  const status: ReviewStatus =
    safety.flags.length === 0 ? 'published' : held ? 'pending_moderation' : 'published';

  /* --- Persist ------------------------------------------------------- */

  await repository.createReview(
    {
      propertyId: property.id,
      residencyStatus: draft.residencyStatus,
      movedInMonth: draft.movedInMonth,
      movedOutMonth: draft.movedOutMonth,
      overallRating: draft.overallRating,
      categoryRatings: draft.categoryRatings,
      positiveTags: draft.positiveTags,
      problemTags: draft.problemTags,
      primaryDepartureReason: draft.primaryDepartureReason,
      secondaryDepartureReasons: draft.secondaryDepartureReasons,
      noticedManagementChange: draft.noticedManagementChange,
      body: draft.body,
      wouldRecommend: draft.wouldRecommend,
      rentAmountMinor: draft.rentAmountMinor,
      rentCurrency: draft.rentCurrency,
      rentPeriod: draft.rentPeriod,
      status,
      safetyFlags: safety.flagCodes,
    },
    user.id,
  );

  // Read-your-own-writes: the author is about to land on the property page and
  // must see their own review there.
  await invalidateProperty(property.id);

  return {
    ...initialReviewSubmitState,
    status: status === 'published' ? 'published' : 'pending',
    propertySlug: property.slug,
  };
}

/* -------------------------------------------------------------------------
 * Adding a property
 * ---------------------------------------------------------------------- */

/**
 * Adds a property that is not yet on Livd.
 *
 * Checks for an existing match first and redirects to it rather than creating a
 * near-duplicate. A property split across two records has its history split
 * with it, which is the one thing this product cannot afford.
 */
export async function createProperty(
  _previous: NewPropertyState,
  formData: FormData,
): Promise<NewPropertyState> {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return {
      fieldErrors: {},
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
    };
  }

  const limit = await checkDualRateLimit('propertyCreate', user.id, await originIdentifier());
  if (!limit.allowed) {
    return { fieldErrors: {}, error: copy.errors.rateLimitedBody };
  }

  const parsed = newPropertySchema.safeParse({
    buildingName: formData.get('buildingName') || null,
    streetAddress: formData.get('streetAddress') || null,
    neighbourhood: formData.get('neighbourhood') || null,
    locality: formData.get('locality'),
    adminArea: formData.get('adminArea') || null,
    postalCode: formData.get('postalCode') || null,
    countryCode: formData.get('countryCode'),
    propertyType: formData.get('propertyType'),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return { fieldErrors, error: copy.errors.validationTitle };
  }

  const input = {
    ...parsed.data,
    propertyType: parsed.data.propertyType as Parameters<
      Awaited<ReturnType<typeof getRepository>>['createProperty']
    >[0]['propertyType'],
  };

  const repository = await getRepository();

  const existing = await repository.findDuplicateProperty(input);
  if (existing) {
    redirect(`/review?property=${existing.slug}&existing=1`);
  }

  const property = await repository.createProperty(input, user.id);
  redirect(`/review?property=${property.slug}&new=1`);
}
