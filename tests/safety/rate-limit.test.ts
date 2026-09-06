import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RATE_LIMITS,
  checkDualRateLimit,
  checkRateLimit,
  hashActor,
  setRateLimitStore,
  type RateLimitStore,
} from '@/lib/safety/rate-limit';

/**
 * Rate limiting.
 *
 * The control that decides whether a write happens at all, so the interesting
 * cases are the boundaries — the request that is still allowed, the first one
 * that is not — and the behaviour when the store itself fails. A limiter that
 * throws when its database hiccups converts a blip into an outage.
 */

/** A store with the semantics of the real one, held entirely in the test. */
function fakeStore() {
  const hits = new Map<string, number[]>();

  const store: RateLimitStore = {
    async increment(bucket, actorHash, windowSeconds) {
      const key = `${bucket}:${actorHash}`;
      const now = Date.now();
      const cutoff = now - windowSeconds * 1000;

      const kept = (hits.get(key) ?? []).filter((at) => at >= cutoff);
      kept.push(now);
      hits.set(key, kept);

      return { count: kept.length, resetAt: kept[0]! + windowSeconds * 1000 };
    },
  };

  return { store, hits };
}

beforeEach(() => {
  setRateLimitStore(fakeStore().store);
});

afterEach(() => {
  setRateLimitStore(null);
});

describe('counting', () => {
  it('allows exactly the configured number of requests, then stops', async () => {
    const { limit } = RATE_LIMITS.reviewSubmit;
    const results = [];

    for (let i = 0; i < limit + 2; i += 1) {
      results.push(await checkRateLimit('reviewSubmit', 'user:someone'));
    }

    expect(results.slice(0, limit).every((r) => r.allowed)).toBe(true);
    expect(results[limit]!.allowed).toBe(false);
    expect(results[limit + 1]!.allowed).toBe(false);
  });

  it('reports how many remain, and never a negative number', async () => {
    const { limit } = RATE_LIMITS.reportSubmit;

    const first = await checkRateLimit('reportSubmit', 'user:a');
    expect(first.remaining).toBe(limit - 1);

    for (let i = 0; i < limit + 3; i += 1) {
      await checkRateLimit('reportSubmit', 'user:a');
    }

    const exhausted = await checkRateLimit('reportSubmit', 'user:a');
    expect(exhausted.remaining).toBe(0);
  });

  it('gives each actor its own allowance', async () => {
    const { limit } = RATE_LIMITS.reviewSubmit;
    for (let i = 0; i < limit + 1; i += 1) {
      await checkRateLimit('reviewSubmit', 'user:noisy');
    }

    expect((await checkRateLimit('reviewSubmit', 'user:noisy')).allowed).toBe(false);
    expect((await checkRateLimit('reviewSubmit', 'user:quiet')).allowed).toBe(true);
  });

  it('gives each bucket its own allowance', async () => {
    const { limit } = RATE_LIMITS.claimSubmit;
    for (let i = 0; i < limit + 1; i += 1) {
      await checkRateLimit('claimSubmit', 'user:a');
    }

    expect((await checkRateLimit('claimSubmit', 'user:a')).allowed).toBe(false);
    expect((await checkRateLimit('reviewSubmit', 'user:a')).allowed).toBe(true);
  });

  it('frees the allowance again once the window has passed', async () => {
    vi.useFakeTimers();
    try {
      const { limit, windowSeconds } = RATE_LIMITS.reviewSubmit;

      for (let i = 0; i < limit + 1; i += 1) {
        await checkRateLimit('reviewSubmit', 'user:patient');
      }
      expect((await checkRateLimit('reviewSubmit', 'user:patient')).allowed).toBe(false);

      vi.advanceTimersByTime(windowSeconds * 1000 + 1000);

      expect((await checkRateLimit('reviewSubmit', 'user:patient')).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says how long to wait, in seconds, never longer than the window', async () => {
    const { limit, windowSeconds } = RATE_LIMITS.reviewSubmit;
    let last = await checkRateLimit('reviewSubmit', 'user:a');

    for (let i = 0; i < limit + 1; i += 1) {
      last = await checkRateLimit('reviewSubmit', 'user:a');
    }

    expect(last.allowed).toBe(false);
    expect(last.retryAfter).toBeGreaterThan(0);
    expect(last.retryAfter).toBeLessThanOrEqual(windowSeconds);
  });
});

describe('user and origin together', () => {
  it('denies when either one is exhausted', async () => {
    const { limit } = RATE_LIMITS.reviewSubmit;

    // Burn the origin's allowance through a different account.
    for (let i = 0; i < limit + 1; i += 1) {
      await checkDualRateLimit('reviewSubmit', `user:sock-${i}`, 'origin:one-address');
    }

    const fresh = await checkDualRateLimit('reviewSubmit', 'user:brand-new', 'origin:one-address');
    expect(fresh.allowed).toBe(false);
  });

  it('reports the tighter of the two while both still allow', async () => {
    const { limit } = RATE_LIMITS.reviewSubmit;

    for (let i = 0; i < 2; i += 1) {
      await checkDualRateLimit('reviewSubmit', `user:other-${i}`, 'origin:shared');
    }

    const result = await checkDualRateLimit('reviewSubmit', 'user:fresh', 'origin:shared');
    expect(result.allowed).toBe(true);
    // The origin has spent three; the user, one.
    expect(result.remaining).toBe(limit - 3);
  });

  it('allows when there is nothing to identify the caller by', async () => {
    const result = await checkDualRateLimit('reviewSubmit', null, null);
    expect(result.allowed).toBe(true);
  });
});

describe('actor hashing', () => {
  it('is stable for the same identifier and different for another', () => {
    expect(hashActor('203.0.113.4')).toBe(hashActor('203.0.113.4'));
    expect(hashActor('203.0.113.4')).not.toBe(hashActor('203.0.113.5'));
  });

  it('never contains the identifier it was given', () => {
    const identifier = '203.0.113.4';
    const hashed = hashActor(identifier);

    expect(hashed).not.toContain(identifier);
    expect(hashed).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('when the store fails', () => {
  it('keeps counting in memory rather than throwing', async () => {
    const broken: RateLimitStore = {
      async increment() {
        throw new Error('connection refused');
      },
    };
    setRateLimitStore(broken);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Degraded, but still a limiter: the allowance is enforced, per instance.
    const { limit } = RATE_LIMITS.reviewSubmit;
    let last = await checkRateLimit('reviewSubmit', 'user:during-an-outage');
    expect(last.allowed).toBe(true);

    for (let i = 0; i < limit + 1; i += 1) {
      last = await checkRateLimit('reviewSubmit', 'user:during-an-outage');
    }
    expect(last.allowed).toBe(false);

    expect(spy).toHaveBeenCalled();
  });
});
