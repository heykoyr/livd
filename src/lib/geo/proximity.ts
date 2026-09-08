/**
 * The proximity decision.
 *
 * Pure functions: coordinates and a clock in, a verdict out. No database, no
 * framework, no I/O — so the rule that decides whether someone is "at" a
 * property can be read in one screen and tested exhaustively.
 *
 * This is the *reference* implementation. In production the same arithmetic
 * runs inside Postgres (`livd_verify_property_location`, migration 0013),
 * because the decision must be made somewhere the client cannot reach and the
 * service-role key is not available to this deployment. The local development
 * adapter uses the functions here directly. `tests/verification/parity.test.ts`
 * holds the two copies to the same constants.
 *
 * Nothing in this module retains anything. Coordinates come in as arguments and
 * leave as a boolean.
 */

import { VERIFICATION_GEO, verificationRadiusMeters } from '@/config/verification';
import type { CountryCode } from '@/types/domain';
import {
  haversineMeters,
  isValidCoordinates,
  metersPerDegreeLatitude,
  metersPerDegreeLongitude,
  type Coordinates,
} from './distance';

/* -------------------------------------------------------------------------
 * Outcomes
 * ---------------------------------------------------------------------- */

/**
 * Why a location check did not succeed.
 *
 * These are recorded against the attempt and shown to the person in their own
 * words. They are deliberately coarse: a reason code carries no distance, so
 * an attacker cannot binary-search their way to a property's true position by
 * reading refusals, and a moderator reading the audit trail learns what went
 * wrong without learning where anyone was.
 */
export type ProximityFailureReason =
  | 'property_has_no_coordinates'
  | 'invalid_position'
  | 'accuracy_too_low'
  | 'fix_too_old'
  | 'outside_area';

export type ProximityDecision =
  | { verified: true }
  | { verified: false; reason: ProximityFailureReason };

/** What a browser's `GeolocationPosition` reduces to before it crosses a boundary. */
export interface ReportedPosition extends Coordinates {
  /** Radius of 68% confidence in metres, as the browser reports it. */
  accuracyMeters: number;
  /** When the fix was taken, epoch milliseconds. */
  capturedAtMs: number;
}

/* -------------------------------------------------------------------------
 * The budget
 * ---------------------------------------------------------------------- */

/**
 * How far from the stored coordinate still counts, for this property.
 *
 * Three terms, each of which exists because ignoring it would reject real
 * residents:
 *
 *   radius   — the property's own extent and immediate surroundings.
 *   grid     — Livd stores coordinates rounded to three decimal places, so the
 *              stored point names a cell, not a position. The building may be
 *              anywhere in it.
 *   accuracy — what the phone itself admits it does not know, capped so a
 *              client cannot buy radius by claiming a bad fix.
 *
 * Returned as a breakdown rather than a number so the arithmetic can be
 * asserted in tests and explained in the audit trail without re-deriving it.
 */
export interface ProximityBudget {
  radiusMeters: number;
  gridUncertaintyMeters: number;
  accuracyAllowanceMeters: number;
  totalMeters: number;
}

export function proximityBudget(
  propertyCoordinates: Coordinates,
  reportedAccuracyMeters: number,
  countryCode: CountryCode | null,
): ProximityBudget {
  const radiusMeters = verificationRadiusMeters(countryCode);

  // Half a cell in each axis, at this latitude, combined as a diagonal — the
  // worst case for how far the true building can be from the stored point.
  const half = VERIFICATION_GEO.coordinateGridHalfCellDegrees;
  const latMeters = half * metersPerDegreeLatitude();
  const lonMeters = half * metersPerDegreeLongitude(propertyCoordinates.latitude);
  const gridUncertaintyMeters = Math.hypot(latMeters, lonMeters);

  const accuracyAllowanceMeters = Math.min(
    Math.max(0, reportedAccuracyMeters),
    VERIFICATION_GEO.accuracyAllowanceCapMeters,
  );

  return {
    radiusMeters,
    gridUncertaintyMeters,
    accuracyAllowanceMeters,
    totalMeters: radiusMeters + gridUncertaintyMeters + accuracyAllowanceMeters,
  };
}

