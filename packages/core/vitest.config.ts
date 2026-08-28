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
      // Only the modules that carry behaviour. `types.ts` and `datasource.ts` are declarations
      // that emit nothing (the ADR-052 gate proves it for `types.ts`), and `index.ts` is re-exports;
      // including them would dilute the ratio with unreachable-by-construction lines and let real
      // coverage rot while the number stayed green.
      // **This list was hand-spelled and had already gone stale**, which is this repo's named recurring
      // failure wearing its dullest costume: `src/favourites.ts` landed in Wave 6 carrying the rule a
      // rider's curated list survives on, and it was never added — so the module holding
      // `migrateFavouriteKeys` sat outside the 100 % branch threshold while the threshold went on
      // reporting green. WP6-7 found it by reading this file before adding to it, and closed it in the
      // same commit that added `src/settings.ts`.
      //
      // Left as an explicit list rather than `src/*.ts` plus exclusions, deliberately: a glob would make
      // the three declaration-only modules below into unexplained exclusions, and the reason each is out
      // is the part worth keeping. The cost is that this list must be edited when a module is added.
      //
      // **The mitigation used to be stated here as "a module with no rows fails the threshold loudly
      // rather than silently", and that was simply wrong** — a module missing from this list is not
      // measured at all, so it fails nothing and is invisible, which is worse than red. Saying so did
      // not stop it recurring: `src/route-path.ts` was added in M4 of proposals/06, extended twice, and
      // never listed, while ADR-155 claimed 100 % coverage for a module actually sitting at 95 %
      // statements and 87 % branches with a dead branch in it.
      //
      // The real mitigation is a gate. `check-spec-coverage.mjs` now fails when a module carrying an
      // `@spec` tag is absent from this list, because a rule worth pinning to a corpus is a rule worth
      // measuring. Declaration-only modules carry no tags and are correctly ignored by it.
      include: [
        'src/eta.ts',
        'src/fare-stages.ts',
        'src/favourites.ts',
        'src/geo.ts',
        'src/geo-snap.ts',
        'src/ids.ts',
        'src/live.ts',
        'src/location-mark.ts',
        'src/mercator.ts',
        'src/policy.ts',
        'src/route-detail.ts',
        'src/route-markers.ts',
        'src/route-path.ts',
        'src/route-position.ts',
        'src/search.ts',
        'src/settings.ts',
        'src/stop-card.ts',
        'src/stop-detail.ts',
        'src/stop-name.ts',
      ],
      // A **branch** threshold is the load-bearing one. Line coverage is easy to satisfy with a
      // handful of happy-path cases; the bugs in rules like these live in the branch nobody thought
      // about — the blank `en`, the departed predecessor, the missing fare. 100 is set because the
      // corpus reaches it (271/271 branches after Wave 2's extraction, from 151 when the threshold
      // was set), so there is no unexplained slack: add a rule without corpus rows and the build
      // fails rather than the average quietly sliding.
      //
      // Two branches needed a test rather than a corpus row, and both are in `formatBearing`: an
      // unknown `Locale` (real per ADR-052's `x-unknown-tolerant`, since `core` does no runtime
      // validation) and a NaN bearing (JSON has no NaN). They are asserted in `test/geo.test.ts` with
      // the reasoning, which is the honest alternative to lowering the number to hide them.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
})
