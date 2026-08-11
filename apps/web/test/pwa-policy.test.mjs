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
// The second describe block below covers `scripts/pwa/redirects.mjs`, the **host** half of one of those
// decisions: `navigateFallback` only applies once a worker is installed, so the first visit to a shared
// deep link is the origin's to answer. It lives here rather than in a file of its own because it is the
// same declaration shared for the same reason, and because the one thing worth asserting about both at
// once — that the two halves name the same file, and that both apps emit both — is one assertion.
//
// `.mjs`, not `.ts`: the thing under test is a `.mjs` build input with no type declaration, and the
// honest options were a hand-written `.d.mts` to maintain beside it or a test in the same language as its
// subject. `apps/web/vitest.config.ts` includes `.mjs` for this file; `tsconfig.json` does not, so nothing
// here is typechecked and nothing here needs to be.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { getManifest } from 'workbox-build'
import {
  REDIRECTS,
  REDIRECTS_FILE,
  SPA_FALLBACK_RULE,
  writeRedirects,
} from '../../../scripts/pwa/redirects.mjs'
import { NAVIGATE_FALLBACK, workboxConfig } from '../../../scripts/pwa/workbox.config.mjs'

const API = 'https://api.example.test'
const config = workboxConfig({ distDir: '/tmp/dist', apiOrigin: API })

/**
 * The repo root, reached through `path` rather than `new URL(…, import.meta.url)`.
 *
 * **The URL form silently does not work under vitest**, and it fails by resolving rather than by throwing:
 * vite rewrites `new URL(x, import.meta.url)` into its asset-URL lookup, and a *templated* `x` becomes a
 * glob that matches nothing, so the expression evaluates to the string `"undefined"` — every path below
 * would have resolved to `test/undefined` and every assertion would have been an ENOENT rather than a
 * comparison. Watched: the first version of the last test in this file failed that way.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const repoFile = (path) => join(REPO_ROOT, path)
const readJson = (path) => JSON.parse(readFileSync(repoFile(path), 'utf8'))

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

// ── the host half of the same decision ─────────────────────────────────────────────────────────────
//
// `navigateFallback` above only applies once a worker is installed, so the FIRST visit to a shared deep
// link — the visit a shareable URL exists for — is the host's to answer, and `scripts/pwa/redirects.mjs`
// is that answer. It is shared for the reason ADR-082 shared the caching policy: it started life as
// `apps/web/public/_redirects`, which meant `apps/mobile` — the PWA that actually ships today (WP0-5) —
// 404'd on the same link. Two PWAs must not be able to disagree about what a rider sees.

describe('the shared SPA deep-link fallback', () => {
  it('rewrites every unknown path to the worker’s own fallback, with no redirect', () => {
    // Three claims in one line, each with its own failure. Without `/*` the rider's shared path is not
    // covered at all; without the worker's own constant the two halves can come to point at different
    // files, and only a first visit would notice; without `200` the address bar loses the path — which is
    // the failure that looks like the app working.
    const [pattern, target, status] = SPA_FALLBACK_RULE.trim().split(/\s+/)
    expect(pattern).toBe('/*')
    expect(target).toBe(NAVIGATE_FALLBACK)
    expect(status).toBe('200')
    expect(SPA_FALLBACK_RULE).not.toMatch(/\b30[128]\b/)
  })

  it('is the only rule in the file, and keeps its reasoning with it', () => {
    // Everything else in the emitted file is a `#` comment. A second rule would need to be read against
    // ordering (the host takes the first match), so its absence is worth asserting rather than assuming.
    const rules = REDIRECTS.split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
    expect(rules).toEqual([SPA_FALLBACK_RULE])
    // The 200-not-302 reasoning ships in the artefact, because that is what someone debugging a live 404
    // opens first.
    expect(REDIRECTS).toContain('rewrite')
  })

  describe('written into a finished build', () => {
    let dist = null
    afterEach(() => {
      if (dist !== null) rmSync(dist, { recursive: true, force: true })
      dist = null
    })

    it('lands at the root of dist, where the host looks for it', () => {
      dist = mkdtempSync(join(tmpdir(), 'nextbus-redirects-'))
      writeFileSync(join(dist, 'index.html'), '<!doctype html>')
      const written = writeRedirects(dist)
      expect(written).toBe(join(dist, REDIRECTS_FILE))
      expect(readFileSync(written, 'utf8')).toContain(SPA_FALLBACK_RULE)
    })

    it('refuses a build with no index.html, rather than pointing the rewrite at nothing', () => {
      // The silent failure this guards: an emit that ran before the exporter, or against the wrong
      // directory, would write a rule rewriting every unknown path to a file that is not there — a 404
      // with extra steps, on a host nobody has deployed yet.
      dist = mkdtempSync(join(tmpdir(), 'nextbus-redirects-'))
      expect(() => writeRedirects(dist)).toThrow(/no index\.html/)
    })

    it('is not swept into the precache manifest', async () => {
      // Asserted with a real `getManifest` over a real directory rather than by reading the glob string,
      // because the claim is about what Workbox matches, not about what the pattern looks like. The harm
      // is small and cumulative rather than dramatic — a host config in every rider's precache, revisioned
      // on every deploy — but it is the kind of thing a `**/*` added in five years' time does silently, and
      // the emitted `_redirects` says it does not happen.
      dist = mkdtempSync(join(tmpdir(), 'nextbus-redirects-'))
      writeFileSync(join(dist, 'index.html'), '<!doctype html>')
      writeRedirects(dist)
      const { manifestEntries } = await getManifest({
        globDirectory: dist,
        globPatterns: workboxConfig({ distDir: dist, apiOrigin: API }).globPatterns,
      })
      const urls = manifestEntries.map((e) => e.url)
      expect(urls).toContain('index.html')
      expect(urls).not.toContain(REDIRECTS_FILE)
    })
  })

  it('is emitted by BOTH apps’ build:web, and hand-copied into neither', () => {
    // The finding itself, as an assertion. `apps/mobile` is the PWA that ships today and `apps/web` is the
    // one that replaces it (ADR-075); a fallback only one of them emits is the ADR-082 split reintroduced
    // one layer down, and it is invisible until a rider opens a shared link on a host.
    for (const app of ['web', 'mobile']) {
      const { scripts } = readJson(`apps/${app}/package.json`)
      expect(scripts['build:web'], `apps/${app} does not emit the SPA fallback`).toContain(
        'scripts/pwa/redirects.mjs',
      )
      // And no second declaration: a copy under `public/` is served verbatim by both builders, so it would
      // silently win back the drift this replaced.
      expect(
        existsSync(repoFile(`apps/${app}/public/${REDIRECTS_FILE}`)),
        `apps/${app}/public/${REDIRECTS_FILE} is a second declaration of a shared rule`,
      ).toBe(false)
    }
  })
})
