import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // See tests/stubs/server-only.ts — the real package throws on import.
      // fileURLToPath, not URL.pathname — the latter yields "/C:/..." on Windows.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,

    /**
     * A hang detector, not a performance budget.
     *
     * Seventeen suites call `vi.resetModules()` in `beforeEach` and then import
     * the data layer inside the test itself, because what they are testing is
     * partly the module-level cache in `src/server/data/local/store.ts` and a
     * cache shared between tests would prove nothing. The cost is that every
     * one of those tests re-executes a module graph of some five thousand lines,
     * and the test that happens to hit it cold pays the transform as well.
     *
     * Measured across a full run: the slowest test takes 6.1s and the next 5.2s,
     * both in `tests/search/global-reach.test.ts`; nothing anywhere reaches 10s,
     * and the median test outside that pattern is 3ms. Against Vitest's 5s
     * default that left two tests permanently on the line and a further handful
     * crossing it whenever the machine was busy — which is what made the suite
     * flaky rather than any test being wrong.
     *
     * 15s is roughly two and a half times the measured worst case. A test that
     * has genuinely hung never resolves, so it is still caught; it simply is not
     * caught by accident.
     */
    testTimeout: 15_000,
    hookTimeout: 15_000,

    /**
     * `pool` is left at the default `forks` deliberately. Twenty-three suites
     * call `process.chdir()` to point the file-backed store at a temporary
     * directory, and in a worker thread that method exists but throws
     * `process.chdir() is not supported in workers`. Switching to `threads` for
     * speed would not make these tests slower, it would make them fail.
     */
  },
});
