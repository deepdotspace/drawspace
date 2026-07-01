import { defineConfig } from 'vitest/config'

/**
 * Dedicated Vitest config — intentionally does NOT reuse vite.config.ts.
 *
 * The app's vite config loads the Cloudflare Workers plugin (plus generouted
 * and the React checker). Pointed at a test run, that drags worker-only deps
 * into a browser-style dependency pre-bundle, which under Vite 8 (rolldown)
 * crashes with "Missing field `tsconfigPaths`" before a single test executes.
 *
 * These unit tests cover pure functions only, so they run in a plain Node
 * environment with no app plugins and no dep optimization. Keep it that way:
 * if you ever need to test worker-runtime code (Durable Objects, bindings),
 * use the Playwright e2e suite (`deepspace test`) instead of pulling the
 * Cloudflare plugin in here.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
})
