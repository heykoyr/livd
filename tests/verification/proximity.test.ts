import { describe, expect, it } from 'vitest';

import { VERIFICATION_GEO } from '@/config/verification';
import { haversineMeters, isValidCoordinates } from '@/lib/geo/distance';
import {
  decideProximity,
  isImplausibleMovement,
  proximityBudget,
} from '@/lib/geo/proximity';

/**
 * The proximity decision.
 *
 * This is the rule that decides whether a review gets a badge, so it is tested
 * from both ends: a legitimate resident must not be turned away by Livd's own
 * coordinate rounding, and a position that is nowhere near the building must
 * not get through however the accuracy is declared.
 */

/** A point offset from another by a distance, in metres, due north. */
function north(from: { latitude: number; longitude: number }, meters: number) {
  return { latitude: from.latitude + meters / 111_320, longitude: from.longitude };
}

/** A dense-urban property, stored at Livd's three decimal places. */
const PROPERTY = { latitude: 51.546, longitude: -0.052 };
const NOW = new Date('2026-09-08T12:00:00.000Z');

const position = (
  coords: { latitude: number; longitude: number },
  overrides: Partial<{ accuracyMeters: number; capturedAtMs: number }> = {},
) => ({
  ...coords,
  accuracyMeters: overrides.accuracyMeters ?? 20,
  capturedAtMs: overrides.capturedAtMs ?? NOW.getTime() - 5_000,
});

describe('haversineMeters', () => {
  it('is zero for a point against itself', () => {
    expect(haversineMeters(PROPERTY, PROPERTY)).toBe(0);
  });

  it('measures a known north-south offset to within a metre', () => {
    expect(haversineMeters(PROPERTY, north(PROPERTY, 100))).toBeCloseTo(100, 0);
  });

  it('is symmetric', () => {
    const a = haversineMeters(PROPERTY, { latitude: 40.694, longitude: -73.957 });
    const b = haversineMeters({ latitude: 40.694, longitude: -73.957 }, PROPERTY);
    expect(a).toBeCloseTo(b, 6);
  });

  it('agrees with a known intercity distance', () => {
    // London to Paris, centre to centre — about 344km.
    const km =
      haversineMeters({ latitude: 51.5074, longitude: -0.1278 }, { latitude: 48.8566, longitude: 2.3522 }) / 1000;
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(348);
  });
});

