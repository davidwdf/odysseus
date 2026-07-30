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
})
