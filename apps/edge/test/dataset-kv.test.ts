import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import type { NearbyStop, RouteDetail, SearchIndex, StopDetail } from '@nextbus/core'
import {
  allAliases,
  allGeoCells,
  allPlaceIds,
  allRouteIds,
  type BuildManifest,
  buildObjects,
  datasetKeys,
  fetchConsolidatedIndex,
  placeDocFor,
  routeDocFor,
} from '@nextbus/data-normalize'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDatasetState } from '../src/dataset'
import { resetEtaCache } from '../src/eta-cache'
import worker from '../src/index'
import { buildSearchIndex } from '../src/search-index'
import { datasetJson, kmbStopEtaJson, ORIGIN, poles, SERVED_POLES } from './fixtures'

// WP0-1 acceptance. The Worker is given a **seeded KV/R2 build** and then swept across every
// endpoint; `datasetBuildsThisIsolate` must stay at 0 throughout. That number is the whole
// point of the work package: it is 0 exactly when the 8.3 MB dataset never touched the request
// path, and nothing but this assertion stops the slow path quietly coming back.
//
// The seed is produced by the same `all*` derivations the publish script uses, so this test
// covers the real shard shapes rather than hand-written stand-ins.

const DATASET_URL = 'https://data.hkbus.app/routeFareList.min.json'
const KMB_STOP_ETA = /^https:\/\/data\.etabus\.gov\.hk\/v1\/transport\/kmb\/stop-eta\/(.+)$/

const HASH = 'testbuild01'
const realFetch = globalThis.fetch
let upstreamDatasetFetches = 0
/** The init the last dataset fetch carried — the deadline assertion below reads it. */
let upstreamDatasetInit: RequestInit | undefined

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

async function get(path: string): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`https://edge.test${path}`), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

/** Publish a complete build into the test KV/R2, exactly as `publish-dataset.ts` does. */
beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === DATASET_URL) return jsonResponse(datasetJson())
    throw new Error(`unexpected fetch during seed: ${url}`)
  }) as typeof fetch

  const index = await fetchConsolidatedIndex()
  const kv = env.DATASET as KVNamespace
  const r2 = env.BUILDS as R2Bucket

  const placeIds = allPlaceIds(index)
  for (const id of placeIds) {
    await kv.put(datasetKeys.place(HASH, id), JSON.stringify(placeDocFor(index, id)))
  }
  const aliases = allAliases(index)
  for (const [stopId, placeId] of aliases) {
    await kv.put(datasetKeys.alias(HASH, stopId), placeId)
  }
  const routeIds = allRouteIds(index)
  for (const id of routeIds) {
    await kv.put(datasetKeys.route(HASH, id), JSON.stringify(routeDocFor(index, id)))
  }
  const cells = allGeoCells(index)
  for (const [cell, entries] of cells) {
    await kv.put(datasetKeys.cell(HASH, cell), JSON.stringify(entries))
  }
  await r2.put(buildObjects.searchIndex(HASH), JSON.stringify(await buildSearchIndex(index)))

  const manifest: BuildManifest = {
    hash: HASH,
    sourceHash: 'seed',
    builtAt: '2026-07-27T00:00:00.000Z',
    counts: {
      places: placeIds.length,
      aliases: aliases.size,
      routes: routeIds.length,
      cells: cells.size,
      stops: index.stops.length,
    },
  }
  // The mutable pointer goes last — the flip that makes the build reachable.
  await kv.put(datasetKeys.current, JSON.stringify(manifest))

  globalThis.fetch = realFetch
})