/* -------------------------------------------------------------------------
 * The decision
 * ---------------------------------------------------------------------- */

/**
 * Is this position close enough to this property to call it verified?
 *
 * Order matters. The cheapest and least revealing refusals come first, and
 * `outside_area` is last — so a caller probing for a property's position learns
 * only that their fix was rejected, never by how much.
 */
export function decideProximity(input: {
  propertyCoordinates: Coordinates | null;
  countryCode: CountryCode | null;
  position: ReportedPosition;
  now: Date;
}): ProximityDecision {
  const { propertyCoordinates, countryCode, position, now } = input;

  if (!propertyCoordinates || !isValidCoordinates(propertyCoordinates)) {
    return { verified: false, reason: 'property_has_no_coordinates' };
  }

  if (!isValidCoordinates(position) || !Number.isFinite(position.accuracyMeters)) {
    return { verified: false, reason: 'invalid_position' };
  }

  // A non-positive accuracy is not a very good fix; it is a fabricated one.
  if (position.accuracyMeters <= 0) {
    return { verified: false, reason: 'invalid_position' };
  }

  if (position.accuracyMeters > VERIFICATION_GEO.maxAcceptableAccuracyMeters) {
    return { verified: false, reason: 'accuracy_too_low' };
  }

  // A fix from an hour ago says where the phone was, not where it is. Cheap to
  // forge, and cheap to require — which removes the laziest replay outright.
  const fixAgeSeconds = (now.getTime() - position.capturedAtMs) / 1000;
  if (
    !Number.isFinite(fixAgeSeconds) ||
    fixAgeSeconds > VERIFICATION_GEO.maxFixAgeSeconds ||
    // Tolerates ordinary clock skew between a phone and a server; refuses a
    // timestamp from next week.
    fixAgeSeconds < -VERIFICATION_GEO.maxFixAgeSeconds
  ) {
    return { verified: false, reason: 'fix_too_old' };
  }

  const distance = haversineMeters(propertyCoordinates, position);
  const budget = proximityBudget(propertyCoordinates, position.accuracyMeters, countryCode);

  return distance <= budget.totalMeters
    ? { verified: true }
    : { verified: false, reason: 'outside_area' };
}

/* -------------------------------------------------------------------------
 * Implausible movement
 * ---------------------------------------------------------------------- */

/**
 * Could the same person really have been at both of these properties?
 *
 * Measured between the two *properties'* published coordinates and the interval
 * between the two attempts. It therefore needs no record of where anyone has
 * been and creates none: both coordinates are already public facts about
 * buildings, and the only personal datum involved is a timestamp Livd already
 * keeps for rate limiting.
 *
 * A script verifying its way down a list of addresses trips this immediately.
 * A person cannot, short of teleportation — the threshold is set above
 * commercial aviation precisely so that travel is never the explanation.
 */
export function isImplausibleMovement(input: {
  previousPropertyCoordinates: Coordinates;
  currentPropertyCoordinates: Coordinates;
  elapsedSeconds: number;
}): boolean {
  const { previousPropertyCoordinates, currentPropertyCoordinates, elapsedSeconds } = input;

  if (
    !isValidCoordinates(previousPropertyCoordinates) ||
    !isValidCoordinates(currentPropertyCoordinates)
  ) {
    return false;
  }

  const meters = haversineMeters(previousPropertyCoordinates, currentPropertyCoordinates);

  // Two properties in the same complex are metres apart; no interval makes
  // that suspicious, and dividing by a near-zero elapsed time would.
  if (meters < 1000) return false;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return true;

  const speedKmh = meters / 1000 / (elapsedSeconds / 3600);
  return speedKmh > VERIFICATION_GEO.implausibleSpeedKmh;
}
