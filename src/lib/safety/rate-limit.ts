/**
 * Rate limiting.
 *
 * A sliding-window counter behind `RateLimitStore`, with two implementations.
 * Postgres is used wherever it is available, because an in-process counter on
 * a serverless platform enforces the configured limit *per warm instance* —
 * the real ceiling is that number multiplied by however many are running, and
 * nothing in the code says so. The in-process store remains for the local
 * adapter, for tests, and as the fallback when Postgres cannot be reached.
 *
 * Actors are identified by a salted hash, never by a raw IP address. Livd does
 * not need to know where anyone is, only that two requests came from the same
 * place.
 */

import { createHash } from 'node:crypto';

import { resolveDataBackend } from '@/config/site';

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
  /**
   * Records one request and returns how many that actor has made inside the
   * window, plus the moment the window next admits another.
   *
   * Bucket and actor are separate arguments rather than one composite key so
   * a store can index them independently — the Postgres one does.
   */
  increment(
    bucket: string,
    actorHash: string,
    windowSeconds: number,
  ): Promise<{ count: number; resetAt: number }>;
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
  /** Each one costs a moderator a document to read. Tight on purpose. */
  verificationSubmit: { limit: 5, windowSeconds: 86_400 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/* -------------------------------------------------------------------------
 * In-memory store
 * ---------------------------------------------------------------------- */

class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = Date.now();

  async increment(
    bucket: string,
    actorHash: string,
    windowSeconds: number,
  ): Promise<{ count: number; resetAt: number }> {
    this.sweep();

    const key = `${bucket}:${actorHash}`;
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

const memoryStore = new MemoryRateLimitStore();

/** Set by a test, or by the first call that resolves the real store. */
let store: RateLimitStore | null = null;

/** Swaps the backing store. Tests use this; nothing else needs to. */
export function setRateLimitStore(next: RateLimitStore | null): void {
  store = next;
}

/**
 * Picks a store on first use.
 *
 * Resolved lazily and imported dynamically so that the Supabase client never
 * enters the module graph of a deployment running the local adapter, and so a
 * missing service-role key degrades rather than throwing at import time.
 */
async function resolveStore(): Promise<RateLimitStore> {
  if (store) return store;

  const usable =
    resolveDataBackend() === 'supabase' && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!usable) {
    if (process.env.NODE_ENV === 'production' && !warnedAboutMemory) {
      warnedAboutMemory = true;
      console.warn(
        '[livd] Rate limiting is counting in process memory. On a serverless ' +
          'platform that means the configured limit applies per warm instance, ' +
          'not per person. Set SUPABASE_SERVICE_ROLE_KEY to count in Postgres.',
      );
    }
    store = memoryStore;
    return store;
  }

  const { PostgresRateLimitStore } = await import('@/server/data/supabase/rate-limit-store');
  store = new PostgresRateLimitStore();
  return store;
}

let warnedAboutMemory = false;
let warnedAboutFallback = false;

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
  return saltedHash(identifier).slice(0, 32);
}

/**
 * A salted digest of some short string.
 *
 * The salt is what does the work. An unsalted hash of anything drawn from a
 * small space — an IP address, a search for a street name — is reversible by
 * anyone who can read the column and think of a wordlist, which is not a hash
 * so much as an obfuscation.
 */
export function saltedHash(value: string): string {
  const salt = process.env.LIVD_SESSION_SECRET ?? 'livd-development-salt';
  return createHash('sha256').update(`${salt}:${value}`).digest('hex');
}

/* -------------------------------------------------------------------------
 * Check
 * ---------------------------------------------------------------------- */

/**
 * Counts one hit, falling back to the in-process store if Postgres is
 * unreachable.
 *
 * Failing closed would turn a database blip into "nobody may write anything",
 * which is a worse outcome than the one this control exists to prevent.
 * Failing fully open would remove the control. Falling back degrades it to
 * per-instance counting — the behaviour this replaced — and says so once.
 */
async function countHit(
  bucket: string,
  actorHash: string,
  windowSeconds: number,
): Promise<{ count: number; resetAt: number }> {
  try {
    const active = await resolveStore();
    return await active.increment(bucket, actorHash, windowSeconds);
  } catch (error) {
    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      console.error(
        '[livd] Rate limit store unavailable; counting in process memory for now.',
        error,
      );
    }
    return memoryStore.increment(bucket, actorHash, windowSeconds);
  }
}

export async function checkRateLimit(
  bucket: RateLimitBucket,
  actorIdentifier: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[bucket];
  const actorHash = hashActor(actorIdentifier);

  const { count, resetAt } = await countHit(bucket, actorHash, rule.windowSeconds);
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
