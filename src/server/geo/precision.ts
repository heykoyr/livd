import type { CreatePropertyInput } from '@/server/data/repository';
import type { GeocodeCandidate, GeocodeResult } from './types';

/**
 * The one gate every provider's answer passes through.
 *
 * Why this file exists at all: a wrong coordinate is materially worse than no
 * coordinate. Without one, the review wizard simply does not offer the
 * verification step. With a wrong one, it offers the step and the resident
 * cannot pass it — they are standing at their own front door being told they
 * are not there, with no way to tell whether the product is broken or accusing
 * them.
 *
 * So the bar is deliberately high and every provider is held to the same one.
 */

/**
 * A feature larger than this is not a building.
 *
 * Generous enough for a genuinely large apartment block or a gated compound,
 * tight enough to exclude a road. Measured, not classified — see the note on
 * `GeocodeCandidate.spanMeters`.
 */
export const MAXIMUM_FEATURE_SPAN_METERS = 250;

/** Precision labels good enough to verify a resident against. */
export const ACCEPTABLE_PRECISION = ['building', 'interpolated'] as const;

/**
 * Strips accents and punctuation so "Zürich" and "Zurich" compare equal.
 *
 * Livd serves markets where the accented spelling and the unaccented one are
 * both in everyday use, and a provider may return either.
 */
function normalise(value: string): string {
  return value
    .normalize('NFD')
    // The Unicode combining-mark block.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Is the answer in the place we asked about?
 *
 * Lenient by design. Providers report localities inconsistently — a Lagos
 * address may come back as "Lagos", "Eti-Osa", "Lagos State" or nothing at all
 * — so a result that names no locality is accepted rather than second-guessed,
 * and a partial match in either direction counts. The check exists to catch the
 * clearly-wrong-city case, not to adjudicate administrative boundaries.
 */
export function localityMatches(found: string | null, expected: string): boolean {
  if (!found) return true;

  const a = normalise(found);
  const b = normalise(expected);
  if (!a || !b) return true;

  return a.includes(b) || b.includes(a);
}

/**
 * Accepts a candidate, or refuses it and says nothing further.
 *
 * There is deliberately no "confidence score" returned here and no partial
 * credit. A coordinate is either good enough to verify a resident against or it
 * is not stored, because a coordinate carrying a caveat would need every
 * downstream consumer to honour the caveat, and one of them eventually would
 * not.
 */
export function acceptCandidate(
  candidate: GeocodeCandidate | null,
  input: CreatePropertyInput,
): GeocodeResult | null {
  if (!candidate) return null;

  if (!(ACCEPTABLE_PRECISION as readonly string[]).includes(candidate.precision)) {
    return null;
  }

  if (
    candidate.spanMeters !== null &&
    candidate.spanMeters > MAXIMUM_FEATURE_SPAN_METERS
  ) {
    return null;
  }

  if (!localityMatches(candidate.locality, input.locality)) return null;

  const { latitude, longitude } = candidate;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;
  // 0,0 is in the Gulf of Guinea and is a parse failure far more often than it
  // is an address.
  if (latitude === 0 && longitude === 0) return null;

  return { latitude, longitude };
}

/**
 * The longest side of a bounding box, in metres.
 *
 * Takes the corners in the order every provider happens to disagree about, so
 * callers pass named values rather than a tuple nobody can remember.
 */
export function spanMeters(box: {
  south: number;
  north: number;
  west: number;
  east: number;
}): number {
  const { south, north, west, east } = box;
  if (![south, north, west, east].every(Number.isFinite)) {
    return Number.POSITIVE_INFINITY;
  }

  const latSpan = Math.abs(north - south) * 111_320;
  const lonSpan = Math.abs(east - west) * 111_320 * Math.cos((south * Math.PI) / 180);

  return Math.max(latSpan, lonSpan);
}

/**
 * The single line of address a provider's free-text field should receive.
 *
 * Building name first where there is one, because in the markets this feature
 * exists to reach — Lagos, Dubai, Mumbai — a named building is very often the
 * thing the map data actually holds, while the house number is not.
 *
 * Nominatim is the exception and does not use this: its structured `street`
 * field takes "housenumber street" and breaks on anything else.
 */
export function singleLineAddress(input: CreatePropertyInput): string {
  return [
    input.buildingName,
    input.streetAddress,
    input.neighbourhood,
    input.locality,
    input.adminArea,
    input.postalCode,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');
}
