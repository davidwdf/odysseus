import {
  createExecutionContext,
  env,
  runInDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { LIVE_PATH, ServerFrameSchema } from '@nextbus/contract'
import {
  applyLiveEtasToStopDetail,
  boardingPoleId,
  dedupeRoutes,
  type Eta,
  type EtaReport,
  LIVE_SHARD_COUNT,
  memberStopIds,
  type ServerFrame,
  type StopDetail,
} from '@nextbus/core'
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
  type StaticIndex,
} from '@nextbus/data-normalize'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDatasetState } from '../src/dataset'
import { resetEtaCache } from '../src/eta-cache'
import type { EtaHub } from '../src/eta-hub'
import worker from '../src/index'
import { liveShardName } from '../src/live'
import { buildSearchIndex } from '../src/search-index'

// WP5-11: one physical pole published under two upstream stop ids is ONE member of its place, and
// the id it was folded onto keeps working — because it is an id riders have starred.
//
// The fixture is the two shapes the rule has to tell apart, taken from the real build:
//
//  · **Tin Shui Wai Park.** Two KMB poles print `TIN SHUI WAI PARK (TN510)`, 1.11 m apart — one
//    grid step of latitude, the smallest offset the source data can express. One physical pole. A
//    third pole prints `(TN511)` at *exactly* the same coordinate as the first, so distance alone
//    can never be the rule.
//  · **Tin Shui Estate.** Two KMB poles print `TIN SHUI ESTATE (TN507)` 22.9 m apart. KMB really
//    does that (TN507 22.88 m, TN581 19.01 m, ND126 35.35 m), and they are two berths a rider walks
//    between. Merging them would hide one berth's whole route list under the other's heading, which
//    is why the second half of this suite matters more than the first.
//
// Everything is asserted through the real path: `fetchConsolidatedIndex` → the shard derivations →
// a seeded KV build → `worker.fetch`. The two things a rider would lose if this were wrong — a
// favourite keyed on the folded pole, and the arrivals of the routes only that pole serves — are
// asserted end to end rather than argued about.

const DATASET_URL = 'https://data.hkbus.app/routeFareList.min.json'
const KMB_STOP_ETA = /^https:\/\/data\.etabus\.gov\.hk\/v1\/transport\/kmb\/stop-eta\/(.+)$/

const HASH = 'polemerge01'
const realFetch = globalThis.fetch

/** Metres → degrees at the fixture's latitude. */
const BASE = { lat: 22.45448, lng: 114.00297 }
const M_PER_DEG_LAT = 111_320
const mLat = (m: number) => m / M_PER_DEG_LAT
const mLng = (m: number) => m / (M_PER_DEG_LAT * Math.cos((BASE.lat * Math.PI) / 180))
/** The source feed's quantisation: five decimal places, ~1.11 m of latitude. */
const GRID = 0.00001

interface FixturePole {
  rawId: string
  id: string
  lat: number
  lng: number
  name: string
  /** `[routeNo, serviceType]` per route serving this pole. */
  routes: Array<[string, string]>
}

const pole = (
  rawId: string,
  name: string,
  lat: number,
  lng: number,
  routes: Array<[string, string]>,
): FixturePole => ({ rawId, id: `KMB:${rawId}`, lat, lng, name, routes })

/**
 * Tin Shui Wai Park, then Tin Shui Estate 200 m north (well beyond the 30 m merge radius, so the
 * two never cluster together).
 *
 * Two constraints the ADR-042 clustering puts on the fixture, both satisfied deliberately rather
 * than by luck: poles in one place share a landmark name (everything before the ` (`), and no two
 * poles of a place share a canonical route id — a shared route+bound vetoes the cluster outright.
 * `269D` at both TN510 poles is therefore two *service-type variants* of one rider line, which is
 * exactly what the real dataset has and what makes the duplicate row visible.
 */
