import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import type { EtaReport, NearbyStop, StopDetail } from '@nextbus/core'
import { applyLiveEtasToStopDetail, memberStopIds } from '@nextbus/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEtaCache } from '../src/eta-cache'
import worker from '../src/index'
import { datasetJson, kmbStopEtaJson, ORIGIN, poles } from './fixtures'

// **`Eta.stopId` is the canonical pole id, and this is the suite that says so.**
//
// It was not. The normalizers stamp the operator's own stop id — `6AB438AD3AE100DD`, no prefix — because
// they never see the dataset that mints canonical ids (`packages/data-normalize/src/kmb.ts` says as much at
// its `stopId` parameter). But the contract declares the field's identity canonical: `EtaRefSchema` states
// that its `(stopId, routeId)` pair is "the same pair `formatFavoriteRouteKey` encodes", whose stop half is
// a canonical pole id. So every reader of that pair — `applyLiveEtasToStopDetail`,
// `applyLiveEtasToNearby`, and the `EtaHub` shard's `gone` list — was comparing two different alphabets.
//
// WHY NO EXISTING TEST CAUGHT IT, which is the interesting part. Nothing in the repo had ever *compared*
// the two spellings: `stopDetail` attaches `routes[].eta` by `routeId` alone, `/v1/nearby` hands a place
// its own readings by construction, and the wire-conformance suite checks the field is a `string` — which
// it was. Every fixture, including the kernel corpus, wrote the canonical spelling the contract asks for,
// so the kernel's own tests agreed with the contract while the server disagreed with both. It surfaced by
// opening the Place screen in a browser and watching every arrival blank one second after it painted.
//
// Hence the last test here: it does not check the field, it runs the **kernel merge** over a real response,
// which is the comparison that was missing. A shape assertion alone would pass again the day someone
// re-introduced the raw id in a different code path.

let realFetch: typeof globalThis.fetch
const DATASET_URL = 'https://data.hkbus.app/routeFareList.min.json'
const KMB_STOP_ETA = /^https:\/\/data\.etabus\.gov\.hk\/v1\/transport\/kmb\/stop-eta\/(.+)$/

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

async function get<T>(path: string): Promise<T> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`https://edge.test${path}`), env, ctx)
  await waitOnExecutionContext(ctx)
  expect(res.status).toBe(200)
  return (await res.json()) as T
}

beforeEach(() => {
  resetEtaCache()
  realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === DATASET_URL) return jsonResponse(datasetJson())
    const stopEta = KMB_STOP_ETA.exec(url)
    if (stopEta?.[1]) return jsonResponse(kmbStopEtaJson(stopEta[1]))
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

/** A pole that belongs to a merged place, so the canonical/raw distinction is visible at all. */
const pole = poles[0] as (typeof poles)[number]

describe('Eta.stopId', () => {
  it('is the canonical pole id on /v1/etas/:id, not the operator’s own', async () => {
    // `pole.id` resolves to the merged **place** it belongs to (ADR-042), so the readings come from both of
    // its kerbs — which is what makes the two spellings distinguishable here at all.
    const detail = await get<StopDetail>(`/v1/stop/${encodeURIComponent(pole.id)}`)
    const members = new Set(detail.members.map((m) => m.id))
    const raws = new Set(poles.map((p) => p.rawId))
    const etas = (await get<EtaReport>(`/v1/etas/${encodeURIComponent(pole.id)}`)).etas
    expect(etas.length).toBeGreaterThan(0)
    for (const eta of etas) {
      expect(members.has(eta.stopId)).toBe(true)
      // Stated as its own assertion so it cannot be misread as cosmetic: the raw id is a *substring* of the
      // canonical one, so a lazy `includes` check would have passed all along.
      expect(raws.has(eta.stopId)).toBe(false)
    }
  })

  it('is canonical on the readings embedded in /v1/stop/:id', async () => {
    const detail = await get<StopDetail>(`/v1/stop/${encodeURIComponent(pole.id)}`)
    const withEta = detail.routes.filter((r) => r.eta !== null)
    expect(withEta.length).toBeGreaterThan(0)
    for (const row of withEta) expect(row.eta?.stopId).toBe(row.stopId)
  })

  it('is canonical on /v1/nearby, where a place’s readings must name its member poles', async () => {
    const stops = await get<NearbyStop[]>(
      `/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=500`,
    )
    const withEtas = stops.filter((s) => s.etas.length > 0)
    expect(withEtas.length).toBeGreaterThan(0)
    for (const stop of withEtas) {
      // `memberStopIds` is how `applyLiveEtasToNearby` maps a reading to a place (ADR-042): a place id is
      // `P:<a>+<b>` and its readings must carry `<a>`/`<b>`, never the operator's own spelling.
      const members = new Set(memberStopIds(stop.stop.id))
      for (const eta of stop.etas) expect(members.has(eta.stopId)).toBe(true)
    }
  })

  it('still carries the boarding fare, whose table was keyed on the other spelling', async () => {
    // The regression risk of the fix itself, and the reason it is asserted rather than reasoned about:
    // `stampTables` used to convert each row's canonical id *back* to the operator's own, precisely because
    // readings arrived spelled that way. Had that conversion been left in place, every fare on every flat
    // ETA list would now be silently absent — a field quietly disappearing, which no shape check would see.
    // (`/v1/stop` is not the endpoint to ask: its rows carry their own `fare`, and its embedded readings
    // never went through the stamping tables at all.)
    const etas = (await get<EtaReport>(`/v1/etas/${encodeURIComponent(pole.id)}`)).etas
    expect(etas.filter((e) => e.fare !== undefined).length).toBeGreaterThan(0)
  })

  it('lets the kernel merge actually match — the comparison nothing did before', async () => {
    const detail = await get<StopDetail>(`/v1/stop/${encodeURIComponent(pole.id)}`)
    const etas = (await get<EtaReport>(`/v1/etas/${encodeURIComponent(pole.id)}`)).etas
    const merged = applyLiveEtasToStopDetail(detail, etas)
    const matched = merged.routes.filter((r) => r.eta !== null)
    // With the raw spelling this was 0 of N — the Place screen's arrivals all blanked. The number is
    // asserted against the reading count rather than a literal so the fixture can grow.
    expect(matched.length).toBe(etas.length)
    expect(matched.length).toBeGreaterThan(0)
  })
})
