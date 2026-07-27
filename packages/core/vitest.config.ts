import { defineConfig } from 'vitest/config'

// `packages/core` had no test runner at all before WP1-5, which is the state the plan's risk table
// calls out: every "mechanical, zero-behaviour-change" claim about this package was unverified. Wave
// 2 moves logic *into* here under a copy-then-parity-then-delete method, so the corpora and this
// runner have to exist first or the parity step has nothing to compare against.
//
// Plain node — no workerd pool like `apps/edge`, no jsdom. Everything under test is a pure function
// over plain data, and keeping it that way is the property that makes the package hand-portable to
// Swift and Kotlin at all. If a test here ever needs an environment, that is a signal the code has
// stopped being kernel logic, not a signal to configure one.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // Only the four modules that carry behaviour. `types.ts` and `datasource.ts` are declarations
      // that emit nothing (the ADR-052 gate proves it for `types.ts`), and `index.ts` is re-exports;
      // including them would dilute the ratio with unreachable-by-construction lines and let real
      // coverage rot while the number stayed green.
      include: ['src/eta.ts', 'src/geo.ts', 'src/route-position.ts', 'src/search.ts'],
      // A **branch** threshold is the load-bearing one. Line coverage is easy to satisfy with a
      // handful of happy-path cases; the bugs in rules like these live in the branch nobody thought
      // about — the blank `en`, the departed predecessor, the missing fare. 100 is set because the
      // corpus reaches it (151/151 branches), so there is no unexplained slack: add a rule without
      // corpus rows and the build fails rather than the average quietly sliding.
      //
      // Two branches needed a test rather than a corpus row, and both are in `formatBearing`: an
      // unknown `Locale` (real per ADR-052's `x-unknown-tolerant`, since `core` does no runtime
      // validation) and a NaN bearing (JSON has no NaN). They are asserted in `test/geo.test.ts` with
      // the reasoning, which is the honest alternative to lowering the number to hide them.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
})
