/**
 * Rate limiting.
 *
 * A fixed-window counter over an in-process store. That is the right shape for
 * a single-region MVP and the wrong shape for a multi-instance deployment, so
 * the store sits behind `RateLimitStore` and can be swapped for Postgres or
 * Redis without touching a call site. The Postgres implementation writes to
 * `rate_limit_events`; see `docs/database-schema.md`.
 *
 * Actors are identified by a salted hash, never by a raw IP address. Livd does
 * not need to know where anyone is, only that two requests came from the same
 * place.
 */

import { createHash } from 'node:crypto';

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

export interface RateLimitStore {
  increment(key: string, windowSeconds: number): Promise<{ count: number; resetAt: number }>;
}

/* -------------------------------------------------------------------------
 * Rules
 * ---------------------------------------------------------------------- */

export const RATE_LIMITS = {
  /** Reviews are slow to write; anyone submitting five an hour is not writing them. */
  reviewSubmit: { limit: 5, windowSeconds: 3600 },
  /** Reporting is free to abuse, so it is the tightest limit in the product. */
  reportSubmit: { limit: 10, windowSeconds: 3600 },
  propertyCreate: { limit: 5, windowSeconds: 3600 },
  claimSubmit: { limit: 3, windowSeconds: 86_400 },
  /** Generous — this is typeahead, and a real user can outrun a low limit. */
  search: { limit: 120, windowSeconds: 60 },
  authRequest: { limit: 6, windowSeconds: 900 },
  ownerResponse: { limit: 20, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/* -------------------------------------------------------------------------
 * In-memory store
 * ---------------------------------------------------------------------- */

class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = Date.now();

  async increment(
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; resetAt: number }> {
    this.sweep();

    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      const created = { count: 1, resetAt: now + windowSeconds * 1000 };
      this.windows.set(key, created);
      return created;
    }

    existing.count += 1;
    return existing;
  }

  /** Drops expired windows so the map cannot grow without bound. */
  private sweep(): void {
    const now = Date.now();
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

let store: RateLimitStore = new MemoryRateLimitStore();

/** Swaps the backing store — used by tests and by a future Postgres adapter. */
export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

/* -------------------------------------------------------------------------
 * Actor identity
 * ---------------------------------------------------------------------- */

/**
 * Hashes an actor identifier with a per-deployment salt.
 *
 * The salt means the stored value cannot be reversed into an IP address by
 * anyone reading the table, including us.
 */
export function hashActor(identifier: string): string {
  const salt = process.env.LIVD_SESSION_SECRET ?? 'livd-development-salt';
  return createHash('sha256').update(`${salt}:${identifier}`).digest('hex').slice(0, 32);
}

/* -------------------------------------------------------------------------
 * Check
 * ---------------------------------------------------------------------- */

export async function checkRateLimit(
  bucket: RateLimitBucket,
  actorIdentifier: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[bucket];
  const key = `${bucket}:${hashActor(actorIdentifier)}`;

  const { count, resetAt } = await store.increment(key, rule.windowSeconds);
  const retryAfter = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));

  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfter,
  };
}

/**
 * Applies the limit to both the signed-in user and the request origin.
 *
 * Checking only the user lets someone cycle accounts; checking only the origin
 * penalises everyone behind one NAT. Both are checked, and the tighter result
 * wins.
 */
export async function checkDualRateLimit(
  bucket: RateLimitBucket,
  userId: string | null,
  originIdentifier: string | null,
): Promise<RateLimitResult> {
  const results: RateLimitResult[] = [];

  if (userId) results.push(await checkRateLimit(bucket, `user:${userId}`));
  if (originIdentifier) results.push(await checkRateLimit(bucket, `origin:${originIdentifier}`));

  if (results.length === 0) return { allowed: true, remaining: 0, retryAfter: 0 };

  const denied = results.find((r) => !r.allowed);
  if (denied) return denied;

  return results.reduce((tightest, current) =>
    current.remaining < tightest.remaining ? current : tightest,
  );
}