const PARK_A = pole('PARKA510', 'TIN SHUI WAI PARK (TN510)', BASE.lat, BASE.lng, [
  ['269D', '1'],
  ['265S', '1'],
])
const PARK_B = pole('PARKB510', 'TIN SHUI WAI PARK (TN510)', BASE.lat - GRID, BASE.lng, [
  ['269D', '3'],
  ['N269', '1'],
])
const PARK_C = pole('PARKC511', 'TIN SHUI WAI PARK (TN511)', BASE.lat, BASE.lng, [['E37', '1']])
const ESTATE_A = pole('ESTA507', 'TIN SHUI ESTATE (TN507)', BASE.lat + mLat(200), BASE.lng, [
  ['276A', '1'],
])
const ESTATE_B = pole(
  'ESTB507',
  'TIN SHUI ESTATE (TN507)',
  BASE.lat + mLat(200 + 22.88),
  BASE.lng,
  [['69X', '1']],
)
const POLES = [PARK_A, PARK_B, PARK_C, ESTATE_A, ESTATE_B]

/** Far-east terminus: gives every route the same due-east travel bearing, so the bearing gate and
 *  the cluster spread cap both pass. */
const TERMINUS = { rawId: 'TERMEAST', lat: BASE.lat, lng: BASE.lng + mLng(4000) }

function datasetJson(): unknown {
  const stopList: Record<string, unknown> = {
    [TERMINUS.rawId]: {
      location: { lat: TERMINUS.lat, lng: TERMINUS.lng },
      name: { en: 'EAST TERMINUS', zh: '東總站' },
    },
  }
  for (const p of POLES) {
    stopList[p.rawId] = { location: { lat: p.lat, lng: p.lng }, name: { en: p.name, zh: p.name } }
  }
  const routeList: Record<string, unknown> = {}
  for (const p of POLES) {
    for (const [routeNo, serviceType] of p.routes) {
      routeList[`${routeNo}+${serviceType}+A+B`] = {
        co: ['kmb'],
        route: routeNo,
        serviceType,
        bound: { kmb: 'O' },
        orig: { en: p.name, zh: p.name },
        dest: { en: 'EAST TERMINUS', zh: '東總站' },
        stops: { kmb: [p.rawId, TERMINUS.rawId] },
        fares: ['5.8', null],
      }
    }
  }
  return { routeList, stopList }
}

/** Which raw pole ids the ETA fan-out asked upstream for, this test. */
let boardsCalled: string[] = []

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

/** A KMB stop board carrying the routes that pole really serves — so a missing board shows up as
 *  missing *arrivals*, which is the symptom a rider would see. */
function kmbStopEtaJson(rawId: string): unknown {
  const p = POLES.find((x) => x.rawId === rawId)
  const now = new Date('2026-07-31T12:00:00+08:00')
  return {
    generated_timestamp: now.toISOString(),
    data: (p?.routes ?? []).map(([route, serviceType], i) => ({
      co: 'KMB',
      route,
      dir: 'O',
      service_type: Number(serviceType),
      seq: 1,
      dest_en: 'EAST TERMINUS',
      dest_tc: '東總站',
      dest_sc: '东总站',
      eta_seq: 1,
      eta: new Date(now.getTime() + (i + 1) * 4 * 60_000).toISOString(),
      rmk_en: '',
      rmk_tc: '',
      rmk_sc: '',
      data_timestamp: now.toISOString(),
    })),
  }
}

async function get(path: string): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`https://edge.test${path}`), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

let index: StaticIndex

/** Publish a complete build into the test KV/R2, exactly as `publish-dataset.ts` does. */
beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === DATASET_URL) return jsonResponse(datasetJson())
    throw new Error(`unexpected fetch during seed: ${url}`)
  }) as typeof fetch

  index = await fetchConsolidatedIndex()
  const kv = env.DATASET as KVNamespace
  const r2 = env.BUILDS as R2Bucket

  for (const id of allPlaceIds(index)) {
    await kv.put(datasetKeys.place(HASH, id), JSON.stringify(placeDocFor(index, id)))
  }
  for (const [stopId, placeId] of allAliases(index)) {
    await kv.put(datasetKeys.alias(HASH, stopId), placeId)
  }
  for (const id of allRouteIds(index)) {
    await kv.put(datasetKeys.route(HASH, id), JSON.stringify(routeDocFor(index, id)))
  }
  for (const [cell, entries] of allGeoCells(index)) {
    await kv.put(datasetKeys.cell(HASH, cell), JSON.stringify(entries))
  }
  await r2.put(buildObjects.searchIndex(HASH), JSON.stringify(await buildSearchIndex(index)))
  const manifest: BuildManifest = {
    hash: HASH,
    sourceHash: 'seed',
    builtAt: '2026-07-31T00:00:00.000Z',
    counts: { places: 0, aliases: 0, routes: 0, cells: 0, stops: 0 },
  }
  await kv.put(datasetKeys.current, JSON.stringify(manifest))
  globalThis.fetch = realFetch
})

