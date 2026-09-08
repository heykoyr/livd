/**
 * Spherical distance.
 *
 * Pure, dependency-free, and always in metres. Metres are the only unit that
 * crosses a module boundary in this codebase — miles and kilometres are a
 * presentation concern and are produced by `src/lib/format`, at the edge, from
 * the reader's own locale.
 */

/** Mean Earth radius, metres. WGS-84 authalic. */
const EARTH_RADIUS_METERS = 6_371_008.8;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two points, in metres.
 *
 * Haversine rather than Vincenty: the error against the ellipsoid is about
 * 0.3%, which at the distances this product cares about — a few hundred metres
 * — is under a metre, far inside the uncertainty already carried by a phone's
 * GPS fix and by Livd's own rounded coordinates.
 */
export function haversineMeters(from: Coordinates, to: Coordinates): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Metres in one degree of latitude. Constant everywhere, to a good approximation. */
export function metersPerDegreeLatitude(): number {
  return (Math.PI / 180) * EARTH_RADIUS_METERS;
}

/**
 * Metres in one degree of longitude at a given latitude.
 *
 * Collapses toward zero at the poles, which is why the grid-uncertainty budget
 * is computed per property rather than assumed from an equatorial figure.
 */
export function metersPerDegreeLongitude(latitude: number): number {
  return metersPerDegreeLatitude() * Math.cos(toRadians(latitude));
}

/** True when a value is a usable WGS-84 coordinate pair. */
export function isValidCoordinates(value: {
  latitude: number;
  longitude: number;
}): boolean {
  return (
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    value.longitude >= -180 &&
    value.longitude <= 180 &&
    // 0,0 is in the Gulf of Guinea and is overwhelmingly a null that has been
    // coerced to a number somewhere upstream rather than a real position.
    !(value.latitude === 0 && value.longitude === 0)
  );
}
