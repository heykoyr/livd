'use server';

import { z } from 'zod';

import { RECENCY } from '@/config/verification';
import { copy } from '@/content/copy';
import { checkDualRateLimit } from '@/lib/safety/rate-limit';
import { AuthorisationError, requireUser } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import {
  initialNearbyState,
  type NearbyPropertySummary,
  type NearbyState,
  type PropertyVerificationState,
} from './action-state';
import { originIdentifier } from './reports';
import { edgeCountry } from '@/server/geo/viewer-country';

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

/**
 * How far "near you" reaches, in stages.
 *
 * Three numbers rather than one, because a single radius has to be wrong in
 * one direction or the other: 500m is the honest meaning of "near you" in a
 * dense city and finds nothing in a suburb, while a radius wide enough for the
 * suburb makes "near you" untrue in the city.
 *
 * So the search starts tight and widens only when the tighter pass found
 * nothing, and the radius it settled on is returned with the results — the
 * interface says "within 3 km" when that is what it searched. Widening
 * silently would be the same defect as a mislabelled distance.
 *
 * 500m is roughly a five-minute walk. 3km is the outer bound because past that
 * the word "near" stops meaning anything for somewhere to live, and a visitor
 * who wants a wider view has a search box for it.
 *
 * These are not accuracy allowances. A phone indoors commonly reports tens of
 * metres of error and occasionally far more, which the first stage already
 * absorbs; what these govern is how far a *building* can be and still count.
 */
const NEARBY_RADIUS_STAGES_METERS = [500, 1000, 3000] as const;
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
  _previous: NearbyState,
  formData: FormData,
): Promise<NearbyState> {
  const fail = (error: string): NearbyState => ({
    ...initialNearbyState,
    status: 'error',
    error,
  });

  const limit = await checkDualRateLimit('nearbyLookup', null, await originIdentifier());
  if (!limit.allowed) return fail(copy.verification.rateLimited);

  const parsed = nearbySchema.safeParse({
    latitude: Number(formData.get('latitude')),
    longitude: Number(formData.get('longitude')),
  });

  if (!parsed.success) return fail(copy.verification.nearbyUnavailable);

  const repository = await getRepository();

  try {
    /**
     * Widen only on an empty result, and remember how far it went.
     *
     * Each stage is a bounded database query — the store's own proximity
     * lookup, limited to `NEARBY_LIMIT` — so the worst case is three small
     * queries and the common case is one. Nothing is fetched into this process
     * to be measured here.
     */
    let nearby: Awaited<ReturnType<typeof repository.propertiesNear>> = [];
    let radiusMeters: number = NEARBY_RADIUS_STAGES_METERS[0];

    for (const stage of NEARBY_RADIUS_STAGES_METERS) {
      radiusMeters = stage;
      nearby = await repository.propertiesNear({
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        radiusMeters: stage,
        limit: NEARBY_LIMIT,
      });
      if (nearby.length > 0) break;
    }

    const items: NearbyPropertySummary[] = nearby.map(({ summary, distanceMeters }) => ({
      slug: summary.property.slug,
      name:
        summary.property.address.buildingName ??
        summary.property.address.streetAddress ??
        summary.property.address.locality,
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
    }));

    if (items.length > 0) {
      return {
        status: 'ready',
        outcome: 'found',
        items,
        radiusMeters,
        unlocatableCount: 0,
        error: null,
      };
    }

    /**
     * Nothing found — so say which kind of nothing this is.
     *
     * A property with no coordinate cannot be measured against a position, so
     * `propertiesNear` correctly never returns one. That is how somebody came
     * to be told there was nothing near them while standing inside a property
     * they had reviewed themselves: it was in the database and invisible to
     * this query. Counting what Livd cannot place turns that from a false
     * statement into a true one.
     *
     * Scoped by the coarse country the edge attached to the request, not by
     * the position — turning a coordinate into a country would mean reverse
     * geocoding it, which is a great deal more inference about where somebody
     * is standing than a count of missing data justifies. No header, no scope:
     * the count is then global, which is still true.
     *
     * `edgeCountry` rather than `viewerCountry`, so this stays account-free.
     * Finding out what is around you should not read your identity.
     */
    const countryCode = await edgeCountry();
    const unlocatableCount = await repository
      .unlocatablePropertyCount(countryCode)
      .catch(() => 0);

    return {
      status: 'ready',
      outcome: unlocatableCount > 0 ? 'none_locatable' : 'none_nearby',
      items: [],
      radiusMeters,
      unlocatableCount,
      error: null,
    };
  } catch (error) {
    // Logged for a developer, generic for the visitor. A swallowed failure
    // here is indistinguishable from an empty area, which is the whole defect
    // this function was rewritten to stop doing.
    console.error('[livd] nearby lookup failed', error);
    return fail(copy.verification.nearbyUnavailable);
  }
}
