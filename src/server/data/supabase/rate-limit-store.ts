import 'server-only';

import { createServiceRoleClient } from '@/server/auth/supabase-client';
import type { RateLimitStore } from '@/lib/safety/rate-limit';

/**
 * Rate limit counters in Postgres.
 *
 * The in-process store counts per instance, which on a serverless platform
 * means the effective limit is whatever was configured multiplied by however
 * many instances happen to be warm. This one counts once, for everybody.
 *
 * All of the work — prune, record, count, and when a slot next frees up —
 * happens inside `livd_rate_limit_hit`, in one round trip, under an advisory
 * lock keyed on the actor. See `supabase/migrations/0009_rate_limit_in_postgres.sql`
 * for why each of those matters.
 *
 * The service role is required and is the point: the function is not an
 * endpoint, and a browser-callable version would let anyone holding the public
 * anon key write unbounded rows under actor hashes of their own invention.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  async increment(
    bucket: string,
    actorHash: string,
    windowSeconds: number,
  ): Promise<{ count: number; resetAt: number }> {
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .rpc('livd_rate_limit_hit', {
        p_bucket: bucket,
        p_actor_hash: actorHash,
        p_window_seconds: windowSeconds,
      })
      .single<{ hit_count: number; reset_at: string }>();

    if (error || !data) {
      throw new Error(`rate limit store: ${error?.message ?? 'no row returned'}`);
    }

    return { count: data.hit_count, resetAt: new Date(data.reset_at).getTime() };
  }
}
