import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import type { SearchIndex } from '@nextbus/core'
import {
  allGeoCells,
  allPlaceIds,
  type BuildManifest,
  buildObjects,
  datasetKeys,
  fetchConsolidatedIndex,
  placeDocFor,
} from '@nextbus/data-normalize'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDatasetState } from '../src/dataset'
import worker from '../src/index'
import { buildSearchIndex } from '../src/search-index'
import { datasetJson } from './fixtures'

// WP2-7 / ADR-063 acceptance, run inside workerd so `caches.default`, KV and R2 behave as they do
// in production. The three claims under test are the ones a unit test of `buildSearchIndex` could
// not make, because they are properties of the *response*:
//
//   1. `/v1/index` carries a strong ETag equal to the index's own content hash;
//   2. a matching `If-None-Match` gets **304 with no body** — the returning client pays a header
//      exchange instead of the whole blob;
//   3. the 304 does not poison `caches.default`. That interaction is the one that bites: the
//      handler's colo cache (ADR-057's `cached`) keys on the URL, and a conditional request that
//      landed in the key space would split the cache per client validator and, worse, could store
//      a bodiless 304 as the canonical answer for every subsequent rider.

const DATASET_URL = 'https://data.hkbus.app/routeFareList.min.json'
const HASH = 'etagbuild01'
const realFetch = globalThis.fetch

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

async function get(path: string, headers?: HeadersInit): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`https://edge.test${path}`, { headers }), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

/** Seed enough of a build for `/v1/index` to be served from R2 — the search index is all it reads. */
beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === DATASET_URL) return jsonResponse(datasetJson())
    throw new Error(`unexpected fetch during seed: ${url}`)
  }) as typeof fetch

  const index = await fetchConsolidatedIndex()
  const kv = env.DATASET as KVNamespace
  for (const id of allPlaceIds(index)) {
    await kv.put(datasetKeys.place(HASH, id), JSON.stringify(placeDocFor(index, id)))
  }
  for (const [cell, entries] of allGeoCells(index)) {
    await kv.put(datasetKeys.cell(HASH, cell), JSON.stringify(entries))
  }
  await (env.BUILDS as R2Bucket).put(
    buildObjects.searchIndex(HASH),
    JSON.stringify(await buildSearchIndex(index)),
  )

  const manifest: BuildManifest = {
    hash: HASH,
    sourceHash: 'seed',
    builtAt: '2026-07-28T00:00:00.000Z',
    counts: { places: 0, aliases: 0, routes: 0, cells: 0, stops: 0 },
  }
  await kv.put(datasetKeys.current, JSON.stringify(manifest))
  globalThis.fetch = realFetch
})

