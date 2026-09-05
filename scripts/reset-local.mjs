import { rmSync } from 'node:fs';

/**
 * Resets local development state.
 *
 * Clears both the file-backed data store *and* the Next.js build cache. Both
 * matter: `unstable_cache` persists property aggregates under `.next` across
 * dev-server restarts, so deleting `.data` alone leaves the previous seed's
 * numbers rendering from cache with no indication anything is stale. That
 * combination cost real debugging time once; this script exists so it cannot
 * cost it again.
 */

const targets = ['.data', '.next'];

for (const target of targets) {
  rmSync(target, { recursive: true, force: true });
}

console.log(`Cleared ${targets.join(' and ')}. The next \`npm run dev\` reseeds from scratch.`);
