import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import type { EtaBatch, EtaReport, NearbyStop } from '@nextbus/core'
import { ETAS_BATCH_MAX_IDS } from '@nextbus/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEtaCache } from '../src/eta-cache'
import worker from '../src/index'
import { datasetJson, kmbStopEtaJson, ORIGIN, poles, SERVED_POLES } from './fixtures'

// WP5-7's server half, inside real workerd.
//
// THE ONE PROPERTY THAT MATTERS MOST IS THE FIRST TEST
// A batch endpoint's whole risk is becoming a **second read path** — a slightly different answer for
// the same question, drifting apart over a wave or two. So the first case asserts that an entry is
// byte-identical to what `/v1/etas/<that id>` serves, for every id, rather than asserting a shape. Every
// other case here is about the things a batch has that a single request does not: ordering, duplicates,
// the cap, and a per-id failure that must not take the other ids down with it.
//
// THREE HARNESS FACTS, EACH OF WHICH COST A RUN SOMEWHERE (docs/05, "what the harnesses require")
//  1. `resetEtaCache()` before every case — `coalesce` holds a pole for 30 s per isolate, so without it
//     case two reads case one's boards and a call count means nothing.
//  2. `caches.default` is reset between neither tests **nor files**, so every URL below carries its own
//     `?case=` marker. The handler reads only `ids`, so the marker changes the cache key alone — and the
//     router rebuilds the key from the normalized id list while *keeping* other parameters, which is
//     exactly what makes that work.
//  3. The upstream stub **throws** on an unrecognised URL. A stub that fell through to the real `fetch`
//     is how a suite in this repo once reached the live internet.

const DATASET_URL = 'https://data.hkbus.app/routeFareList.min.json'
const KMB_STOP_ETA = /^https:\/\/data\.etabus\.gov\.hk\/v1\/transport\/kmb\/stop-eta\/(.+)$/

let calls: string[]
const realFetch = globalThis.fetch

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

async function get(path: string): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`https://edge.test${path}`), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

/** `?ids=a&ids=b…` — the repeated parameter, percent-encoded per id, plus a cache-key marker. */
const batchPath = (ids: readonly string[], marker: string): string =>
  `/v1/etas?case=${marker}&${ids.map((id) => `ids=${encodeURIComponent(id)}`).join('&')}`

/** The six merged places the fixture puts inside the default radius, in `/v1/nearby` order. */
async function placeIds(marker: string): Promise<string[]> {
  const res = await get(`/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=500&case=${marker}`)
  expect(res.status).toBe(200)
  return ((await res.json()) as NearbyStop[]).map((s) => s.stop.id)
}