beforeEach(async () => {
  resetEtaCache()
  resetDatasetState()
  boardsCalled = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === DATASET_URL) throw new Error('served a request from the consolidated dataset')
    const stopEta = KMB_STOP_ETA.exec(url)
    if (stopEta?.[1]) {
      boardsCalled.push(stopEta[1])
      return jsonResponse(kmbStopEtaJson(stopEta[1]))
    }
    return realFetch(input, init)
  }) as typeof fetch
  await resetShards()
})

afterEach(async () => {
  for (const ws of opened) {
    try {
      ws.close(1000, 'test over')
    } catch {
      // Already closed by the case itself; closing twice is not a failure.
    }
  }
  opened = []
  await resetShards()
  globalThis.fetch = realFetch
})

// ── Driving the live socket ─────────────────────────────────────────────────────────────────────
// A shard is named for its target set (ADR-056 D4), so two cases watching one place share an object
// and the pool resets neither instances nor storage between them. Same wipe `eta-hub.test.ts` uses.

/** Every client socket this file opened, so nothing is left subscribed for the next case. */
let opened: WebSocket[] = []

async function resetShards(): Promise<void> {
  for (let shard = 0; shard < LIVE_SHARD_COUNT; shard++) {
    const stub = env.ETA_HUB?.getByName(liveShardName(shard))
    if (!stub) continue
    await runInDurableObject(stub, async (_instance: EtaHub, state) => {
      for (const ws of state.getWebSockets()) ws.close(1000, 'test reset')
      await state.storage.deleteAlarm()
      state.storage.sql.exec('DELETE FROM readings')
      state.storage.kv.delete('unchangedRounds')
    })
  }
}

/**
 * Open `/v1/live` for one target and return the readings the shard's own frames carry, reduced the
 * way a client reduces them.
 *
 * Three frames, because a subscriber naming a target the shard has never polled pulls the alarm to
 * *now* and an alarm set to now fires by itself: `snapshot` (empty), `status{live}`, then the `delta`
 * that fills it. Validated against `ServerFrameSchema` on the way past, like every other frame
 * assertion in the suite.
 */
async function liveEtasOf(target: string): Promise<Eta[]> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(
    new Request(`https://edge.test${LIVE_PATH}?targets=${encodeURIComponent(target)}`, {
      headers: { Upgrade: 'websocket' },
    }),
    env,
    ctx,
  )
  await waitOnExecutionContext(ctx)
  expect(res.status).toBe(101)
  const ws = res.webSocket
  if (!ws) throw new Error('a 101 with no webSocket')
  const frames: ServerFrame[] = []
  ws.addEventListener('message', (event: MessageEvent) => {
    const text =
      typeof event.data === 'string'
        ? event.data
        : new TextDecoder().decode(event.data as ArrayBuffer)
    frames.push(ServerFrameSchema.parse(JSON.parse(text)))
  })
  ws.accept()
  opened.push(ws)
  const deadline = Date.now() + 5_000
  while (frames.length < 3 && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
  }
  if (frames.length < 3) throw new Error(`timed out waiting for 3 frames; got ${frames.length}`)
  // `changed` on the first delta *is* the whole set — the snapshot before it was empty.
  return frames.flatMap((f) =>
    f.type === 'snapshot' ? f.etas : f.type === 'delta' ? f.changed : [],
  )
}

const parkPlace = () => {
  const place = index.places.find((p) => p.members.some((m) => m.id === PARK_A.id))
  if (!place) throw new Error('the park poles did not cluster into a place')
  return place
}