beforeEach(() => {
  resetEtaCache()
  resetDatasetState()
  upstreamDatasetFetches = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    // Serving a request must never touch the consolidated dataset. Count it rather than
    // throwing, so a failure reports "it fetched the dataset" instead of an opaque 502.
    if (url === DATASET_URL) {
      upstreamDatasetFetches++
      upstreamDatasetInit = init
      return jsonResponse(datasetJson())
    }
    const stopEta = KMB_STOP_ETA.exec(url)
    if (stopEta?.[1]) return jsonResponse(kmbStopEtaJson(stopEta[1]))
    return realFetch(input, init)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

async function health() {
  return (await (await get('/v1/health')).json()) as {
    dataset: string
    buildHash: string | null
    datasetBuildsThisIsolate: number
  }
}

describe('/v1/health', () => {
  it('reports the KV build and a zero build counter', async () => {
    const h = await health()
    expect(h.dataset).toBe('kv')
    expect(h.buildHash).toBe(HASH)
    expect(h.datasetBuildsThisIsolate).toBe(0)
  })

  it('is never cached — it describes this isolate, not the URL', async () => {
    expect((await get('/v1/health')).headers.get('cache-control')).toBe('public, max-age=0')
  })
})

describe('a full endpoint sweep against a seeded build', () => {
  it('serves every endpoint from KV/R2 and builds the dataset zero times', async () => {
    const nearbyRes = await get(`/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=500`)
    expect(nearbyRes.status).toBe(200)
    const stops = (await nearbyRes.json()) as NearbyStop[]
    expect(stops.length).toBeGreaterThan(0)
    const placeId = stops[0]?.stop.id as string
    // The fixture's 20 poles cluster into six places; nearby still serves the closest twelve.
    const served = new Set(stops.flatMap((s) => s.stop.sources.map((x) => x.operatorStopId)))
    expect(served.size).toBe(SERVED_POLES)

    const detailRes = await get(`/v1/stop/${encodeURIComponent(placeId)}`)
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()) as StopDetail
    expect(detail.routes.length).toBeGreaterThan(0)
    expect(detail.members.length).toBeGreaterThan(0)

    // A bare member pole id must resolve through the alias to its whole place (ADR-042).
    const memberId = detail.members[0]?.id as string
    const viaMember = (await (
      await get(`/v1/stop/${encodeURIComponent(memberId)}`)
    ).json()) as StopDetail
    expect(viaMember.stop.id).toBe(placeId)

    // A **stale** place id — one member short of the current cluster, as a favourite saved before
    // a reclustering would be — must still land on the current place rather than 404.
    const stalePlaceId = `P:${detail.members
      .slice(0, -1)
      .map((m) => m.id)
      .join('+')}`
    expect(stalePlaceId).not.toBe(placeId)
    const viaStale = (await (
      await get(`/v1/stop/${encodeURIComponent(stalePlaceId)}`)
    ).json()) as StopDetail
    expect(viaStale.stop.id).toBe(placeId)

    // …and one whose **first** member is gone entirely (a pole retired upstream). Resolving only
    // through the head of the id would 404 a favourite that is still perfectly findable.
    const headDead = `P:KMB:RETIRED+${detail.members.map((m) => m.id).join('+')}`
    const viaTail = (await (
      await get(`/v1/stop/${encodeURIComponent(headDead)}`)
    ).json()) as StopDetail
    expect(viaTail.stop.id).toBe(placeId)

    expect((await get(`/v1/etas/${encodeURIComponent(placeId)}`)).status).toBe(200)

    const routeId = detail.routes[0]?.route.id as string
    const routeRes = await get(`/v1/route/${encodeURIComponent(routeId)}`)
    expect(routeRes.status).toBe(200)
    expect(((await routeRes.json()) as RouteDetail).stops.length).toBeGreaterThan(0)

    const indexRes = await get('/v1/index')
    expect(indexRes.status).toBe(200)
    expect(((await indexRes.json()) as SearchIndex).routes.length).toBe(poles.length)

    // The acceptance criterion, asserted two ways: the counter the Worker reports, and the
    // number of times the mock actually served the 8.3 MB dataset URL.
    expect(upstreamDatasetFetches).toBe(0)
    expect((await health()).datasetBuildsThisIsolate).toBe(0)
  })
})

describe('the mutable pointer', () => {
  it('falls back (and says so) when no build is current', async () => {
    const kv = env.DATASET as KVNamespace
    const saved = await kv.get(datasetKeys.current, 'text')
    await kv.delete(datasetKeys.current)
    resetDatasetState()
    try {
      const h = await health()
      expect(h.dataset).toBe('inline')
      expect(h.buildHash).toBeNull()
      // Health alone doesn't build the index; serving a request from the fallback does.
      expect(h.datasetBuildsThisIsolate).toBe(0)
      await get(`/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=451`)
      expect((await health()).datasetBuildsThisIsolate).toBe(1)
      expect(upstreamDatasetFetches).toBe(1)
      // The 8.3 MB fetch carries its own deadline (ADR-138). The memo in `getInlineIndex` clears
      // only on rejection, so without a signal a hung fetch would wedge this isolate for life —
      // and this runs inside workerd, so it also proves `AbortSignal.timeout` exists on this path.
      expect(upstreamDatasetInit?.signal).toBeInstanceOf(AbortSignal)
    } finally {
      if (saved) await kv.put(datasetKeys.current, saved)
      resetDatasetState()
    }
  })

  it('serves nothing from a build whose keys were never written', async () => {
    // The half-written-crawl scenario: a pointer at a hash with no shards behind it. Every
    // endpoint 404s or empties rather than serving a partial dataset — and because the pointer
    // is written last and keys are hash-scoped, this state is unreachable in production.
    const kv = env.DATASET as KVNamespace
    const saved = (await kv.get(datasetKeys.current, 'text')) as string
    await kv.put(
      datasetKeys.current,
      JSON.stringify({ ...JSON.parse(saved), hash: 'neverpublished' }),
    )
    resetDatasetState()
    try {
      const nearbyRes = await get(`/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=452`)
      expect(nearbyRes.status).toBe(200)
      expect(await nearbyRes.json()).toEqual([])
      // A stop id no earlier case requested: `caches.default` isn't reset between tests, so a
      // reused URL would be answered from the edge cache and prove nothing.
      // **404, not the 502 this asserted before WP2-8.** The id parses and resolves to nothing,
      // which is what `not_found` means; the Worker genuinely cannot tell an absent shard from an
      // absent stop, and the sentence above is why it does not have to — the pointer is written
      // last, so a *current* build always has its keys.
      expect((await get(`/v1/stop/${encodeURIComponent('KMB:SOLO7')}`)).status).toBe(404)
      // Still zero: a missing build is not a licence to rebuild the dataset in-request.
      expect((await health()).datasetBuildsThisIsolate).toBe(0)
      expect(upstreamDatasetFetches).toBe(0)
    } finally {
      await kv.put(datasetKeys.current, saved)
      resetDatasetState()
    }
  })
})
