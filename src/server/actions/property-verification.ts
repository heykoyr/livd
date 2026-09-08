'use server';

import { z } from 'zod';

import { RECENCY } from '@/config/verification';
import { copy } from '@/content/copy';
import { checkDualRateLimit } from '@/lib/safety/rate-limit';
import { AuthorisationError, requireUser } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import type {
  NearbyPropertySummary,
  PropertyVerificationState,
} from './action-state';
import { originIdentifier } from './reports';

/**
 * Property verification, and the nearby lookup that shares its privacy rules.
 *
 * What this action does with a position is the whole design. It receives one,
 * hands it to the store as arguments, and returns a verdict. It does not log
 * it, does not cache it, does not put it in an analytics event, and does not
 * pass it to anything that persists. The row that comes back records that a
 * decision was made — never the coordinate it was made from.
 *
 * What it deliberately does *not* do:
 *
 *   - Decide anything itself. The distance comparison happens inside Postgres
 *     (`livd_verify_property_location`), so a caller with the public key
 *     cannot skip this action and assert a result against the table. This
 *     layer authenticates, rate-limits and translates; it does not adjudicate.
 *
 *   - Promise more than it can. A browser cannot attest that a coordinate came
 *     from a GPS chip, and nothing here pretends otherwise. What the checks
 *     buy is cost: the position must be plausible, recent, accurate enough to
 *     mean something, and consistent with where this account claimed to be a
 *     few minutes ago. That makes casual abuse tedious and scripted abuse
 *     visible. It does not make it impossible, and the product's copy never
 *     says it does.
 */

const verifySchema = z.object({
  propertyId: z.string().min(1).max(80),
  // Bounds are asserted again in the database. Checked here so an obviously
  // impossible request is refused before it costs a round trip.
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().positive().max(100_000),
  capturedAtMs: z.number().int().positive(),
});

export async function verifyPropertyLocation(
  _previous: PropertyVerificationState,
  formData: FormData,
): Promise<PropertyVerificationState> {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof AuthorisationError ? error.message : copy.errors.genericBody,
      verificationId: null,
      failureReason: null,
    };
  }

  // Before the parse and before the round trip. Attempts are cheap to make and
  // each one is a row; twelve an hour is far more than a person verifying the
  // building they live in will ever need.
  const limit = await checkDualRateLimit(
    'locationVerify',
    user.id,
    await originIdentifier(),
  );
  if (!limit.allowed) {
    return {
      status: 'error',
      error: copy.verification.rateLimited,
      verificationId: null,
      failureReason: null,
    };
  }

  const parsed = verifySchema.safeParse({
    propertyId: formData.get('propertyId'),
    latitude: Number(formData.get('latitude')),
    longitude: Number(formData.get('longitude')),
    accuracyMeters: Number(formData.get('accuracyMeters')),
    capturedAtMs: Number(formData.get('capturedAtMs')),
  });

  if (!parsed.success) {
    return {
      status: 'failed',
      error: null,
      verificationId: null,
      failureReason: 'invalid_position',
    };
  }

  const repository = await getRepository();

  let verification;
  try {
    verification = await repository.verifyPropertyLocation({
      userId: user.id,
      propertyId: parsed.data.propertyId,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      accuracyMeters: parsed.data.accuracyMeters,
      capturedAtMs: parsed.data.capturedAtMs,
    });
  } catch {
    // The message is deliberately not the database's. A verification failure
    // that echoes a Postgres error tells a prober which of its guards it hit.
    return {
      status: 'error',
      error: copy.verification.serverError,
      verificationId: null,
      failureReason: null,
    };
  }

  if (verification.status !== 'verified') {
    return {
      status: 'failed',
      error: null,
      verificationId: null,
      failureReason: verification.failureReason,
    };
  }

  return {
    status: 'verified',
    error: null,
    verificationId: verification.id,
    failureReason: null,
  };
}

/* -------------------------------------------------------------------------
 * Nearby discovery
 * ---------------------------------------------------------------------- */

const nearbySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/** How far "near you" reaches. A short walk, not a district. */
const NEARBY_RADIUS_METERS = 1500;
const NEARBY_LIMIT = 6;

/**
 * Properties near a visitor who asked to be shown them.
 *
 * Only ever called from a control the visitor pressed. There is no ambient
 * location request anywhere in Livd, no background lookup, and no notification
 * that fires because somebody walked past a building — a product that tells
 * you what you are standing next to before you asked has told you it is
 * watching.
 *
 * No account required: finding out what is around you should not cost an
 * identity. Nothing is recorded, so there is nothing to attach to one anyway.
 */
export async function findNearbyProperties(
  _previous: { status: 'idle' | 'ready' | 'error'; items: NearbyPropertySummary[]; error: string | null },
  formData: FormData,
): Promise<{ status: 'idle' | 'ready' | 'error'; items: NearbyPropertySummary[]; error: string | null }> {
  const limit = await checkDualRateLimit('nearbyLookup', null, await originIdentifier());
  if (!limit.allowed) {
    return { status: 'error', items: [], error: copy.verification.rateLimited };
  }

  const parsed = nearbySchema.safeParse({
    latitude: Number(formData.get('latitude')),
    longitude: Number(formData.get('longitude')),
  });

  if (!parsed.success) {
    return { status: 'error', items: [], error: copy.verification.nearbyUnavailable };
  }

  const repository = await getRepository();

  try {
    const nearby = await repository.propertiesNear({
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      radiusMeters: NEARBY_RADIUS_METERS,
      limit: NEARBY_LIMIT,
    });

    return {
      status: 'ready',
      error: null,
      // Reduced to what a card needs. A `PropertySummary` would travel to the
      // client carrying the property's coordinates, which is a longer answer
      // than the question deserves.
      items: nearby.map(({ summary, distanceMeters }) => ({
        slug: summary.property.slug,
        name: summary.property.address.buildingName ?? summary.property.address.streetAddress ?? summary.property.address.locality,
        context: summary.property.address.neighbourhood ?? summary.property.address.locality,
        countryCode: summary.property.address.countryCode,
        reviewCount: summary.intelligence.reviewCount,
        verifiedCount: summary.intelligence.freshness.verifiedCount,
        overallScore: summary.intelligence.overallScore,
        lastReviewAt: summary.intelligence.lastReviewAt,
        recentReviewCount: summary.intelligence.freshness.reviewsInActivityWindow,
        activityWindowDays: RECENCY.activityWindowDays,
        distanceMeters,
        isDemo: summary.property.isDemo,
      })),
    };
  } catch {
    return { status: 'error', items: [], error: copy.verification.nearbyUnavailable };
  }
}
