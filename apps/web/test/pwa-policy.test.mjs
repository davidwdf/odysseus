// The shared PWA caching policy (ADR-058), asserted against its **declaration** rather than against a
// minified `sw.js`.
//
// WHY THIS FILE EXISTS AND WHY IT IS HERE
// `scripts/pwa/workbox.config.mjs` became shared in WP6-0, when `apps/web` grew a service worker and the
// repo briefly had two PWAs. Sharing removed the drift between two copies and introduced a different
// risk in its place: **one edit now changes what both apps do offline**, and the things that would break
// are exactly the things that fail silently. A `CacheFirst` on the ETA routes would serve a bus that left
// four minutes ago (ADR-008); a missing `navigateFallback` would make a cold offline load of `/settings`
// the browser's error page while `/` worked; a predicate `urlPattern` would compile to a route that never
// matches and caches nothing, with no error anywhere.
//
// `apps/mobile/scripts/build-web.mjs` asserts the same claims against the emitted bundle, but only when
// somebody runs a build. This runs on `pnpm test`.
//
// `.mjs`, not `.ts`: the thing under test is a `.mjs` build input with no type declaration, and the
// honest options were a hand-written `.d.mts` to maintain beside it or a test in the same language as its
// subject. `apps/web/vitest.config.ts` includes `.mjs` for this file; `tsconfig.json` does not, so nothing
// here is typechecked and nothing here needs to be.

import { describe, expect, it } from 'vitest'
import { workboxConfig } from '../../../scripts/pwa/workbox.config.mjs'

const API = 'https://api.example.test'
const config = workboxConfig({ distDir: '/tmp/dist', apiOrigin: API })

/** The route whose `urlPattern` matches `url`, or undefined. */
const routeFor = (url) => config.runtimeCaching.find((r) => r.urlPattern.test(url))

describe('the shared Workbox policy', () => {
  it('precaches the app shell and can fall back to it for an unknown deep path', () => {
    // The two halves of "opens offline". Without the precache there is nothing to open; without the
    // fallback, only `/` opens — the most confusing possible half-pass, and the one the single-page Vite
    // build is exposed to that Expo's per-route HTML export is not.
    expect(config.globPatterns.join()).toContain('html')
    expect(config.navigateFallback).toBe('/index.html')
    // …but never for the API itself: a `/v1/*` request answered with the app shell is a JSON parse error
    // in the client rather than a network failure it knows how to report.
    expect(config.navigateFallbackDenylist.some((re) => re.test('/v1/nearby'))).toBe(true)
  })

  it('serves live ETAs network-first, never cache-first (ADR-008)', () => {
    for (const path of ['/v1/nearby', '/v1/etas', '/v1/stop/KMB:AA', '/v1/route/KMB:1']) {
      const route = routeFor(`${API}${path}`)
      expect(route?.handler, path).toBe('NetworkFirst')
      // A timeout is what makes the cached copy reachable at all on a flaky connection rather than only
      // on a dead one.
      expect(route?.options.networkTimeoutSeconds, path).toBeGreaterThan(0)
    }
  })

  it('serves the search index stale-while-revalidate, so search works instantly and offline', () => {
    expect(routeFor(`${API}/v1/index`)?.handler).toBe('StaleWhileRevalidate')
  })

  it('caches tiles only once seen, and never precaches them', () => {
    // LandsD's terms and the OSMF policy both prohibit fetching tiles a rider is not looking at, so tiles
    // get a runtime cache and no precache entry. `CacheFirst` is right *here* precisely because a tile is
    // immutable for its zoom and coordinates, which an ETA is not.
    expect(routeFor(`${API}/v1/tiles/basemap/16/1/1.png`)?.handler).toBe('CacheFirst')
    expect(config.globPatterns.join()).not.toContain('tiles')
  })

  it('bakes the API origin into every route as a RegExp, not a closure', () => {
    // `generateSW` serialises `urlPattern` by calling `.toString()` on it. A predicate closing over
    // `apiOrigin` therefore compiles into the worker as source referencing an identifier that does not
    // exist there: the route silently never fires. Both halves are asserted — every pattern is a RegExp,
    // and every one carries the origin.
    for (const route of config.runtimeCaching) {
      expect(route.urlPattern).toBeInstanceOf(RegExp)
      expect(route.urlPattern.source).toContain('api\\.example\\.test')
    }
    // And a *different* origin must not match, or the "bakes in the origin" claim is untested.
    expect(routeFor('https://elsewhere.test/v1/nearby')).toBeUndefined()
  })

  it('takes over immediately and cleans up after itself', () => {
    // A new build that waited for every tab to close would serve stale code; this app has no unsaved state
    // to protect. `cleanupOutdatedCaches` is what stops each deploy leaving its precache behind for ever.
    expect(config.skipWaiting).toBe(true)
    expect(config.clientsClaim).toBe(true)
    expect(config.cleanupOutdatedCaches).toBe(true)
  })

  it('inlines the Workbox runtime, so the offline worker needs no CDN on first run', () => {
    expect(config.inlineWorkboxRuntime).toBe(true)
  })

  it('raises the file-size cap above the largest bundle either app ships', () => {
    // The default 2 MiB silently drops Expo's main bundle, which is the difference between "opens offline"
    // and "doesn't" — and silence is the whole problem: the build succeeds either way.
    expect(config.maximumFileSizeToCacheInBytes).toBeGreaterThan(2 * 1024 * 1024)
  })
})