describe('the build folds one physical pole published twice', () => {
  it('keeps the two TN510 poles as ONE member, and the TN511 pole beside them as its own', () => {
    // The defect: before this rule the place had three members and printed `KMB · TN510` twice,
    // character for character, with no way for a rider to choose between them.
    const place = parkPlace()
    expect(place.members.map((m) => m.id)).toEqual([PARK_A.id, PARK_C.id])
    expect([...(place.aliases ?? new Map())]).toEqual([
      [PARK_A.id, [expect.objectContaining({ id: PARK_B.id })]],
    ])
  })

  it('leaves a genuine two-berth stand as two members', () => {
    // 22.88 m, same operator, same name in all three locales, same printed code TN507 — everything
    // the wire carries agrees except position, and that is precisely a stand a rider walks between.
    const estate = index.places.find((p) => p.members.some((m) => m.id === ESTATE_A.id))
    expect(estate?.members.map((m) => m.id)).toEqual([ESTATE_A.id, ESTATE_B.id])
    expect(estate?.aliases).toBeUndefined()
  })

  it('still names the folded pole in the place id, so no published id churns', () => {
    // The place id is minted from every clustered pole, not from the members: a rider's deep link
    // and the query cache are keyed on it, and `memberStopIds` — how a live reading finds its place
    // — reads the poles out of it.
    expect(parkPlace().id).toBe(`P:${PARK_A.id}+${PARK_B.id}+${PARK_C.id}`)
  })

  it('resolves the folded pole id to the place, and keeps its routes', () => {
    // The favourite-survival path in the dataset: the alias table has an entry for the folded pole,
    // it is not given a place document of its own, and the route it is the only pole for is still in
    // the place — attributed to the pole the route's own stop list names.
    expect(allAliases(index).get(PARK_B.id)).toBe(parkPlace().id)
    expect(allPlaceIds(index)).not.toContain(PARK_B.id)
    const doc = placeDocFor(index, parkPlace().id)
    expect(doc?.routes.filter((r) => r.stopId === PARK_B.id).map((r) => r.route.id)).toEqual([
      'KMB:269D:outbound:3',
      'KMB:N269:outbound:1',
    ])
    expect(doc?.members.find((m) => m.id === PARK_A.id)?.aliasIds).toEqual([PARK_B.id])
    // The honest route count is over every pole, folded ones included, and counts a rider *line*
    // once: 269D at both poles is one line, plus 265S, N269 and E37.
    expect(doc?.routeCount).toBe(4)
  })
})

describe('a favourite saved at the folded pole still loads its route', () => {
  it('serves the whole place from a bare folded-pole id', async () => {
    // Exactly what the Favourites tab does with a saved `KMB:PARKB510|KMB:269D:outbound:3` key:
    // `getStop(pole)` on the folded id. It must resolve — through the alias table — and the row it
    // matches (by the row's own `stopId`, which is why the wire keeps the folded id) must be there
    // with an arrival on it.
    const res = await get(`/v1/stop/${encodeURIComponent(PARK_B.id)}`)
    expect(res.status).toBe(200)
    const detail = (await res.json()) as StopDetail
    expect(detail.stop.id).toBe(parkPlace().id)
    const saved = detail.routes.find(
      (r) => r.stopId === PARK_B.id && r.route.id === 'KMB:269D:outbound:3',
    )
    expect(saved).toBeDefined()
    expect(saved?.eta?.arrivals.length).toBeGreaterThan(0)
  })

  it('calls the folded pole’s own upstream board', async () => {
    // Its routes are its own — upstream lists them at that pole and nowhere else — so skipping its
    // board would leave those rows blank for good while every other row looked healthy.
    await get(`/v1/stop/${encodeURIComponent(parkPlace().id)}`)
    expect(boardsCalled.sort()).toEqual([PARK_A.rawId, PARK_B.rawId, PARK_C.rawId].sort())
  })

  it('serves one member per boarding point, with the folded id named on it', async () => {
    const detail = (await (
      await get(`/v1/stop/${encodeURIComponent(parkPlace().id)}`)
    ).json()) as StopDetail
    expect(detail.members.map((m) => m.id)).toEqual([PARK_A.id, PARK_C.id])
    expect(detail.members[0]?.aliasIds).toEqual([PARK_B.id])
    // …and the kernel rule the Place screen groups with agrees with the document it was sent.
    expect(boardingPoleId(PARK_B.id, detail.members)).toBe(PARK_A.id)
    expect(boardingPoleId(PARK_C.id, detail.members)).toBe(PARK_C.id)
  })

  it('keeps the fare on a reading off the folded pole', async () => {
    // `N269` is served only at the folded pole, so its fare is looked up under an id that is not a
    // member. `stampTables` keys the fare table on the row's own `stopId`; if a reading were stamped
    // with anything else, this row would silently lose its fare — a field quietly disappearing,
    // which no shape check would see. (The spelling itself is asserted in the merge suite below.)
    const { etas } = (await (
      await get(`/v1/etas/${encodeURIComponent(parkPlace().id)}`)
    ).json()) as EtaReport
    const row = etas.find((e) => e.routeId === 'KMB:N269:outbound:1')
    expect(row?.fare).toBe('5.8')
  })
})

