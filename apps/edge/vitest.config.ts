import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Worker tests run inside workerd (not node), so `caches.default`, KV, R2, the subrequest model
// and the isolate lifetime behave exactly as they do in production. That matters twice over
// here: for the WP0-4 coalescer, whose contract is "one upstream call per pole per isolate per
// TTL", and for WP0-1, whose whole claim is "the Worker reads shards instead of building the
// dataset" — a claim only a real KV binding can test.
//
// `@cloudflare/vitest-pool-workers` ≥0.18 (the Vitest 4 line) exposes the pool as a Vite
// plugin; the older `defineWorkersConfig` / `poolOptions.workers` form is gone.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // Simulated locally by Miniflare — no Cloudflare account, no network. These are the
        // same binding names `wrangler.toml` declares for production.
        kvNamespaces: ['DATASET'],
        r2Buckets: ['BUILDS'],
        // **`durableObjects` is deliberately absent, and that is not an omission.** The pool calls
        // wrangler's own config loader, so `[[durable_objects.bindings]]` and `[[migrations]]` are read
        // straight from `wrangler.toml` and merged in — including the `new_sqlite_classes` → `useSQLite`
        // mapping that decides whether `ctx.storage.sql` exists. Restating the binding here would be a
        // second declaration that could disagree with the one that ships (the same redundancy the two
        // lines above already are). What the pool *does* require is `main`, which `wrangler.toml`
        // supplies, and that the DO class be a named export of it — see `src/index.ts`.
      },
    }),
  ],
  /**
   * **Timeouts for this project only, because vitest's defaults were written for node unit tests.**
   *
   * These suites run inside **workerd**, against Miniflare's disk-backed KV and R2 and real socket
   * upgrades. That is the whole point of the pool — and it is several times slower than the in-process
   * arithmetic the 5 s / 10 s defaults assume.
   *
   * Two CI failures came from exactly that gap, both *timeouts* rather than assertions, on a commit range
   * that touched nothing under `apps/edge/`:
   *  · `dataset-kv.test.ts` — "Test timed out in **5000ms**", the test default;
   *  · `live-rounds.test.ts` — "Hook timed out in **10000ms**", the hook default. Twice.
   *
   * **Measured locally** (2026-08-10) so the numbers below are sized rather than picked: `live-rounds`'
   * `beforeAll`, which seeds a whole dataset build into simulated KV, costs **~1 s**; each `beforeEach`
   * costs **≤22 ms**; the slowest single test in the package is **643 ms**; the whole file is 8 s. So a
   * hook exceeding 10 s on CI is a **>10× cold-runner blowup**, not a slow hook — a fresh runner with zero
   * turbo cache, a ~38 s cold import and contended disk.
   *
   * Hence 60 s and 20 s: roughly 60× and 30× the measured local cost, comfortably past the worst observed
   * CI behaviour, and **still finite** — a genuinely hung Durable Object or an unclosed socket fails the
   * job instead of hanging it, which is the only thing a timeout is really for.
   *
   * **Deliberately not a global bump.** Every other package's suites are node-speed, and there the 5 s
   * default is doing real work: a unit test that suddenly needs five seconds has broken rather than slowed.
   */
  test: {
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
