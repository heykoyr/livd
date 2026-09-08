/**
 * Property verification and resident recency — every tunable number, in one
 * place.
 *
 * Nothing in this file is a threshold a component may re-declare. The same
 * constants are mirrored into SQL in migration 0013, because the authoritative
 * distance decision is made inside Postgres where a client cannot reach it;
 * `tests/verification/parity.test.ts` holds the two copies together.
 *
 * A note on what location verification is and is not. Standing next to a
 * building proves presence, not tenancy. The product says "Location verified"
 * and never "we know you live here", and the weight below is set accordingly —
 * above an unchecked claim, well below a tenancy agreement a moderator has read.
 */

import type { CountryCode } from '@/types/domain';

/* -------------------------------------------------------------------------
 * Geometry
 * ---------------------------------------------------------------------- */

export const VERIFICATION_GEO = {
  /**
   * How far from a property's coordinate still counts as "at this property".
   *
   * Sized for a dense urban residential building rather than for a rural plot:
   * it has to cover the building's own footprint, its entrance, its car park
   * and the pavement outside, because a resident may be in a basement garage
   * or a lift lobby when they open the app.
   *
   * It is not a security parameter. A determined spoofer supplies whatever
   * coordinate they like and the radius is irrelevant to them; what this number
   * actually governs is how often a real resident is turned away.
   */
  radiusMeters: 150,

  /**
   * Per-country overrides, in metres.
   *
   * Deliberately empty. 150m is a defensible starting point for the twelve
   * markets Livd currently serves, and inventing a table of per-country values
   * without measurement would be fabricating precision — exactly what §43 of
   * the product brief warns against. The mechanism exists so tuning is a data
   * change once there is evidence to tune against; until then one honest number
   * beats twelve invented ones.
   */
  radiusOverridesByCountry: {} as Partial<Record<CountryCode, number>>,

  /**
   * The uncertainty introduced by Livd's own storage.
   *
   * `properties.latitude/longitude` are `numeric(6,3)` and a database trigger
   * rounds them, so a stored coordinate names a ~110m cell rather than a point.
   * The true building position can therefore be up to half a cell away in each
   * axis. Ignoring this would silently shrink the effective radius by up to 79m
   * and reject residents standing in their own lobby.
   *
   * Half of one thousandth of a degree, in degrees. Converted to metres per
   * axis at the property's latitude, so it is correct at the equator and in
   * Reykjavík alike.
   */
  coordinateGridHalfCellDegrees: 0.0005,

  /**
   * How much of the browser's own reported accuracy to forgive.
   *
   * A phone indoors, or beside a tall building, routinely reports 30–60m of
   * uncertainty; refusing those would reject the exact population this feature
   * exists for. Capped, because `accuracy` is client-supplied and an uncapped
   * allowance would let anyone widen the radius by declaring a bad fix.
   */
  accuracyAllowanceCapMeters: 75,

  /**
   * Above this, the fix is too vague to mean anything and the attempt is
   * refused with "we couldn't confidently verify this location" rather than
   * quietly counted. A 500m accuracy reading is a cell-tower estimate, not a
   * position.
   */
  maxAcceptableAccuracyMeters: 250,

  /**
   * How stale a position fix may be when it reaches the server.
   *
   * The browser reports when the fix was taken. A fix from yesterday replayed
   * today is the cheapest possible attack on this system, and this is what
   * makes it cost something. It cannot be forged-proof — the whole reading is
   * client-supplied — but it removes the trivial case.
   */
  maxFixAgeSeconds: 300,

  /**
   * The speed above which two verifications cannot both be genuine.
   *
   * Computed between the two *properties'* published coordinates, never
   * between two positions of a person — so this check needs no location
   * history and creates none. Set beyond commercial aviation: the intent is to
   * catch a script walking a list of properties, not to police travel.
   */
  implausibleSpeedKmh: 1000,
} as const;

/** The verification radius that applies to a property in this market. */
export function verificationRadiusMeters(countryCode: CountryCode | null): number {
  if (!countryCode) return VERIFICATION_GEO.radiusMeters;
  return (
    VERIFICATION_GEO.radiusOverridesByCountry[countryCode.toUpperCase()] ??
    VERIFICATION_GEO.radiusMeters
  );
}

/* -------------------------------------------------------------------------
 * Lifetime
 * ---------------------------------------------------------------------- */

export const VERIFICATION_LIFETIME = {
  /**
   * How long a completed location check may be attached to a new review.
   *
   * Long enough to survive a phone call, a nappy change and a train going into
   * a tunnel; short enough that "verified at this property" describes today.
   * Expiry is not a loss: the review still publishes, simply without the badge.
   */
  attachWindowMinutes: 120,

  /**
   * How long the wizard treats an existing verification as still good, so
   * somebody who verified, wandered off and came back is not asked twice.
   * Same window — stated separately because they are separate decisions and
   * will not always agree.
   */
  reuseWindowMinutes: 120,
} as const;

/* -------------------------------------------------------------------------
 * Resident recency
 *
 * The question a prospective renter is actually asking is not "was this
 * checked" but "is this still what living there is like". Recency answers it,
 * and it is derived rather than stored — a stored label would be wrong the day
 * after it was written.
 * ---------------------------------------------------------------------- */

export const RECENCY = {
  /**
   * A current resident's experience is only *current* while it is fresh. Past
   * this, someone who told us they still lived there two years ago is
   * describing the property as it was, whatever they ticked at the time.
   */
  currentMaxMonths: 3,

  /** Recent enough to describe the building as it is run now. */
  recentMaxMonths: 6,

  /** Still informative, visibly historical. */
  formerMaxMonths: 24,

  /**
   * The window "recently reviewed" and property freshness are measured over.
   * Ninety days is a quarter — long enough that a healthy property has
   * something in it, short enough to mean "lately".
   */
  activityWindowDays: 90,
} as const;

export type ResidentRecency = 'current' | 'recent' | 'former' | 'older';

/* -------------------------------------------------------------------------
 * Weighting
 *
 * Mirrored by `SCORING.weightLocationVerified` in the scoring module and by
 * `livd_verification_weight` in SQL. Changing one without the others is what
 * `tests/verification/parity.test.ts` exists to catch.
 * ---------------------------------------------------------------------- */

export const VERIFICATION_WEIGHTS = {
  /**
   * A review whose author was demonstrably at the property counts for 1.3 of
   * one nobody checked.
   *
   * The number is a judgement and it is deliberately modest. Presence at an
   * address is real evidence — it rules out the reviewer who has never been to
   * the building — but it is not evidence of a tenancy, and pricing it near the
   * 1.8 that a moderator-read tenancy agreement earns would imply a certainty
   * the signal does not carry.
   */
  location: 1.3,
} as const;
