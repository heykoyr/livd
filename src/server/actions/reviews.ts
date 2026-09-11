'use server';

import { redirect } from 'next/navigation';
import { after } from 'next/server';

import { copy } from '@/content/copy';
import { lintContent, type SafetyCode } from '@/lib/safety/content-linter';
import {
  initialReviewEditState,
  initialReviewSubmitState,
  type NewPropertyState,
  type ReviewEditState,
  type ReviewSubmitState,
} from './action-state';
import { checkDualRateLimit } from '@/lib/safety/rate-limit';
import { captchaMessage, verifyCaptcha } from '@/server/safety/captcha';
import {
  newPropertySchema,
  reviewCorrectionSchema,
  reviewDraftSchema,
} from '@/lib/validation/review';
import { editWindowFor } from '@/lib/reviews/edit-window';
import { propertyDisplayName } from '@/lib/format';
import { AuthorisationError, requireUser } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import { notify } from '@/server/notify';
import { getGeocoder } from '@/server/geo/geocoder';
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
 *   3. Bot check — before the schema, because parsing a bot's JSON is work.
 *   4. Schema validation.
 *   5. The property exists.
 *   6. The author does not own the property. Reviewing a property you manage is
 *      the most direct form of manipulation available.
 *   7. Not a duplicate review of the same tenancy.
 *   8. Content safety.
 *
 * Every one of these is also enforced by a database constraint or an RLS policy.
 * This layer exists to produce a useful message; the database is what makes the
 * rule true.
 *
 * The verification is the clearest example of that division. This action passes
 * an id straight through without inspecting it, because inspecting it here
 * would achieve nothing: a request that skipped this action entirely would
 * still meet the trigger in migration 0014, which is what actually resolves an
 * id to a level after checking it belongs to this author and this property. A
 * check here would be a second opinion that could drift from the real one.
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

  /* --- 3. Not a bot ------------------------------------------------- */

  // Before the schema, and before any read. A bot is refused on the cheapest
  // check that can refuse it, and whether a token is required at all is
  // decided from the server's own environment rather than from anything this
  // request carries — so a script calling this action directly, with no
  // widget ever rendered, meets the same wall as one that tried the form.
  const captchaToken = formData.get('captchaToken');
  const captcha = await verifyCaptcha(
    typeof captchaToken === 'string' ? captchaToken : null,
    await originIdentifier(),
  );

  if (!captcha.ok) {
    return { ...initialReviewSubmitState, status: 'error', error: captchaMessage(captcha.reason) };
  }

  /* --- 4. Shape ----------------------------------------------------- */

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

  /* --- 5. The property exists --------------------------------------- */

  const property = await repository.getPropertyById(draft.propertyId);
  if (!property) {
    return {
      ...initialReviewSubmitState,
      status: 'error',
      error: copy.errors.propertyNotFoundBody,
    };
  }

  /* --- 6. Not the owner --------------------------------------------- */

  const claimedPropertyIds = await repository.listClaimedPropertyIds(user.id);
  if (claimedPropertyIds.includes(property.id)) {
    return {
      ...initialReviewSubmitState,
      status: 'error',
      error:
        'You have claimed this property, so you cannot review it. You can respond to reviews instead.',
    };
  }

  /* --- 7. Not a duplicate ------------------------------------------- */

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

  /* --- 8. Content safety -------------------------------------------- */

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

  let review;
  try {
    review = await repository.createReview(
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
      // Passed through untouched. The store resolves it to a level, or refuses
      // it — see the note above.
        verificationId: draft.verificationId,
      },
      user.id,
    );
  } catch (error) {
    // The one write that can fail for a reason worth distinguishing: a
    // verification that is not this person's or not this property's. Both the
    // database trigger and the local store refuse it rather than downgrading
    // quietly, because a mismatch is an attempt rather than an accident. An
    // expired verification is a different matter and never reaches here — it
    // publishes without a badge.
    console.error('[livd] review submission failed', error);
    return {
      ...initialReviewSubmitState,
      status: 'error',
      error: copy.errors.genericBody,
    };
  }

  // Read-your-own-writes: the author is about to land on the property page and
  // must see their own review there.
  await invalidateProperty(property.id);

  /* --- Tell the people it concerns ----------------------------------- */

  // `after` rather than a floating promise: it runs once the response has
  // been sent but while the invocation is still alive, so the email is not
  // racing the platform's decision to freeze this function. Nothing in here
  // can fail the submission — `notify` swallows everything — and nothing in
  // here is awaited by the reviewer.
  const propertyName = propertyDisplayName(property.address);
  const reviewId = review.id;

  after(async () => {
    await notify({
      to: user.id,
      // Keyed on the review, so a moderator publishing this same review later
      // computes the same key and does not send a second "it is live".
      dedupe:
        status === 'published' ? `review_published:${reviewId}` : `review_held:${reviewId}`,
      message:
        status === 'published'
          ? { kind: 'review_published', propertyName, propertySlug: property.slug }
          : { kind: 'review_held', propertyName },
    });

    // And the property's owner, if it has one. Only for a review that is
    // actually public — telling an owner about a review held for moderation
    // would disclose the existence of content the platform has not published,
    // and about a person it is still deciding on.
    if (status !== 'published') return;

    const repository = await getRepository();
    const claimantId = await repository.findApprovedClaimantId(property.id);
    if (!claimantId) return;

    await notify({
      to: claimantId,
      dedupe: `owner_new_review:${reviewId}`,
      // No reviewer, no rating, no excerpt. The message type has no field
      // that could carry one — see src/server/notify/messages.ts.
      message: { kind: 'owner_new_review', propertyName, propertySlug: property.slug },
    });
  });

  return {
    ...initialReviewSubmitState,
    status: status === 'published' ? 'published' : 'pending',
    propertySlug: property.slug,
    // What actually happened to the verification, rather than what was asked
    // for. Someone whose check expired while they were writing is told so on
    // the confirmation screen instead of quietly not getting the badge they
    // were expecting.
    verificationLevel: review.verificationLevel,
  };
}