// ── The live merge, which is what decides whether the fold is safe at all ────────────────────────
//
// `applyLiveEtasToStopDetail` matches a reading to a row by `(row.stopId, row.route.id)`. The fold
// gives a place two spellings for one pole, so "which spelling does a reading carry" stops being
// rhetorical: a route that boards only at a folded pole has a row naming the **folded** id, and a
// reading stamped with anything else matches nothing — every arrival on that row blanks one cadence
// after the screen paints, with no error anywhere. That is not a hypothetical; it is `Eta.stopId`
// carrying the operator's raw id all over again (`eta-stop-id.test.ts`), one indirection along.
//
// So the rule this suite pins is a single sentence: **a reading is stamped with the pole whose board
// it came off — the id the route's own row names — and never with the boarding point that row is
// *displayed* under.** The fold is a display collapse and it stays on the display side of the wire:
//
//   · the wire (`/v1/stop`, `/v1/etas`, the `EtaHub` frames) speaks raw pole ids, so every id
//     upstream publishes is a valid `Eta.stopId` and a valid favourite key, for ever;
//   · the client re-bases through `boardingPoleId` for *grouping and dedupe only*, which is why
//     `dedupeRoutes` takes `members` instead of the screen rewriting each row's id — a rewritten
//     row would take the star's key with it and orphan the favourite it just saved.
//
// Asserted over real responses from the real Worker rather than argued from the code, because the
// last time these two spellings disagreed the reasoning looked fine and the screen was blank.
describe('the live merge matches the rows it is merged into', () => {
  /** `KMB:269D:outbound:3` and `KMB:N269:outbound:1` board **only** at the folded pole. */
  const FOLDED_ONLY = ['KMB:269D:outbound:3', 'KMB:N269:outbound:1']

  const stopDetail = async (id: string): Promise<StopDetail> =>
    (await (await get(`/v1/stop/${encodeURIComponent(id)}`)).json()) as StopDetail
  // The `etas` half of the `EtaReport` ADR-073 made this endpoint answer with; no board here refuses.
  const flatEtas = async (id: string): Promise<Eta[]> =>
    ((await (await get(`/v1/etas/${encodeURIComponent(id)}`)).json()) as EtaReport).etas

  it('stamps /v1/stop’s embedded readings with the id their own row names', async () => {
    // The invariant `eta-stop-id.test.ts` already asserts for a place with no aliases, asked here of
    // the place that has one — which is the only place it can fail.
    const detail = await stopDetail(parkPlace().id)
    const withEta = detail.routes.filter((r) => r.eta !== null)
    expect(withEta.length).toBeGreaterThan(0)
    for (const row of withEta) expect(row.eta?.stopId).toBe(row.stopId)
    // …and specifically for the rows that exist only at the folded pole, since a fold that stamped
    // the boarding point would still satisfy the loop above for every *other* row.
    for (const routeId of FOLDED_ONLY) {
      const row = detail.routes.find((r) => r.route.id === routeId)
      expect(row?.stopId, routeId).toBe(PARK_B.id)
      expect(row?.eta?.stopId, routeId).toBe(PARK_B.id)
    }
  })

  it('fills every row of the place — including the folded pole’s — from /v1/etas', async () => {
    // The comparison nothing did before the fold shipped: the real merge over the real pair of
    // responses. `N269` is the row that matters; it boards only at the folded pole, and `dedupeEtas`
    // cannot collapse it into anything because no other pole here serves that line.
    const detail = await stopDetail(parkPlace().id)
    const etas = await flatEtas(parkPlace().id)
    const merged = applyLiveEtasToStopDetail(detail, etas)
    const n269 = merged.routes.find((r) => r.route.id === 'KMB:N269:outbound:1')
    expect(n269?.eta?.arrivals.length).toBeGreaterThan(0)
    // Nothing is dropped on the floor either: every reading served found the row it belongs to.
    const matched = merged.routes.filter((r) => r.eta !== null)
    expect(matched.length).toBe(etas.length)
  })

  it('fills them from the EtaHub’s own frames, which is the other engine', async () => {
    // Same merge, readings taken off `/v1/live` instead of `/v1/etas`. The shard reads through
    // `stopEtas`, so this is one stamping site and two transports — but "so it must agree" is exactly
    // the reasoning that shipped the last spelling bug, so it is measured.
    const detail = await stopDetail(parkPlace().id)
    const etas = await liveEtasOf(parkPlace().id)
    expect(etas.length).toBeGreaterThan(0)
    const merged = applyLiveEtasToStopDetail(detail, etas)
    expect(
      merged.routes.find((r) => r.route.id === 'KMB:N269:outbound:1')?.eta?.arrivals.length,
    ).toBeGreaterThan(0)
    // And the place still recognises its own readings: `applyLiveEtasToNearby` maps a reading to a
    // card through `memberStopIds`, which reads the poles out of the `P:` id — so the folded pole has
    // to be in that id, which is why the id is minted from every clustered pole and not from members.
    const poles = new Set(memberStopIds(parkPlace().id))
    for (const eta of etas) expect(poles.has(eta.stopId), eta.stopId).toBe(true)
  })

  it('renders one row per line under one heading, with the star still keyed on the raw pole', async () => {
    // The Place screen's path, end to end: merge, then `dedupeRoutes(rows, members)`.
    //
    // Two things have to hold at once and they pull in opposite directions. `269D` boards at both
    // ids of this one physical pole (service types 1 and 3), so a rider must see **one** row — that
    // is the whole point of the fold. And the row that survives must still carry a *raw* pole id,
    // because `SaveStar` saves `${row.stopId}|${routeId}` and the Favourites tab matches that key
    // against `/v1/stop`'s own rows: re-base the row and the star writes a key no row will ever
    // match again, which orphans the favourite at the moment it is created.
    const detail = await stopDetail(parkPlace().id)
    const merged = applyLiveEtasToStopDetail(detail, await flatEtas(parkPlace().id))
    const rows = dedupeRoutes(merged.routes, detail.members)
    const at269D = rows.filter((r) => r.route.routeNo === '269D')
    expect(at269D).toHaveLength(1)
    expect([PARK_A.id, PARK_B.id]).toContain(at269D[0]?.stopId)
    // Grouped under the boarding point, so the place prints one `TN510` heading and not two.
    const headings = new Set(rows.map((r) => boardingPoleId(r.stopId, detail.members)))
    expect([...headings].sort()).toEqual([PARK_A.id, PARK_C.id])
    // Every surviving row's id is one the wire named, so every star it writes is matchable.
    const wireIds = new Set(detail.routes.map((r) => r.stopId))
    for (const r of rows) expect(wireIds.has(r.stopId), r.stopId).toBe(true)
  })

  it('matches a favourite saved under EITHER id of the folded pole', async () => {
    // Both spellings are permanent keys (ADR-062), which is the promise that replaces a migration.
    // The Favourites tab resolves a saved pole with `getStop(pole)` and then filters the rows by the
    // saved key, so the test is: does a row carrying that exact key come back, with an arrival on it?
    for (const savedPole of [PARK_A.id, PARK_B.id]) {
      const detail = await stopDetail(savedPole)
      expect(detail.stop.id).toBe(parkPlace().id)
      const saved = detail.routes.filter((r) => r.stopId === savedPole && r.eta !== null)
      expect(saved.length, `${savedPole} matched no row with a reading`).toBeGreaterThan(0)
    }
  })
})