describe('isValidCoordinates', () => {
  it('rejects out-of-range values', () => {
    expect(isValidCoordinates({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidCoordinates({ latitude: 0, longitude: 181 })).toBe(false);
    expect(isValidCoordinates({ latitude: Number.NaN, longitude: 0 })).toBe(false);
  });

  it('rejects null island, which is a coerced null far more often than a place', () => {
    expect(isValidCoordinates({ latitude: 0, longitude: 0 })).toBe(false);
  });
});

describe('proximityBudget', () => {
  it('carries the grid uncertainty Livd introduces by rounding its own coordinates', () => {
    // Three decimal places means the stored point names a ~110m cell, so the
    // building can be up to half a cell away in each axis. Ignoring this would
    // silently shrink the radius by most of a city block.
    const budget = proximityBudget(PROPERTY, 20, 'GB');
    expect(budget.gridUncertaintyMeters).toBeGreaterThan(50);
    expect(budget.gridUncertaintyMeters).toBeLessThan(80);
  });

  it('shrinks the grid term toward the poles, where a degree of longitude is short', () => {
    const equator = proximityBudget({ latitude: 0, longitude: 0.001 }, 20, null);
    const arctic = proximityBudget({ latitude: 78, longitude: 15 }, 20, null);
    expect(arctic.gridUncertaintyMeters).toBeLessThan(equator.gridUncertaintyMeters);
  });

  it('caps the accuracy allowance, so nobody can buy radius by claiming a bad fix', () => {
    const honest = proximityBudget(PROPERTY, 40, 'GB');
    const inflated = proximityBudget(PROPERTY, 5_000, 'GB');

    expect(honest.accuracyAllowanceMeters).toBe(40);
    expect(inflated.accuracyAllowanceMeters).toBe(
      VERIFICATION_GEO.accuracyAllowanceCapMeters,
    );
  });

  it('sums to radius + grid + accuracy', () => {
    const budget = proximityBudget(PROPERTY, 30, 'GB');
    expect(budget.totalMeters).toBeCloseTo(
      budget.radiusMeters + budget.gridUncertaintyMeters + budget.accuracyAllowanceMeters,
      6,
    );
  });
});

describe('decideProximity', () => {
  const base = { propertyCoordinates: PROPERTY, countryCode: 'GB', now: NOW };

  it('verifies someone standing at the property', () => {
    expect(decideProximity({ ...base, position: position(PROPERTY) })).toEqual({
      verified: true,
    });
  });

  it('verifies a resident whose building is at the far edge of the stored cell', () => {
    // The scenario the grid term exists for: the true building is 78m from the
    // stored point because of rounding, and the resident is 100m from that.
    const result = decideProximity({
      ...base,
      position: position(north(PROPERTY, 175), { accuracyMeters: 35 }),
    });
    expect(result).toEqual({ verified: true });
  });

  it('refuses a position on the other side of the city', () => {
    expect(
      decideProximity({ ...base, position: position(north(PROPERTY, 4_000)) }),
    ).toEqual({ verified: false, reason: 'outside_area' });
  });

  it('refuses a reading too vague to mean anything', () => {
    expect(
      decideProximity({
        ...base,
        position: position(PROPERTY, {
          accuracyMeters: VERIFICATION_GEO.maxAcceptableAccuracyMeters + 1,
        }),
      }),
    ).toEqual({ verified: false, reason: 'accuracy_too_low' });
  });

  it('refuses a fabricated accuracy of zero rather than treating it as a perfect fix', () => {
    expect(
      decideProximity({ ...base, position: position(PROPERTY, { accuracyMeters: 0 }) }),
    ).toEqual({ verified: false, reason: 'invalid_position' });
  });

  it('refuses a replayed fix from yesterday', () => {
    expect(
      decideProximity({
        ...base,
        position: position(PROPERTY, { capturedAtMs: NOW.getTime() - 86_400_000 }),
      }),
    ).toEqual({ verified: false, reason: 'fix_too_old' });
  });

  it('refuses a fix timestamped in the future', () => {
    expect(
      decideProximity({
        ...base,
        position: position(PROPERTY, { capturedAtMs: NOW.getTime() + 86_400_000 }),
      }),
    ).toEqual({ verified: false, reason: 'fix_too_old' });
  });

  it('tolerates ordinary clock skew between a handset and a server', () => {
    expect(
      decideProximity({
        ...base,
        position: position(PROPERTY, { capturedAtMs: NOW.getTime() + 30_000 }),
      }),
    ).toEqual({ verified: true });
  });

  it('refuses when the property has no coordinates, rather than guessing', () => {
    expect(
      decideProximity({ ...base, propertyCoordinates: null, position: position(PROPERTY) }),
    ).toEqual({ verified: false, reason: 'property_has_no_coordinates' });
  });

  it('reports the cheapest refusal first, so a prober learns nothing about distance', () => {
    // Far away *and* inaccurate. The answer names the accuracy, never the miss,
    // because a refusal that reports the miss is a range-finder.
    const result = decideProximity({
      ...base,
      position: position(north(PROPERTY, 50_000), { accuracyMeters: 400 }),
    });
    expect(result).toEqual({ verified: false, reason: 'accuracy_too_low' });
  });

  it('never returns a distance in any outcome', () => {
    const outcomes = [
      decideProximity({ ...base, position: position(PROPERTY) }),
      decideProximity({ ...base, position: position(north(PROPERTY, 9_000)) }),
    ];

    for (const outcome of outcomes) {
      expect(JSON.stringify(outcome)).not.toMatch(/\d{3,}/);
      expect(Object.keys(outcome)).not.toContain('distanceMeters');
    }
  });
});

describe('isImplausibleMovement', () => {
  const london = { latitude: 51.546, longitude: -0.052 };
  const lagos = { latitude: 6.442, longitude: 3.472 };
  const nextDoor = { latitude: 51.5462, longitude: -0.0522 };

  it('catches a script walking two continents in ten minutes', () => {
    expect(
      isImplausibleMovement({
        previousPropertyCoordinates: london,
        currentPropertyCoordinates: lagos,
        elapsedSeconds: 600,
      }),
    ).toBe(true);
  });

  it('permits the same journey given a day', () => {
    expect(
      isImplausibleMovement({
        previousPropertyCoordinates: london,
        currentPropertyCoordinates: lagos,
        elapsedSeconds: 86_400,
      }),
    ).toBe(false);
  });

  it('never fires on two properties in the same complex, whatever the interval', () => {
    expect(
      isImplausibleMovement({
        previousPropertyCoordinates: london,
        currentPropertyCoordinates: nextDoor,
        elapsedSeconds: 1,
      }),
    ).toBe(false);
  });

  it('treats a zero interval across a real distance as impossible', () => {
    expect(
      isImplausibleMovement({
        previousPropertyCoordinates: london,
        currentPropertyCoordinates: lagos,
        elapsedSeconds: 0,
      }),
    ).toBe(true);
  });

  it('does not fire on a genuine long-haul flight', () => {
    // London to New York, eight hours. Well under the threshold, which is set
    // above commercial aviation on purpose so travel is never the explanation.
    expect(
      isImplausibleMovement({
        previousPropertyCoordinates: london,
        currentPropertyCoordinates: { latitude: 40.694, longitude: -73.957 },
        elapsedSeconds: 8 * 3600,
      }),
    ).toBe(false);
  });
});