/* -------------------------------------------------------------------------
 * Correcting a published review
 * ---------------------------------------------------------------------- */

/**
 * An author fixing what they wrote, inside the correction window.
 *
 * The product has promised this on the confirmation screen since the review
 * wizard was built — "you can correct this review for the next 21 hours" — and
 * the database has been ready for it since migration 0004. What was missing was
 * everything in between: no action, no route, no button. This is the action.
 *
 * IT IS NOT THE CONTROL, AND IT IS WRITTEN AS THOUGH IT WERE
 *
 * Every check below is also made in Postgres, by `livd_correct_review` against
 * its own clock and its own copy of the row. That is the one that decides. This
 * layer exists to produce a sentence a person can act on, and to run the
 * content linter — which lives in TypeScript and which the database cannot
 * re-run.
 *
 * The order is the submission order, and for the same reasons:
 *
 *   1. Who is asking.
 *   2. Rate limit, before any read.
 *   3. Shape.
 *   4. The review exists, is theirs, is published, and is inside the window.
 *   5. Content safety — on the *new* body, with the same verdicts a fresh
 *      submission would get. A blocked correction is refused; one that alleges
 *      something serious is saved and held for a moderator, because otherwise
 *      publishing an innocuous review and rewriting it afterwards would be a
 *      way past the pipeline.
 *
 * Nothing here trusts a timestamp, an author id or a status that arrived with
 * the request. The form sends a review id and two fields; everything else is
 * read from the store.
 *
 * No CAPTCHA, unlike submission. A correction needs an account that already
 * holds a published review and a window that is still open, which is not a
 * surface a bot farm can work — and a token that expires mid-edit would cost a
 * person their words for nothing.
 */
