/**
 * Deterministic randomness for the sample dataset.
 *
 * Every value in the seed is drawn from a generator keyed by a stable string —
 * a property's key, a review's key — so the same configuration produces the
 * same dataset on every machine and every run, and a record's content depends
 * on its own key rather than on how many records were generated before it.
 * That last property is what lets a city grow from 100 properties to 200
 * without the first 100 changing.
 */

/** A small, fast, well-distributed 32-bit generator. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, for turning a key into a seed. */
export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A generator keyed by a string. */
export function rngFor(key: string): () => number {
  return mulberry32(hashSeed(key));
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

export function pickSome<T>(random: () => number, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const chosen: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
  }
  return chosen;
}

/** Picks by weight. Weights need not sum to anything in particular. */
export function pickWeighted<T>(random: () => number, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[entries.length - 1]![0];
}

/** An integer in [min, max], inclusive. */
export function intBetween(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Clamped 1–5 draw around a mean, so a profile produces a spread not a constant. */
export function drawRating(random: () => number, mean: number, spread = 0.9): number {
  const noise = (random() + random() + random() - 1.5) * spread * 1.4;
  return Math.max(1, Math.min(5, Math.round(mean + noise)));
}
