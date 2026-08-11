/**
 * Workbox `generateSW` config for the PWA service worker (WP0-3, ADR-058) — **one declaration, two
 * consumers.**
 *
 * It lived in `apps/mobile/` until WP6-0, when `apps/web` grew a service worker of its own and the
 * repo briefly had two PWAs at once. The caching *policy* below is a set of decisions about what a
 * rider is shown when the network is gone — live ETAs must never be served cache-first (ADR-008),
 * tiles must never be fetched speculatively (LandsD's terms), the shell must precache or nothing else
 * here is reachable — and two copies of that policy would have been two copies of ADR-058. What is
 * genuinely per-app is the output directory and the API origin, so those are parameters. Moving it
 * here rather than importing across app boundaries also means the file survives WP6-8, when
 * `apps/mobile` retires and the second consumer becomes the only one.
 *
 * **Neither caller is a turbo task, so ADR-070 does not bite — and it would if either became one.**
 * Both are package scripts run directly (`pnpm --filter @nextbus/{mobile,web} build:web`), so nothing
 * caches a build against a hash that excludes this file. A `build:web` promoted into `turbo.json`
 * must declare this path in `inputs`.
 *
 * Its claims are checked in two places, because they fail in two ways: `test/pwa-policy.test.mjs` in
 * `apps/web` asserts the policy *shape* on every `pnpm test`, and `assertServiceWorker` below asserts
 * the emitted bytes at build time.
 *
 * `redirects.mjs` beside it is the **host** half of one of the decisions below — `navigateFallback`, which
 * only applies once a worker is installed, so the first visit to a shared deep link needs the same answer
 * from the origin. It is shared for the same reason and shares the constant.
 *
 * `generateSW` (rather than `injectManifest`) because with `inlineWorkboxRuntime` the whole runtime is
 * written into `sw.js` — no `importScripts` from a CDN, which would otherwise make the *offline*
 * service worker depend on the network on first run.
 *
 * Three caching strategies, one per kind of thing:
 *
 *  1. **App shell → precache.** Both builds are content-hashed (Expo's static export; Vite's
 *     `assets/*-<hash>.js`), so cache-first with no revalidation is both safe and the fastest possible
 *     cold start. This is what makes the app *open* offline; without it every other cache below is
 *     unreachable.
 *  2. **`/v1/index` → stale-while-revalidate.** The search index is large and changes about daily.
 *     Serve the cached copy immediately, refresh in the background: search and the keypad work
 *     instantly and offline, and quietly catch up. (`apps/mobile/lib/searchIndex.ts` also keeps its
 *     own AsyncStorage copy, so search survives a cache eviction; this layer additionally makes the
 *     *first* paint after a reload instant.)
 *  3. **Live ETA endpoints → network-first with a short timeout.** Never cache-first: a bus that left
 *     four minutes ago is worse than no answer (ADR-008). The cached copy is the offline fallback, and
 *     it carries its original `observedAt`, so the ETA helpers age it and the UI labels it stale
 *     rather than presenting it as live.
 *
 * Tiles are deliberately **not** precached — pre-emptively fetching tiles a rider isn't looking at is
 * precisely what both LandsD's "not a large amount of requests in a short period" and the OSMF policy
 * prohibit. They get a plain runtime cache, so a tile already seen redraws offline and nothing is
 * fetched speculatively.
 */

import { readFileSync } from 'node:fs'

/**
 * Everything worth precaching from `dist/`. Source maps and the SW itself are excluded.
 *
 * Exported because one thing that must **not** match matters as much as the things that must:
 * `redirects.mjs` writes an extensionless `_redirects` into the same directory, and every pattern here is
 * extension-qualified so it cannot be swept into the precache manifest. `pwa-policy.test.mjs` asserts that
 * against a real `getManifest` run rather than by reading the string.
 */
export const PRECACHE_GLOBS = ['**/*.{html,js,css,json,png,svg,ico,webmanifest,woff,woff2,ttf}']

/**
 * The app shell — and the target of **two** rules, which is why it is a constant rather than a literal.
 *
 * The worker rewrites an unknown navigation to it once installed; the host rewrites one to it on the very
 * first visit, before any worker exists (`redirects.mjs`). Those are the two halves of one decision, and a
 * pair that disagreed would fail only on a first visit to a deep link — the one case nobody tests locally.
 */
export const NAVIGATE_FALLBACK = '/index.html'

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
   * `assertServiceWorker` below is what stops that leak coming back.
   *
   * Anchored at `^` because Workbox ignores an unanchored cross-origin pattern.
   */
  const api = (alternation) => new RegExp(`^${escapeRe(apiOrigin)}/v1/(?:${alternation})\\b`)

  return {
    swDest: `${distDir}/sw.js`,
    globDirectory: distDir,
    globPatterns: PRECACHE_GLOBS,
    // Expo's export contains large hashed JS bundles; the default 2 MiB cap would silently
    // drop the main one, which is the difference between "opens offline" and "doesn't". Vite's
    // output is smaller today; the cap stays shared rather than tuned per app because the failure it
    // prevents is silent in both.
    maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
    inlineWorkboxRuntime: true,
    sourcemap: false,
    cleanupOutdatedCaches: true,
    // Take over immediately. This app has no long-lived unsaved state, so waiting for every
    // tab to close before a new build applies would just serve stale code.
    skipWaiting: true,
    clientsClaim: true,
    // Expo writes one HTML file per route and Vite writes exactly one, but the requirement is the
    // same either way: an unknown deep link offline must open the app rather than the browser's
    // error page, and the client-side router resolves the path (expo-router there, react-router
    // here). For the single-page Vite build this is also the only thing that makes a cold offline
    // load of `/settings` open anything at all.
    // This covers every visit **after** the worker is installed. `redirects.mjs` is the same decision
    // for the first one, where only the host can answer — same constant, so they cannot drift.
    navigateFallback: NAVIGATE_FALLBACK,
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

/**
 * Assert on the **emitted** `sw.js`, not on `generateSW`'s return value.
 *
 * A worker that registers but precaches the wrong thing fails silently — the app just never works
 * offline — so every claim the config above makes is checked against the bytes that ship. The file is
 * minified, so these match the version banner and the baked-in origin, never identifier names.
 *
 * Shared with the config for the same reason as the config: two builds making the same claim must not
 * be able to check it two different ways.
 *
 * @param {string} swPath path to the emitted `sw.js`
 * @param {{ apiUrl: string }} opts the API URL the bundle was built against
 */
export function assertServiceWorker(swPath, { apiUrl }) {
  const sw = readFileSync(swPath, 'utf8')
  // The host, not the whole origin: a serialised RegExp escapes its slashes (`http:\/\/…`).
  const apiHost = new URL(apiUrl).host
  for (const [what, ok] of [
    ['inlined Workbox runtime', sw.includes('workbox:precaching')],
    ['no CDN importScripts', !sw.includes('storage.googleapis.com')],
    ['app shell precached', sw.includes('index.html')],
    // `generateSW` serialises `urlPattern` with `.toString()`, so a matcher that closes over a
    // build-time variable compiles to source referencing an undefined identifier: the route
    // silently never fires and nothing is cached at runtime. Both halves of that are checked —
    // the API origin must be baked in, and `apiOrigin` must not survive as a bare identifier.
    ['API origin baked into the routes', sw.includes(apiHost)],
    ['no unresolved build-time identifiers', !/\bapiOrigin\b/.test(sw)],
  ]) {
    if (!ok) throw new Error(`${swPath} failed its sanity check: ${what}`)
  }
}
