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
      },
    }),
  ],
})