beforeEach(() => {
  resetDatasetState()
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    throw new Error(`serving /v1/index must not fetch: ${url}`)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('the search index version', () => {
  it('is a content hash, not a pair of collection sizes', async () => {
    const index = (await (await get('/v1/index')).json()) as SearchIndex
    // 16 hex characters — the first half of a SHA-256, the same recipe as the build hash. The old
    // scheme was `${routes.length}.${stops.length}`, which collides whenever one build adds a
    // route and drops another: the client compares two identical strings and keeps a stale index.
    expect(index.version).toMatch(/^[0-9a-f]{16}$/)
  })

  it('carries a precomputed byte-comparable sortKey on every route', async () => {
    const index = (await (await get('/v1/index')).json()) as SearchIndex
    expect(index.routes.length).toBeGreaterThan(0)
    for (const r of index.routes) {
      // The fixture's numbers are a letter then digits (`R01`, `S7`). Expectation written out by
      // hand rather than by calling `routeSortKey`, which would assert nothing: the point is that
      // the *edge* emits the padded form, so a client can sort with `<` and no collator (ADR-063).
      const [letter, ...digits] = r.routeNo
      expect(r.sortKey, r.routeNo).toBe(`${letter}${digits.join('').padStart(4, '0')}`)
    }
  })
})

describe('/v1/index conditional requests', () => {
  it('serves 200 with a strong ETag equal to the version', async () => {
    const res = await get('/v1/index')
    expect(res.status).toBe(200)
    const index = (await res.clone().json()) as SearchIndex
    expect(res.headers.get('etag')).toBe(`"${index.version}"`)
    // Readable cross-origin, so the app on its own domain can see what it is holding.
    expect(res.headers.get('access-control-expose-headers')).toBe('etag')
  })

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const etag = (await get('/v1/index')).headers.get('etag') as string
    const res = await get('/v1/index', { 'if-none-match': etag })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
    // RFC 9110 §15.4.5: the 304 repeats the validators, so the client can keep revalidating.
    expect(res.headers.get('etag')).toBe(etag)
    expect(res.headers.get('cache-control')).toBe('public, max-age=21600')
    // CORS still applies — a 304 the browser cannot read is a 304 that did not happen.
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('serves the whole index to a client holding a stale validator', async () => {
    const res = await get('/v1/index', { 'if-none-match': '"0000000000000000"' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as SearchIndex).routes.length).toBeGreaterThan(0)
  })

  it('does not let a conditional request poison the colo cache', async () => {
    // ADR-057's `cached` stores the answer in `caches.default`. If the client's headers reached
    // the cache key, this request would miss and rebuild; if the 304 were stored, the next
    // unconditional rider would get an empty body. Both are checked by asking again, plainly.
    const etag = (await get('/v1/index')).headers.get('etag') as string
    expect((await get('/v1/index', { 'if-none-match': etag })).status).toBe(304)

    const after = await get('/v1/index')
    expect(after.status).toBe(200)
    expect(after.headers.get('etag')).toBe(etag)
    expect(((await after.json()) as SearchIndex).routes.length).toBeGreaterThan(0)
  })
})

/**
 * ADR-066. This is the test that was missing when the ETag landed, and the defect it now pins was
 * found by hand against a running Worker rather than by the suite: `/v1/index` has a **6 h** TTL and
 * the colo cache key was the URL alone, so flipping `build:current` left every entry in place. The
 * publish was invisible for six hours — and with an ETag in play a revalidating client got a *304
 * confirming the stale copy*, so the index's whole point (a version a client can compare) was
 * defeated by the cache in front of it.
 *
 * Asserting on the **served bytes** rather than on the cache key: a key-shape assertion would pass
 * against any scheme that merely looks different, and the property that matters to a rider is that
 * a published build is the one they get.
 */
describe('a dataset flip invalidates the cached index', () => {
  it('serves the new build immediately after build:current moves', async () => {
    const before = (await (await get('/v1/index')).json()) as SearchIndex
    const beforeEtag = `"${before.version}"`

    // A second build: same shape, one route removed, so the content hash *must* move. (The old
    // `${routes.length}.${stops.length}` version would also have moved here — the bug under test is
    // not the version scheme but the cache in front of it, which is why this seeds a real flip.)
    const NEXT = 'etagbuild02'
    const nextIndex: SearchIndex = { ...before, routes: before.routes.slice(0, -1) }
    nextIndex.version = 'ffffffffffffffff'
    await (env.BUILDS as R2Bucket).put(buildObjects.searchIndex(NEXT), JSON.stringify(nextIndex))
    const manifest: BuildManifest = {
      hash: NEXT,
      sourceHash: 'seed-2',
      builtAt: '2026-07-29T00:00:00.000Z',
      counts: { places: 0, aliases: 0, routes: 0, cells: 0, stops: 0 },
    }
    await (env.DATASET as KVNamespace).put(datasetKeys.current, JSON.stringify(manifest))
    // The manifest is memoized per isolate for its own TTL; a real flip is seen when that lapses.
    // Dropping the isolate state is how this test reaches the next request, not part of the fix.
    resetDatasetState()

    const after = await get('/v1/index')
    const served = (await after.clone().json()) as SearchIndex
    expect(served.version, 'the flip must reach the rider, not sit behind a 6 h colo entry').toBe(
      'ffffffffffffffff',
    )
    expect(after.headers.get('etag')).toBe('"ffffffffffffffff"')
    expect(served.routes.length).toBe(before.routes.length - 1)

    // …and the client that was holding the previous build is told so, rather than being handed a
    // 304 that confirms an index which no longer exists.
    const revalidated = await get('/v1/index', { 'if-none-match': beforeEtag })
    expect(revalidated.status).toBe(200)
    expect(((await revalidated.json()) as SearchIndex).version).toBe('ffffffffffffffff')
  })

  /**
   * The fallback path has no build hash, so there is no honest key for it — and the first cut of
   * ADR-066 gave it a constant one (`__build=inline`), which rebuilt the very defect it was fixing:
   * a 6 h entry, keyed on nothing that moves, that no publish could displace. Caught in review.
   *
   * `readManifest` maps *any* KV failure to `null` and deliberately never memoizes it, so this is
   * not a hypothetical state: one unreadable `build:current` reaches it.
   */
  it('does not cache the inline fallback, whose body no key can address', async () => {
    const kv = env.DATASET as KVNamespace
    const manifest = await kv.get(datasetKeys.current)
    await kv.delete(datasetKeys.current)

    /** Serve the upstream dataset, optionally with one route withdrawn, so its content moves. */
    const serveUpstream = (withdrawOne: boolean) => {
      const body = datasetJson() as { routeList: Record<string, unknown> }
      if (withdrawOne) delete body.routeList[Object.keys(body.routeList)[0] as string]
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (u === DATASET_URL) return jsonResponse(body)
        throw new Error(`unexpected fetch: ${u}`)
      }) as typeof fetch
    }

    try {
      serveUpstream(false)
      resetDatasetState()
      const first = (await (await get('/v1/index')).json()) as SearchIndex

      // Upstream genuinely changes while `build:current` is still unreadable. A constant
      // `__build=inline` key would serve `first` for six hours; there is no publish that can
      // displace it, because the key does not mention anything a publish moves.
      serveUpstream(true)
      resetDatasetState()
      const second = (await (await get('/v1/index')).json()) as SearchIndex

      expect(
        second.version,
        'an inline response must not be served from a stale colo entry',
      ).not.toBe(first.version)
      expect(second.routes.length).toBeLessThan(first.routes.length)
    } finally {
      globalThis.fetch = realFetch
      await kv.put(datasetKeys.current, manifest as string)
      resetDatasetState()
    }
  })
})
