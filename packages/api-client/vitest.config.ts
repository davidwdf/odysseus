import { defineConfig } from 'vitest/config'

// `packages/api-client` had **no test script at all** until WP5-1 — recorded in the Wave 5 seam
// inventory as a load-bearing gap, because the two things it holds are the `DataSource` implementation
// every screen goes through and the shared location state machine, and neither had ever been executed by
// anything. A package with no `test` script is skipped silently by `turbo run test`, so this was not a
// suite that was failing; it was a suite that did not exist.
//
// Plain node, no environment. Everything here is logic over plain data with its platform edges injected
// — `fetchImpl`, a `Clock`, a `Timers`, a `LiveSocketFactory` — which is exactly why a socket transport
// can be tested without jsdom and without a server. If a test in this package ever needs an environment,
// that is a signal that a platform object has leaked out of a seam.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