beforeEach(() => {
  calls = []
  resetEtaCache()
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === DATASET_URL) return jsonResponse(datasetJson())
    const stopEta = KMB_STOP_ETA.exec(url)
    if (stopEta?.[1]) {
      calls.push(url)
      return jsonResponse(kmbStopEtaJson(stopEta[1]))
    }
    throw new Error(`unstubbed upstream URL: ${url}`)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('/v1/etas?ids=… answers exactly what /v1/etas/:id answers', () => {
  it('every entry is byte-identical to the single-id response for that id', async () => {
    const ids = await placeIds('eq-nearby')
    expect(ids.length).toBeGreaterThanOrEqual(2)

    // The singles first, then the batch, both inside one coalescer window — so the readings are the
    // same readings and a difference can only be this endpoint's doing.
    const singles = new Map<string, EtaReport>()
    for (const id of ids) {
      const res = await get(`/v1/etas/${encodeURIComponent(id)}?case=eq-single`)
      expect(res.status).toBe(200)
      singles.set(id, (await res.json()) as EtaReport)
    }

    const res = await get(batchPath(ids, 'eq-batch'))
    expect(res.status).toBe(200)
    const batch = (await res.json()) as EtaBatch
    expect(batch.reports.map((r) => r.id).sort()).toEqual([...ids].sort())
    for (const entry of batch.reports) {
      const { id, ...report } = entry
      // **Byte-identical, not merely equivalent.** `JSON.stringify` compares key order too, which is
      // what would catch the batch assembling its own object instead of spreading the producer's.
      expect(JSON.stringify(report)).toBe(JSON.stringify(singles.get(id)))
    }
    // And the readings are real, so the assertion above is not comparing two empty lists.
    expect(batch.reports.some((r) => r.etas.length > 0)).toBe(true)

    // **Soonest-first, asserted rather than inherited.** `stopCardView`'s "keep the first reading per
    // line" depends on every producer sorting that way and nothing enforces it (a standing 🟡 in
    // `docs/11`, which named this endpoint as the next producer). It is true here by construction —
    // `stopEtasBatch` delegates to the one sorting producer, `stopArrivals`, and the byte-equality above
    // is the proof — but a producer that stopped sorting would silently show the *later* bus of a line,
    // so the property is stated where a reader can see it fail.
    for (const entry of batch.reports) {
      const firsts = entry.etas.map((e) => e.arrivals[0] ?? '')
      expect([...firsts].sort()).toEqual(firsts)
    }
  })
})

describe('the id list', () => {
  it('is deduplicated and answered in code-point order, whatever order it arrived in', async () => {
    const ids = (await placeIds('order-nearby')).slice(0, 3)
    const shuffled = [...ids].reverse()
    const res = await get(batchPath([...shuffled, shuffled[0] as string], 'order'))
    expect(res.status).toBe(200)
    const batch = (await res.json()) as EtaBatch
    // One entry per **distinct** id — the duplicate collapses — and sorted, because the two live
    // engines must serialize one round identically (D1) and because the colo-cache key is then a
    // property of the set rather than of the order a client happened to list it in.
    expect(batch.reports.map((r) => r.id)).toEqual([...ids].sort())
  })

  it('keeps a place and one of its own member poles as two entries', async () => {
    // Two ids that resolve to **one place** through the dataset's alias table are two questions with
    // one answer, and the caller asked both — a Nearby card is keyed on a place id and a favourite on a
    // pole (ADR-062), so a client indexing by the id it sent would lose a target if these merged.
    const stops = (await (
      await get(`/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=500&case=member-nearby`)
    ).json()) as NearbyStop[]
    const place = stops[0]
    const poleId = place?.stop.sources[0]
    expect(place && poleId).toBeTruthy()
    const memberId = `${(poleId as { operator: string }).operator}:${(poleId as { operatorStopId: string }).operatorStopId}`

    const res = await get(batchPath([place?.stop.id as string, memberId], 'member'))
    expect(res.status).toBe(200)
    const batch = (await res.json()) as EtaBatch
    expect(batch.reports.map((r) => r.id).sort()).toEqual([memberId, place?.stop.id].sort())
    // Both answer, and neither is empty — the pole's own board is inside the place's fan-out.
    for (const entry of batch.reports) expect(entry.error).toBeUndefined()
  })

  it('refuses an empty list and a list over the cap, and never truncates', async () => {
    const empty = await get('/v1/etas?case=empty')
    expect(empty.status).toBe(400)

    const over = Array.from({ length: ETAS_BATCH_MAX_IDS + 1 }, (_, i) => `KMB:OVER${i}`)
    const res = await get(batchPath(over, 'over'))
    expect(res.status).toBe(400)
    // The point of the 400: nothing was answered, so a client cannot mistake a short list for a
    // complete one. A truncating endpoint would have returned 200 with twelve entries.
    expect((await res.json()) as { error: unknown }).toHaveProperty('error')

    // Exactly at the cap is fine — the boundary, asserted, because an off-by-one here is a 400 a
    // client cannot avoid.
    const atCap = await get(batchPath(over.slice(0, ETAS_BATCH_MAX_IDS), 'at-cap'))
    expect(atCap.status).toBe(200)
  })
})

describe('a per-id failure is an entry, not a status', () => {
  it('names the unresolvable id and still answers the others', async () => {
    const ids = await placeIds('fail-nearby')
    const good = ids[0] as string
    const res = await get(batchPath([good, 'KMB:NO-SUCH-POLE', 'not-an-id-at-all'], 'fail'))
    // A 200: failing the request would throw away the readings of the id that answered, which is the
    // same judgement ADR-073 made one level down for a place whose second kerb refused.
    expect(res.status).toBe(200)
    const batch = (await res.json()) as EtaBatch
    const byId = new Map(batch.reports.map((r) => [r.id, r]))
    expect(byId.size).toBe(3)

    expect(byId.get(good)?.error).toBeUndefined()
    expect(byId.get(good)?.etas.length).toBeGreaterThan(0)

    // A pole that has left the dataset: permanent, so a subscription stops asking about it.
    expect(byId.get('KMB:NO-SUCH-POLE')?.error?.code).toBe('not_found')
    expect(byId.get('KMB:NO-SUCH-POLE')?.error?.retryable).toBe(false)
    expect(byId.get('KMB:NO-SUCH-POLE')?.etas).toEqual([])

    // An id that does not parse: also permanent, and a different code, because the caller has to
    // change it rather than wait (ADR-064).
    expect(byId.get('not-an-id-at-all')?.error?.code).toBe('bad_request')
    expect(byId.get('not-an-id-at-all')?.error?.retryable).toBe(false)
  })
})

describe('upstream fan-out', () => {
  it('shares the pole cache with /v1/nearby, so a batch over the same places is free', async () => {
    await get(`/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=493&case=share-nearby`)
    expect(calls).toHaveLength(SERVED_POLES)

    const ids = await placeIds('share-ids')
    const before = calls.length
    const res = await get(batchPath(ids, 'share-batch'))
    expect(res.status).toBe(200)
    // Zero. `coalesce` is the mechanism (ADR-057) and it is what makes a batch cheaper than the
    // per-target fan-out it replaced rather than merely fewer HTTP requests: the six places overlap.
    expect(calls).toHaveLength(before)
  })

  it('costs one call per distinct pole when cold, not one per id', async () => {
    const ids = await placeIds('cold-ids')
    resetEtaCache()
    calls = []
    const res = await get(batchPath(ids, 'cold'))
    expect(res.status).toBe(200)
    // Six places of two poles each: twelve boards, not six ids × twelve.
    expect(calls).toHaveLength(SERVED_POLES)
    expect(new Set(calls).size).toBe(calls.length)
  })
})

describe('cache-control', () => {
  it('serves the batch with the same 30 s ETA TTL as the single-id endpoint', async () => {
    const ids = await placeIds('ttl-ids')
    const res = await get(batchPath(ids.slice(0, 2), 'ttl'))
    expect(res.headers.get('cache-control')).toBe('public, max-age=30')
  })
})

describe('/v1/etas?route=… — one report per pole, narrowed to the route (ADR-136)', () => {
  const routeId = `KMB:${(poles[0] as (typeof poles)[number]).route}:outbound:1`

  it('answers the route document’s poles, carrying only that route’s readings', async () => {
    const routeRes = await get(`/v1/route/${encodeURIComponent(routeId)}?case=route-doc`)
    expect(routeRes.status).toBe(200)
    const detail = (await routeRes.json()) as { stops: Array<{ stop: { id: string } }> }

    const res = await get(`/v1/etas?route=${encodeURIComponent(routeId)}&case=route-ok`)
    expect(res.status).toBe(200)
    const batch = (await res.json()) as EtaBatch
    // The report set IS the route document's stop list — the same resolution `/v1/live?route=` makes —
    // so the polled route watch and the schematic cannot disagree about which kerbs exist.
    expect(batch.reports.map((r) => r.id)).toEqual(detail.stops.map((s) => s.stop.id))
    for (const report of batch.reports) {
      expect(report.error).toBeUndefined()
      // Narrowed by the server: no reading for any other route calling at the pole, which is the whole
      // fan-out argument (ADR-121 measured the un-narrowed question at ~19×).
      for (const eta of report.etas) expect(eta.routeId).toBe(routeId)
    }
    expect(
      batch.reports.some((r) => r.etas.length > 0),
      'the narrowing must not have filtered everything',
    ).toBe(true)
  })

  it('refuses both parameters at once, a malformed id, and an unknown route — each with its own code', async () => {
    const both = await get(`/v1/etas?route=${encodeURIComponent(routeId)}&ids=KMB%3AX&case=both`)
    expect(both.status).toBe(400)

    const malformed = await get('/v1/etas?route=not-a-route&case=route-bad')
    expect(malformed.status).toBe(400)
    expect(((await malformed.json()) as { code: string }).code).toBe('bad_request')

    const unknown = await get('/v1/etas?route=KMB%3ANOPE%3Aoutbound%3A1&case=route-missing')
    expect(unknown.status).toBe(404)
    expect(((await unknown.json()) as { code: string }).code).toBe('not_found')
  })
})
