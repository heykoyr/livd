/**
 * Stub for the `server-only` package.
 *
 * That package throws on import so a bundler can catch server code reaching a
 * client bundle. It is a build-time guard, not a runtime one, and under Vitest
 * there is no such boundary to protect — importing it would only make every
 * test that touches a server module fail for a reason unrelated to the test.
 *
 * Aliased in vitest.config.ts.
 */
export {};
