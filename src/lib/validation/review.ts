import { z } from 'zod';

import { CATEGORY_DEFINITIONS } from '@/config/categories';
import { DEPARTURE_REASONS } from '@/config/departure-reasons';
import { PROPERTY_TYPE_KEYS } from '@/config/markets';
import { TAG_DEFINITIONS } from '@/config/tags';
import { LIMITS } from '@/config/site';

/**
 * Review validation.
 *
 * One schema, used by the client for immediate feedback and by the server as
 * the actual control. The client copy is a convenience; nothing is trusted
 * until it has passed through here on the server.
 *
 * Reference keys are validated against the configuration rather than accepted
 * as free strings, so a crafted request cannot introduce a category or reason
 * that does not exist and quietly poison the aggregates.
 */

const categoryKeys = CATEGORY_DEFINITIONS.map((c) => c.key) as [string, ...string[]];
const reasonKeys = DEPARTURE_REASONS.map((r) => r.key) as [string, ...string[]];
const positiveTagKeys = TAG_DEFINITIONS.filter((t) => t.polarity === 'positive').map((t) => t.key);
const problemTagKeys = TAG_DEFINITIONS.filter((t) => t.polarity === 'problem').map((t) => t.key);

/** ISO date pinned to the first of a month — the finest precision Livd stores. */
const monthDate = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/, 'Choose a month and year.')
  .refine((value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    const year = date.getUTCFullYear();
    return year >= 1970 && year <= new Date().getUTCFullYear() + 1;
  }, 'That date does not look right.');

export const reviewDraftSchema = z
  .object({
    propertyId: z.string().min(1, 'Choose the property you lived in.'),

    residencyStatus: z.enum(['current', 'former']),

    movedInMonth: monthDate,
    movedOutMonth: monthDate.nullable(),

    overallRating: z.number().int().min(1).max(5),

    categoryRatings: z
      .array(
        z.object({
          categoryKey: z.enum(categoryKeys),
          rating: z.number().int().min(1).max(5),
        }),
      )
      .max(CATEGORY_DEFINITIONS.length)
      // A category rated twice would double its weight in the aggregate.
      .refine(
        (ratings) => new Set(ratings.map((r) => r.categoryKey)).size === ratings.length,
        'Each category can only be rated once.',
      ),

    positiveTags: z
      .array(z.string())
      .max(12)
      .transform((tags) => [...new Set(tags)].filter((tag) => positiveTagKeys.includes(tag))),

    problemTags: z
      .array(z.string())
      .max(12)
      .transform((tags) => [...new Set(tags)].filter((tag) => problemTagKeys.includes(tag))),

    primaryDepartureReason: z.enum(reasonKeys).nullable(),
    secondaryDepartureReasons: z.array(z.enum(reasonKeys)).max(3),

    noticedManagementChange: z.boolean().nullable(),

    body: z
      .string()
      .trim()
      .max(LIMITS.reviewBodyMax, `Please keep this under ${LIMITS.reviewBodyMax} characters.`)
      .nullable()
      .transform((value) => (value && value.length > 0 ? value : null)),

    wouldRecommend: z.boolean(),

    rentAmountMinor: z.number().int().min(0).max(1_000_000_000_00).nullable(),
    rentCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    rentPeriod: z.enum(['month', 'year']).nullable(),

    /**
     * The location verification the reviewer is claiming, if any.
     *
     * An id, and never a level. The client cannot say "verified"; the most it
     * can do is name a record, and the store then checks that the record is
     * this person's, is for this property, and has not expired. A crafted
     * request naming somebody else's verification is refused rather than
     * downgraded — see `livd_derive_review_verification` in migration 0014.
     */
    verificationId: z.string().min(1).max(80).nullable().default(null),

    confirmedGuidelines: z.literal(true, {
      message: 'Please confirm you understand the guidelines.',
    }),
  })
  .superRefine((data, ctx) => {
    if (data.residencyStatus === 'former') {
      if (!data.movedOutMonth) {
        ctx.addIssue({
          code: 'custom',
          path: ['movedOutMonth'],
          message: 'Tell us roughly when you moved out.',
        });
      }
      if (!data.primaryDepartureReason) {
        ctx.addIssue({
          code: 'custom',
          path: ['primaryDepartureReason'],
          message: 'Choose the main reason you left.',
        });
      }
    }

    // A current resident with a move-out date is a contradiction that would
    // corrupt the recency weighting.
    if (data.residencyStatus === 'current' && data.movedOutMonth) {
      ctx.addIssue({
        code: 'custom',
        path: ['movedOutMonth'],
        message: 'A current resident should not have a move-out date.',
      });
    }

    if (data.movedOutMonth && data.movedOutMonth < data.movedInMonth) {
      ctx.addIssue({
        code: 'custom',
        path: ['movedOutMonth'],
        message: 'The move-out date cannot be before the move-in date.',
      });
    }

    if (data.movedInMonth > new Date().toISOString().slice(0, 10)) {
      ctx.addIssue({
        code: 'custom',
        path: ['movedInMonth'],
        message: 'You cannot review a tenancy that has not started.',
      });
    }

    // The primary reason must not be repeated as a secondary one, or it would
    // be counted twice in the departure analysis.
    if (
      data.primaryDepartureReason &&
      data.secondaryDepartureReasons.includes(data.primaryDepartureReason)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['secondaryDepartureReasons'],
        message: 'That is already the main reason.',
      });
    }

    // Money is a complete triple or it is absent.
    const rentParts = [data.rentAmountMinor, data.rentCurrency, data.rentPeriod];
    const provided = rentParts.filter((part) => part !== null).length;
    if (provided > 0 && provided < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['rentAmountMinor'],
        message: 'Enter the rent amount, its currency and whether it was monthly or yearly.',
      });
    }

    // A body that is present but too short to be useful is worse than none:
    // it dilutes the page without informing anyone.
    if (data.body !== null && data.body.length < LIMITS.reviewBodyMin) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: `Please write at least ${LIMITS.reviewBodyMin} characters, or leave this blank.`,
      });
    }
  });

