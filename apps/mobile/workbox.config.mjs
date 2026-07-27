/**
 * Workbox `generateSW` config for the PWA service worker (WP0-3).
 *
 * `generateSW` (rather than `injectManifest`) because with `inlineWorkboxRuntime` the whole
 * runtime is written into `sw.js` — no `importScripts` from a CDN, which would otherwise make
 * the *offline* service worker depend on the network on first run.
 *
 * Three caching strategies, one per kind of thing:
 *
 *  1. **App shell → precache.** Expo's static export is content-hashed, so cache-first with no
 *     revalidation is both safe and the fastest possible cold start. This is what makes the app
 *     *open* offline; without it every other cache below is unreachable.
 *  2. **`/v1/index` → stale-while-revalidate.** The search index is large and changes about
 *     daily. Serve the cached copy immediately, refresh in the background: search and the
 *     keypad work instantly and offline, and quietly catch up. (`lib/searchIndex.ts` also keeps
 *     its own AsyncStorage copy, so search survives a cache eviction; this layer additionally
 *     makes the *first* paint after a reload instant.)
 *  3. **Live ETA endpoints → network-first with a short timeout.** Never cache-first: a bus
 *     that left four minutes ago is worse than no answer (ADR-008). The cached copy is the
 *     offline fallback, and it carries its original `observedAt`, so the ETA helpers age it and
 *     the UI labels it stale rather than presenting it as live.
 *
 * Tiles are deliberately **not** precached — pre-emptively fetching tiles a rider isn't looking
 * at is precisely what both LandsD's "not a large amount of requests in a short period" and the
 * OSMF policy prohibit. They get a plain runtime cache, so a tile already seen redraws offline
 * and nothing is fetched speculatively.
 */

/** Everything worth precaching from `dist/`. Source maps and the SW itself are excluded. */
const PRECACHE_GLOBS = ['**/*.{html,js,css,json,png,svg,ico,webmanifest,woff,woff2,ttf}']

const cacheable = { statuses: [0, 200] }

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** @param {{ distDir: string, apiOrigin: string }} opts */
export function workboxConfig({ distDir, apiOrigin }) {
  /**
   * Match `/v1/<alternation>` on the edge Worker's origin, wherever it's deployed.
   *
   * These MUST be RegExps, not predicate functions. `generateSW` serialises `urlPattern` by
   * calling `.toString()` on it, so a closure over `apiOrigin` is emitted as source that
   * references a variable which doesn't exist inside the worker — the route silently never
   * matches and nothing is ever cached. A RegExp round-trips with the origin baked in.
   * `build-web.mjs` asserts the leak can't come back.
   *
   * Anchored at `^` because Workbox ignores an unanchored cross-origin pattern.
   */
  const api = (alternation) => new RegExp(`^${escapeRe(apiOrigin)}/v1/(?:${alternation})\\b`)

  return {
    swDest: `${distDir}/sw.js`,
    globDirectory: distDir,
    globPatterns: PRECACHE_GLOBS,
    // Expo's export contains large hashed JS bundles; the default 2 MiB cap would silently
    // drop the main one, which is the difference between "opens offline" and "doesn't".
    maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
    inlineWorkboxRuntime: true,
    sourcemap: false,
    cleanupOutdatedCaches: true,
    // Take over immediately. This app has no long-lived unsaved state, so waiting for every
    // tab to close before a new build applies would just serve stale code.
    skipWaiting: true,
    clientsClaim: true,
    // Expo writes one HTML file per route, but an unknown deep link offline should still open
    // the app rather than the browser's error page; expo-router resolves the path client-side.
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/v1\//],

    runtimeCaching: [
      {
        urlPattern: api('index'),
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'nextbus-search-index',
          cacheableResponse: cacheable,
          expiration: { maxEntries: 2, maxAgeSeconds: 7 * 24 * 60 * 60 },
        },
      },
      {
        urlPattern: api('nearby|etas|stop|route'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'nextbus-live',
          networkTimeoutSeconds: 4,
          cacheableResponse: cacheable,
          expiration: { maxEntries: 60, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
      {
        urlPattern: api('tiles'),
        handler: 'CacheFirst',
        options: {
          cacheName: 'nextbus-tiles',
          cacheableResponse: cacheable,
          expiration: {
            maxEntries: 300,
            maxAgeSeconds: 12 * 60 * 60,
            purgeOnQuotaError: true,
          },
        },
      },
    ],
  }
}