export async function correctReview(
  _previous: ReviewEditState,
  formData: FormData,
): Promise<ReviewEditState> {
  /* --- 1. Who is asking --------------------------------------------- */

  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return {
      ...initialReviewEditState,
      status: 'error',
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
    };
  }

  /* --- 2. Rate limit ------------------------------------------------ */

  const limit = await checkDualRateLimit('reviewEdit', user.id, await originIdentifier());
  if (!limit.allowed) {
    return { ...initialReviewEditState, status: 'error', error: copy.errors.rateLimitedBody };
  }

  /* --- 3. Shape ------------------------------------------------------ */

  const rawBody = formData.get('body');

  const parsed = reviewCorrectionSchema.safeParse({
    reviewId: formData.get('reviewId'),
    body: typeof rawBody === 'string' ? rawBody : null,
    wouldRecommend: formData.get('wouldRecommend') === 'yes',
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return {
      ...initialReviewEditState,
      status: 'error',
      fieldErrors,
      error: copy.errors.validationTitle,
    };
  }

  const correction = parsed.data;
  const repository = await getRepository();

  /* --- 4. Theirs, published, and still inside the window -------------- */

  const review = await repository.getReviewById(correction.reviewId);

  // One message for "no such review" and for "not yours", deliberately. Two
  // would make this action a way to find out which review ids are real.
  if (!review || review.authorId !== user.id) {
    return { ...initialReviewEditState, status: 'error', error: copy.review.edit.forbidden };
  }

  const window = editWindowFor(review);
  if (!window.editable) {
    return {
      ...initialReviewEditState,
      status: 'error',
      windowClosed: true,
      error: window.reason === 'expired' ? copy.review.edit.expired : copy.review.edit.notPublished,
    };
  }

  /* --- 5. Content safety --------------------------------------------- */

  const safety = correction.body ? lintContent(correction.body) : null;

  if (safety && !safety.ok) {
    const messages = [...new Set(safety.blocks.map((issue) => SAFETY_MESSAGES[issue.code]))];
    return {
      ...initialReviewEditState,
      status: 'error',
      error: copy.safety.blockedTitle,
      safetyMessages: messages,
    };
  }

  // The same rule the submission takes: a serious allegation is read by a
  // person before it is public. An edit that introduces one takes the review
  // off the property page until then, rather than leaving it up on the strength
  // of a moderation decision made about different words.
  const hold = safety?.flags.some((issue) => issue.code === 'unverified_allegation') ?? false;

  /* --- Persist -------------------------------------------------------- */

  let result;
  try {
    result = await repository.updateReview(
      review.id,
      user.id,
      { body: correction.body, wouldRecommend: correction.wouldRecommend },
      { addFlags: safety?.flagCodes ?? [], hold },
    );
  } catch (error) {
    // The store refuses for reasons this layer has already checked, which is
    // the point of checking in both places. Reaching here means the row moved
    // between the read and the write — most often a window that closed, or a
    // moderator acting at the same moment. The database's own words never
    // reach the person.
    console.error('[livd] review correction failed', error);
    return { ...initialReviewEditState, status: 'error', error: copy.review.edit.saveFailed };
  }

  // Read-your-own-writes: the author is about to be shown the corrected review,
  // and the property page has to agree with what they just saved.
  await invalidateProperty(review.propertyId);

  /* --- Tell the people it concerns ------------------------------------ */

  // Only where the state changed. A typo fix is not news, and an inbox filling
  // up with "your review was edited" teaches people to ignore the mail that
  // matters. A hold is a different matter: their review has left the property
  // page, and they are entitled to hear that from us rather than notice it.
  //
  // Nothing goes to the property owner either way. They were told once, when
  // the review was published; a correction to its wording is not a second
  // event, and a message saying that one specific review had just changed
  // would hand them a timing signal about one resident.
  if (hold) {
    const property = await repository.getPropertyById(review.propertyId);
    const propertyName = property ? propertyDisplayName(property.address) : 'a property';
    const reviewId = review.id;
    const authorId = user.id;

    after(async () => {
      await notify({
        to: authorId,
        // Keyed on the review and the event, the way every other review
        // notification is — so a moderator publishing it again later computes
        // `review_published:<id>` and still sends.
        // Not `review_held:<id>`, which is the key the *submission* claims.
        // These are two different real-world events — "we are reading this
        // before it goes up" and "your correction took it back down" — and a
        // review that was held on submission, published by a moderator, then
        // corrected into a hold would compute the submission's key and send
        // nothing at all. The person would find their review gone from the
        // property page with no email saying so.
        dedupe: `review_held_correction:${reviewId}`,
        message: { kind: 'review_held', propertyName },
      });
    });
  }

  return {
    ...initialReviewEditState,
    status: hold ? 'held' : 'saved',
    closesAt: result.closesAt,
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

  const origin = await originIdentifier();

  const limit = await checkDualRateLimit('propertyCreate', user.id, origin);
  if (!limit.allowed) {
    return { fieldErrors: {}, error: copy.errors.rateLimitedBody };
  }

  // Protected for the same reason as a review, plus one of its own: creating
  // a property calls a paid geocoding API, so an unprotected endpoint here
  // costs money as well as data quality.
  const captchaToken = formData.get('captchaToken');
  const captcha = await verifyCaptcha(
    typeof captchaToken === 'string' ? captchaToken : null,
    origin,
  );
  if (!captcha.ok) {
    return { fieldErrors: {}, error: captchaMessage(captcha.reason) };
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

  // Best effort, and never in the way. A coordinate is what makes a property
  // location-verifiable, so it is worth six seconds of a contributor's time to
  // try for one — but a geocoder that is slow, rate-limited, down or simply
  // wrong about the address must not cost Livd the contribution. `geocode`
  // never throws and returns null for everything it cannot resolve; the
  // property is created either way, and one without a coordinate is an
  // ordinary property that does not offer the verification step.
  const coordinates = await getGeocoder().geocode(input);

  const property = await repository.createProperty({ ...input, coordinates }, user.id);
  redirect(`/review?property=${property.slug}&new=1`);
}
