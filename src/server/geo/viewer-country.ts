import 'server-only';

import { headers } from 'next/headers';

import { MARKETS } from '@/config/markets';
import type { CountryCode, UserProfile } from '@/types/domain';

/**
 * Which country to show a visitor first.
 *
 * Livd is a global product, and the most common reason to use it is that
 * somebody is moving. So this exists to pick a *default*, and nothing more: it
 * decides which country's recently-reviewed properties appear before the
 * visitor has told Livd anything, and it never narrows what they can reach.
 * Search stays worldwide, every country Livd holds data for is one link away,
 * and the full index is always linked. Local by default is not local only.
 *
 * Two signals, in that order of deliberateness:
 *
 *   1. The country on the account. Somebody typed that, and it is the only
 *      signal that survives a visitor being abroad for a fortnight.
 *   2. The country the edge attached to the request — `x-vercel-ip-country`
 *      in this deployment, `cf-ipcountry` behind Cloudflare. Coarse by
 *      construction: a two-letter code, derived upstream from an address Livd
 *      never sees.
 *
 * What this deliberately does not do:
 *
 *   - Ask the browser for a position. A country is not worth a permission
 *     prompt, and the one place Livd does ask is a button somebody pressed.
 *   - Store or log anything. The code is read from a header, used to choose a
 *     cache key, and discarded with the request. No row, no cookie, no
 *     analytics event.
 *   - Return a country Livd has no market configuration for. A code that is
 *     not a configured market is treated as unknown, which produces the global
 *     view rather than an empty country page.
 */

/**
 * Headers a CDN or platform may set, in the order they are trusted.
 *
 * Only ever read for this one purpose. An inbound request can of course forge
 * any of them, which is why nothing is authorised on the result — the worst a
 * forged header achieves is a different country's discovery list, which is a
 * link away regardless.
 */
const EDGE_COUNTRY_HEADERS = [
  'x-vercel-ip-country',
  'cf-ipcountry',
  'x-geo-country',
] as const;

function asMarketCountry(value: string | null | undefined): CountryCode | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return code in MARKETS ? code : null;
}

/** The coarse country the edge attached to this request, if any. */
export async function edgeCountry(): Promise<CountryCode | null> {
  try {
    const headerList = await headers();
    for (const name of EDGE_COUNTRY_HEADERS) {
      const resolved = asMarketCountry(headerList.get(name));
      if (resolved) return resolved;
    }
  } catch {
    // No request scope — a build-time render, for instance. The global view is
    // the correct answer there, not a failure.
  }

  return null;
}

/**
 * The country to scope discovery to, or null for the global view.
 *
 * Pass the signed-in profile where one is already loaded; this never fetches a
 * session of its own, because a discovery section is not a reason to read an
 * identity.
 */
export async function viewerCountry(
  user: UserProfile | null = null,
): Promise<CountryCode | null> {
  return asMarketCountry(user?.countryCode) ?? (await edgeCountry());
}
