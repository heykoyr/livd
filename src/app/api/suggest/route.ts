import { NextResponse } from 'next/server';

import { LIMITS } from '@/config/site';
import { checkRateLimit } from '@/lib/safety/rate-limit';
import { getRepository } from '@/server/data';

/**
 * Search suggestions.
 *
 * A read-only endpoint returning only public property identity — never a
 * review, an author, or anything derived from who is asking. Rate limited by
 * origin, because typeahead is the cheapest endpoint in the product to abuse
 * for scraping.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 120);

  if (query.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  // Proxy headers are the only origin signal available; they are hashed with a
  // per-deployment salt before ever being stored.
  const origin =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const limit = await checkRateLimit('search', origin);
  if (!limit.allowed) {
    return NextResponse.json(
      { suggestions: [], error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  try {
    const repository = await getRepository();
    const suggestions = await repository.suggest(query, LIMITS.suggestionCount);

    return NextResponse.json(
      { suggestions },
      {
        headers: {
          // Suggestions are identical for everyone, so they cache publicly.
          'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
        },
      },
    );
  } catch {
    // A failed suggestion lookup must degrade to an empty list, never to an
    // error state that blocks the user from submitting the search itself.
    return NextResponse.json({ suggestions: [] }, { status: 200 });
  }
}