export type ReviewDraft = z.infer<typeof reviewDraftSchema>;

/**
 * A correction to a published review.
 *
 * Deliberately three fields. Everything else a review carries — the ratings,
 * the tenancy, the property, the verification — is immutable after
 * publication, enforced by `livd_guard_review_update` rather than by this
 * schema, so a field added here by mistake would be refused by the database
 * rather than quietly accepted.
 *
 * The body rules are the submission rules: blank, or long enough to tell
 * somebody something.
 */
export const reviewCorrectionSchema = z.object({
  reviewId: z.string().min(1).max(80),
  body: z
    .string()
    .trim()
    .max(LIMITS.reviewBodyMax, `Please keep this under ${LIMITS.reviewBodyMax} characters.`)
    .nullable()
    .transform((value) => (value && value.length > 0 ? value : null))
    .refine(
      (value) => value === null || value.length >= LIMITS.reviewBodyMin,
      `Please write at least ${LIMITS.reviewBodyMin} characters, or leave this blank.`,
    ),
  wouldRecommend: z.boolean(),
});

export type ReviewCorrection = z.infer<typeof reviewCorrectionSchema>;

/* -------------------------------------------------------------------------
 * Property creation
 * ---------------------------------------------------------------------- */

export const newPropertySchema = z.object({
  buildingName: z.string().trim().max(160).nullable().transform(emptyToNull),
  streetAddress: z.string().trim().max(200).nullable().transform(emptyToNull),
  neighbourhood: z.string().trim().max(120).nullable().transform(emptyToNull),
  locality: z.string().trim().min(1, 'Enter the city or town.').max(120),
  adminArea: z.string().trim().max(120).nullable().transform(emptyToNull),
  postalCode: z.string().trim().max(20).nullable().transform(emptyToNull),
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Choose a country.')
    .transform((value) => value.toUpperCase()),
  propertyType: z.enum(PROPERTY_TYPE_KEYS as [string, ...string[]]),
}).refine(
  (data) => data.buildingName !== null || data.streetAddress !== null,
  {
    path: ['streetAddress'],
    message: 'Enter a street address or a building name so the property can be identified.',
  },
);

export type NewPropertyInput = z.infer<typeof newPropertySchema>;

function emptyToNull(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

/* -------------------------------------------------------------------------
 * Reports, responses and claims
 * ---------------------------------------------------------------------- */

export const reportSchema = z.object({
  reviewId: z.string().min(1),
  reason: z.enum([
    'inappropriate',
    'false_information',
    'privacy',
    'spam',
    'harassment',
    'not_a_resident',
    'other',
  ]),
  detail: z.string().trim().max(1000).nullable().transform(emptyToNull),
});

export const ownerResponseSchema = z.object({
  reviewId: z.string().min(1),
  body: z
    .string()
    .trim()
    .min(20, 'A response needs to be at least 20 characters.')
    .max(2000, 'Please keep the response under 2,000 characters.'),
  isResolutionNotice: z.boolean(),
});

export const claimSchema = z.object({
  propertyId: z.string().min(1),
  roleClaimed: z.enum(['owner', 'manager', 'agent']),
  organisation: z.string().trim().max(160).nullable().transform(emptyToNull),
  contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
});
