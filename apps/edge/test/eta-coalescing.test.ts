import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import type { NearbyStop } from '@nextbus/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEtaCache } from '../src/eta-cache'
import worker from '../src/index'
import { datasetJson, kmbStopEtaJson, ORIGIN, SERVED_POLES, TOTAL_POLES } from './fixtures'

// WP0-4 acceptance. A counting fetch-mock stands in for every upstream feed, so "how many
// upstream calls did that request make?" is a hard number rather than an inference.
//
// These are unit-style (`worker.fetch(...)`) rather than `SELF.fetch(...)` on purpose: the
// integration runner gives the Worker its own module graph, so the test could neither count
// its `fetch` nor reset the coalescer between cases.

const DATASET_URL = 'https://data.hkbus.app/routeFareList.min.json'
const KMB_STOP_ETA = /^https:\/\/data\.etabus\.gov\.hk\/v1\/transport\/kmb\/stop-eta\/(.+)$/

let calls: string[]
const realFetch = globalThis.fetch

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

/**
 * Drive the Worker and settle its `waitUntil` work (the edge-cache write).
 *
 * `caches.default` is *not* reset between tests by the pool, so every case below uses its own
 * `radius` value. All of them cover the same twelve poles (the furthest sits ~312 m out), so
 * the results are identical while the edge-cache keys are distinct — which is what keeps an
 * edge-cache hit from masquerading as a coalescer hit.
 */
async function get(path: string): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`https://edge.test${path}`), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

beforeEach(() => {
  calls = []
  // The isolate outlives a single test, so the coalescer would still be warm from the
  // previous one. Each test starts cold; the static index stays memoized, which is fine
  // because building it isn't an ETA call and isn't counted.
  resetEtaCache()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === DATASET_URL) return jsonResponse(datasetJson())
    const stopEta = KMB_STOP_ETA.exec(url)
    if (stopEta?.[1]) {
      calls.push(url)
      return jsonResponse(kmbStopEtaJson(stopEta[1]))
    }
    return realFetch(input, init)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

/** Distinct member poles across every place in a `/v1/nearby` response. */
function polesIn(stops: NearbyStop[]): Set<string> {
  const ids = new Set<string>()
  for (const s of stops) for (const src of s.stop.sources) ids.add(src.operatorStopId)
  return ids
}

describe('/v1/nearby upstream fan-out', () => {
  it('issues exactly one upstream call per distinct pole it serves', async () => {
    const res = await get(`/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=500`)
    expect(res.status).toBe(200)
    const stops = (await res.json()) as NearbyStop[]

    const served = polesIn(stops)
    // The fixture puts 20 poles in range; nearby serves the closest 12 (six merged places).
    expect(served.size).toBe(SERVED_POLES)
    expect(served.size).toBeLessThan(TOTAL_POLES)

    // Exactly distinct-pole-count calls: no pole fetched twice, no pole fetched that the
    // response doesn't show, and none of the eight further-out singletons touched.
    expect(calls).toHaveLength(served.size)
    expect(new Set(calls).size).toBe(calls.length)
    for (const id of served) {
      expect(calls.filter((c) => c.endsWith(`/stop-eta/${id}`))).toHaveLength(1)
    }
    expect(calls.filter((c) => c.includes('/stop-eta/SOLO'))).toHaveLength(0)
  })

  it('two concurrent requests for the same poles issue one set of upstream calls', async () => {
    // Different radii → different edge-cache keys, same poles. That isolates the in-isolate
    // coalescer: an edge-cache hit cannot be what makes the second request free.
    const base = `/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`
    const [a, b] = await Promise.all([get(`${base}&radius=499`), get(`${base}&radius=498`)])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)

    expect(polesIn((await a.json()) as NearbyStop[]).size).toBe(SERVED_POLES)
    expect(calls).toHaveLength(SERVED_POLES)
    expect(new Set(calls).size).toBe(calls.length)
  })

  it('a follow-up request inside the TTL adds no upstream calls', async () => {
    const base = `/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`
    await get(`${base}&radius=497`)
    expect(calls).toHaveLength(SERVED_POLES)

    // A distinct cache key again, so this is the coalescer's TTL doing the work.
    await get(`${base}&radius=496`)
    expect(calls).toHaveLength(SERVED_POLES)
  })
})

describe('endpoints share one pole cache', () => {
  it('opening a place after Nearby does not refetch its poles', async () => {
    const stops = (await (
      await get(`/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=495`)
    ).json()) as NearbyStop[]
    const before = calls.length
    expect(before).toBe(SERVED_POLES)

    const placeId = stops[0]?.stop.id
    expect(placeId).toBeTruthy()
    const etas = await get(`/v1/etas/${encodeURIComponent(placeId as string)}`)
    expect(etas.status).toBe(200)
    expect(calls).toHaveLength(before)

    const detail = await get(`/v1/stop/${encodeURIComponent(placeId as string)}`)
    expect(detail.status).toBe(200)
    expect(calls).toHaveLength(before)
  })
})

describe('cache-control', () => {
  it('serves live endpoints with the 30 s ETA TTL', async () => {
    const res = await get(`/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=494`)
    expect(res.headers.get('cache-control')).toBe('public, max-age=30')
  })
})
