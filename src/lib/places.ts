/**
 * The URL shape of the place hierarchy.
 *
 * Country → city → neighbourhood → property is the spine of Livd's
 * information architecture, and until now each level's URL was spelled out
 * by hand in whichever file happened to need it — twice in the local store,
 * once in the Supabase adapter, once in the property header. Four copies of
 * a lowercase-and-encode rule is three chances for one of them to drift and
 * produce a link that 404s.
 *
 * Lowercased because these segments are matched case-insensitively at the
 * other end and a single canonical spelling is what keeps an index from
 * treating `/places/gb/london` and `/places/GB/London` as two pages. The
 * stored spelling is still what the page *renders*; only the URL is folded.
 */

export function countryHref(countryCode: string): string {
  return `/places/${countryCode.toLowerCase()}`;
}

export function localityHref(countryCode: string, locality: string): string {
  return `${countryHref(countryCode)}/${encodeURIComponent(locality.toLowerCase())}`;
}

export function neighbourhoodHref(
  countryCode: string,
  locality: string,
  neighbourhood: string,
): string {
  return `${localityHref(countryCode, locality)}/${encodeURIComponent(
    neighbourhood.toLowerCase(),
  )}`;
}

/**
 * A path segment back to something readable.
 *
 * A malformed percent-escape throws out of `decodeURIComponent`, and a bad
 * URL must render a not-found page rather than a 500 — so the raw segment is
 * the fallback, and the lookup it feeds simply finds nothing.
 */
export function decodePlaceSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
