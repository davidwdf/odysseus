import {
  createExecutionContext,
  env,
  runInDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { LIVE_PATH, ServerFrameSchema } from '@nextbus/contract'
import {
  applyLiveEtasToStopDetail,
  dedupeRoutes,
  type Eta,
  type EtaReport,
  LIVE_SHARD_COUNT,
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
import { LIVE_HUB_KV_KEYS } from '../src/eta-hub'
import worker from '../src/index'
import { liveShardName } from '../src/live'
import { buildSearchIndex } from '../src/search-index'

// WP5-9: **one reading per boarding point.** A place is N poles (ADR-042) and a rider walks to one of
// them, so a line boarding at two poles is two arrivals — and every published path has to say so.
//
// The fixture is Tin Shui Estate, Tin Shui Road, from build `1ccad7436a8df480`, with its ids
// shortened. KMB runs 269D outbound off **two** poles of that one place: service types 1 and 4 at
// `KMB:C052B4D46E1F48EA` and service type 3 at `KMB:BD53690B9DA1C956`, 20 m apart. That is the shape
// the whole work package is about, and it carries three distinct failures at once:
//
//  1. `/v1/etas/:id` collapsed the line across the place, so the second pole's arrival was **thrown
//     away** and its row read "no reading right now" while a bus was due there.
//  2. `/v1/stop/:id` attached readings by route id **alone**, so a reading off one pole could be
//     handed to a row that departs from the other — measured live on 2026-07-31 at Hiram's Highway,
//     opposite Marina Cove, where the row for `GMB:1A:outbound:2002355` at `GMB:20001114` carried a
//     reading stamped `GMB:20009421`. The pole B board below reproduces that exactly: it publishes a
//     service-type variant the static data lists at pole A.
//  3. …and the row at the pole the bus is actually coming to got **nothing**, because its own variant
//     was not the one upstream published. So the honest rule is per pole *and then* per rider line at
//     that pole, which is one kernel rule (`applyLiveEtasToStopDetail`) that the edge now calls rather
//     than reimplements.
//
// Everything is asserted through the real path — `fetchConsolidatedIndex` → the shard derivations → a
// seeded KV build → `worker.fetch` — and the merge assertions run the real kernel function over the
// real pair of responses, because "one stamping site, so they must agree" is the reasoning that
// shipped the last two spelling bugs.

const DATASET_URL = 'https://data.hkbus.app/routeFareList.min.json'
const KMB_STOP_ETA = /^https:\/\/data\.etabus\.gov\.hk\/v1\/transport\/kmb\/stop-eta\/(.+)$/

const HASH = 'perpole0001'
const realFetch = globalThis.fetch

const BASE = { lat: 22.46231, lng: 113.99998 }
const M_PER_DEG_LAT = 111_320
const mLat = (m: number) => m / M_PER_DEG_LAT
const mLng = (m: number) => m / (M_PER_DEG_LAT * Math.cos((BASE.lat * Math.PI) / 180))

interface FixturePole {
  rawId: string
  id: string
  lat: number
  lng: number
  name: string
  /** `[routeNo, serviceType]` per route the **static dataset** lists at this pole. */
  routes: Array<[string, string]>
  /** `[routeNo, serviceType, minutesFromNow]` — what this pole's board *publishes*, which is
   *  deliberately not always what the static data lists here. Upstream really does that. */
  board: Array<[string, string, number]>
}

/**
 * Two poles of one place, 20 m apart.
 *
 * The ADR-042 clustering constraints are satisfied deliberately rather than by luck: the two share a
 * landmark name (everything before the ` (`) so they are candidate edges, they carry **different**
 * printed codes so WP5-11's fold leaves them as two members, and no two poles of a place may share a
 * canonical route id — which is why 269D appears here as service types 1/4 at one pole and 3 at the
 * other. That is not a fixture convenience: it is the only way the real dataset can express one rider
 * line at two kerbs, and it is what the whole cross-pole case rests on.
 */
const POLE_A: FixturePole = {
  rawId: 'ESTA507',
  id: 'KMB:ESTA507',
  lat: BASE.lat,
  lng: BASE.lng,
  name: 'TIN SHUI ESTATE (TN507)',
  routes: [
    ['269D', '1'],
    ['269D', '4'],
    ['264X', '1'],
  ],
  // Both variants of 269D are due here, four minutes apart. The pair a rider reads as one bus.
  board: [
    ['269D', '1', 8],
    ['269D', '4', 4],
    ['264X', '1', 11],
  ],
}
const POLE_B: FixturePole = {
  rawId: 'ESTB581',
  id: 'KMB:ESTB581',
  lat: BASE.lat + mLat(20),
  lng: BASE.lng,
  name: 'TIN SHUI ESTATE (TN581)',
  routes: [['269D', '3']],
  // **The Marina Cove shape, twice over.** Neither variant this pole publishes is the one the static
  // data lists here: type 4 is listed at pole A (so a route-id-only index hands A's row a reading off
  // B) and type 9 is listed nowhere at all (so even the destination has to be found by rider line).
  // Upstream does both — KMB adds a service type mid-service, and at Hiram's Highway GMB publishes a
  // route code at the pole its stop list does not name.
  board: [
    ['269D', '9', 3],
    ['269D', '4', 6],
  ],
}
const POLES = [POLE_A, POLE_B]

/** Far-east terminus: one travel bearing for every route, so the bearing gate and the cluster spread
 *  cap both pass. */
const TERMINUS = { rawId: 'TERMEAST', lat: BASE.lat, lng: BASE.lng + mLng(4000) }

const NOW = new Date('2026-07-31T12:00:00+08:00')
/** Every published arrival is at a distinct minute, so a reading that landed on the wrong row is
 *  visible as a *wrong time* and not merely as a wrong id. */
const dueAt = (minutes: number): string => new Date(NOW.getTime() + minutes * 60_000).toISOString()
/** What one pole publishes for one variant, or `undefined` where it publishes nothing. */
const published = (pole: FixturePole, routeNo: string, serviceType: string): number | undefined =>
  pole.board.find(([r, s]) => r === routeNo && s === serviceType)?.[2]

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
        // Each variant names its own destination, so a reading attributed to the wrong row shows up
        // as the wrong destination too — the GMB Tai On Street failure in a franchised costume.
        dest: { en: `LEK YUEN ${serviceType}`, zh: `瀝源 ${serviceType}` },
        stops: { kmb: [p.rawId, TERMINUS.rawId] },
        fares: ['18.5', null],
      }
    }
  }
  return { routeList, stopList }
}

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

/** A KMB stop board for one pole — what that pole *publishes*, which is not always what the static
 *  data lists there. */
function kmbStopEtaJson(rawId: string): unknown {
  const p = POLES.find((x) => x.rawId === rawId)
  return {
    generated_timestamp: NOW.toISOString(),
    data: (p?.board ?? []).map(([route, serviceType, minutes]) => ({
      co: 'KMB',
      route,
      dir: 'O',
      service_type: Number(serviceType),
      seq: 1,
      dest_en: `LEK YUEN ${serviceType}`,
      dest_tc: `瀝源 ${serviceType}`,
      dest_sc: `沥源 ${serviceType}`,
      eta_seq: 1,
      eta: dueAt(minutes),
      rmk_en: '',
      rmk_tc: '',
      rmk_sc: '',
      data_timestamp: NOW.toISOString(),
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
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === DATASET_URL) throw new Error('served a request from the consolidated dataset')
    const stopEta = KMB_STOP_ETA.exec(url)
    if (stopEta?.[1]) return jsonResponse(kmbStopEtaJson(stopEta[1]))
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

// ── The live socket, the second engine that reads the same seam ──────────────────────────────────

let opened: WebSocket[] = []

async function resetShards(): Promise<void> {
  for (let shard = 0; shard < LIVE_SHARD_COUNT; shard++) {
    const stub = env.ETA_HUB?.getByName(liveShardName(shard))
    if (!stub) continue
    await runInDurableObject(stub, async (_instance: EtaHub, state) => {
      for (const ws of state.getWebSockets()) ws.close(1000, 'test reset')
      await state.storage.deleteAlarm()
      state.storage.sql.exec('DELETE FROM readings')
      // Every key the object owns, from its own declaration: this line used to name `'unchangedRounds'`
      // as a literal in four suites at once, so a fifth key would have leaked between cases in all of
      // them without a word (WP6-B step 2b added two).
      for (const key of LIVE_HUB_KV_KEYS) state.storage.kv.delete(key)
    })
  }
}

/** The readings `/v1/live`'s own frames carry for one target, reduced the way a client reduces them. */
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
  // Two frames since WP6-8b: the first round arrives as the deferred snapshot, then `live`.
  while (frames.length < 2 && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
  }
  if (frames.length < 2) throw new Error(`timed out waiting for 2 frames; got ${frames.length}`)
  return frames.flatMap((f) =>
    f.type === 'snapshot' ? f.etas : f.type === 'delta' ? f.changed : [],
  )
}

const estatePlace = () => {
  const place = index.places.find((p) => p.members.some((m) => m.id === POLE_A.id))
  if (!place) throw new Error('the two estate poles did not cluster into one place')
  return place
}

const stopDetail = async (id: string): Promise<StopDetail> =>
  (await (await get(`/v1/stop/${encodeURIComponent(id)}`)).json()) as StopDetail
// `/v1/etas/:id` answers an `EtaReport` since ADR-073, and this helper takes the `etas` half — every
// assertion below is about which readings are published, and none of these fixtures refuses a board.
const flatEtas = async (id: string): Promise<Eta[]> =>
  ((await (await get(`/v1/etas/${encodeURIComponent(id)}`)).json()) as EtaReport).etas

describe('the fixture is the shape the rule is about', () => {
  it('is one place of two members, with 269D boarding at both', () => {
    const place = estatePlace()
    expect(place.members.map((m) => m.id)).toEqual([POLE_A.id, POLE_B.id])
    const doc = placeDocFor(index, place.id)
    const at269D = doc?.routes.filter((r) => r.route.routeNo === '269D')
    expect(at269D?.map((r) => `${r.stopId}|${r.route.id}`)).toEqual([
      `${POLE_A.id}|KMB:269D:outbound:1`,
      `${POLE_A.id}|KMB:269D:outbound:4`,
      `${POLE_B.id}|KMB:269D:outbound:3`,
    ])
    // The honest total counts a rider LINE once per place: 269D plus 264X.
    expect(doc?.routeCount).toBe(2)
  })
})

describe('/v1/etas publishes one reading per boarding point', () => {
  it('keeps the second pole’s arrival instead of discarding it', async () => {
    // The defect, stated as the rider sees it: 269D is due at BOTH kerbs of this place, and the flat
    // list published one of them. Keyed across the place, the survivor was whichever kerb happened to
    // be sooner and the other row rendered "no reading right now".
    const etas = await flatEtas(estatePlace().id)
    const at269D = etas.filter((e) => e.routeId.startsWith('KMB:269D'))
    expect(at269D.map((e) => e.stopId).sort()).toEqual([POLE_A.id, POLE_B.id])
  })

  it('still collapses two service-type variants at ONE pole, keeping the sooner', async () => {
    // The other half of the same rule, and the reason it is not simply "publish everything": pole A
    // has 269D as types 1 (8 min) and 4 (4 min), which is one bus to a rider. One reading, the sooner.
    const etas = await flatEtas(estatePlace().id)
    const atA = etas.filter((e) => e.stopId === POLE_A.id && e.routeId.startsWith('KMB:269D'))
    expect(atA).toHaveLength(1)
    expect(atA[0]?.routeId).toBe('KMB:269D:outbound:4')
    expect(atA[0]?.arrivals[0]).toBe(dueAt(published(POLE_A, '269D', '4') ?? -1))
  })

  it('finds a destination for an unlisted variant at ITS OWN pole, never at the sibling’s', async () => {
    // Pole B's soonest 269D is service type 9, which the static data lists nowhere, so the destination
    // can only come from the rider-line fallback in `stampTables`. Keyed by line alone that fallback
    // returned the FIRST row of the line anywhere in the place — pole A's — and at Tai On Street the
    // first row of a shared minibus number is a different service with a different terminus. Keyed by
    // line *at this pole* it returns pole B's own 269D, which is the only honest answer available.
    const etas = await flatEtas(estatePlace().id)
    const at269D = new Map(
      etas.filter((e) => e.routeId.startsWith('KMB:269D')).map((e) => [e.stopId, e]),
    )
    expect(at269D.get(POLE_B.id)?.routeId).toBe('KMB:269D:outbound:9')
    expect(at269D.get(POLE_B.id)?.destination?.en).toBe('LEK YUEN 3')
    // …and a reading whose exact variant IS listed still takes that variant's own destination.
    expect(at269D.get(POLE_A.id)?.destination?.en).toBe('LEK YUEN 4')
  })
})

describe('/v1/stop attaches a reading to a row at its own pole', () => {
  it('never hands a row a reading off another pole', async () => {
    // The invariant `eta-stop-id.test.ts` asserts, asked of a fixture that can actually break it: pole
    // B publishes the variant listed at pole A, so a route-id-only index attached B's reading to A's
    // row. Live example on 2026-07-31: `GMB:1A:outbound:2002355`'s row at `GMB:20001114` carrying a
    // reading stamped `GMB:20009421`.
    const detail = await stopDetail(estatePlace().id)
    const withEta = detail.routes.filter((r) => r.eta !== null)
    expect(withEta.length).toBeGreaterThan(0)
    for (const row of withEta) expect(row.eta?.stopId, row.route.id).toBe(row.stopId)
  })

  it('fills the row at the pole the bus is coming to, whichever variant upstream named', async () => {
    // Pole B's only row is 269D service type 3, and its board published types 9 and 4. All three are
    // 269D outbound at that kerb, so the rider's answer is the soonest of them — 3 minutes — and not
    // silence. Same judgement `stampTables` already makes for destinations, made once in the kernel
    // for the row itself, so the HTTP payload and the live merge cannot disagree about it.
    const detail = await stopDetail(estatePlace().id)
    const rowB = detail.routes.find((r) => r.stopId === POLE_B.id)
    expect(rowB?.route.id).toBe('KMB:269D:outbound:3')
    expect(rowB?.eta?.stopId).toBe(POLE_B.id)
    expect(rowB?.eta?.arrivals[0]).toBe(dueAt(published(POLE_B, '269D', '9') ?? -1))
  })

  it('leaves a row with no reading at its own pole null, rather than borrowing one', async () => {
    // The other direction, and the one that keeps the rule honest: pole A lists 269D type 4 and its
    // own board did publish it, so A's row is filled from A. Nothing at A ever reads pole B's board.
    const detail = await stopDetail(estatePlace().id)
    const rowA4 = detail.routes.find(
      (r) => r.stopId === POLE_A.id && r.route.id === 'KMB:269D:outbound:4',
    )
    expect(rowA4?.eta?.arrivals[0]).toBe(dueAt(published(POLE_A, '269D', '4') ?? -1))
    expect(rowA4?.eta?.stopId).toBe(POLE_A.id)
    // Pole B published its own type 4 four minutes later; that reading belongs to B's row and to no
    // row here. A route-id-only index gave it to this row, so the kerb was wrong AND the time was.
    expect(rowA4?.eta?.arrivals[0]).not.toBe(dueAt(published(POLE_B, '269D', '4') ?? -1))
  })
})

describe('the live merge fills both poles’ rows', () => {
  it('from /v1/etas, which is the engine that ships today', async () => {
    const detail = await stopDetail(estatePlace().id)
    const merged = applyLiveEtasToStopDetail(detail, await flatEtas(estatePlace().id))
    const filled = merged.routes.filter((r) => r.route.routeNo === '269D' && r.eta !== null)
    expect(filled.map((r) => r.stopId).sort()).toEqual([POLE_A.id, POLE_A.id, POLE_B.id].sort())
    for (const row of filled) expect(row.eta?.stopId, row.route.id).toBe(row.stopId)
  })

  it('from the EtaHub’s own frames, which is the other engine', async () => {
    const detail = await stopDetail(estatePlace().id)
    const etas = await liveEtasOf(estatePlace().id)
    expect(
      etas
        .filter((e) => e.routeId.startsWith('KMB:269D'))
        .map((e) => e.stopId)
        .sort(),
    ).toEqual([POLE_A.id, POLE_B.id])
    const merged = applyLiveEtasToStopDetail(detail, etas)
    for (const row of merged.routes.filter((r) => r.eta !== null)) {
      expect(row.eta?.stopId, row.route.id).toBe(row.stopId)
    }
  })

  it('and the Place screen then shows a time under each kerb, not a dash under one', async () => {
    // The whole point, end to end: merge, then `dedupeRoutes`. One 269D row per pole, each with the
    // arrival at *that* pole. Before this, the second row's badge read "—" with a bus due there.
    const detail = await stopDetail(estatePlace().id)
    const merged = applyLiveEtasToStopDetail(detail, await flatEtas(estatePlace().id))
    const rows = dedupeRoutes(merged.routes, detail.members)
    const at269D = rows.filter((r) => r.route.routeNo === '269D')
    expect(at269D).toHaveLength(2)
    expect(at269D.map((r) => r.stopId).sort()).toEqual([POLE_A.id, POLE_B.id])
    for (const row of at269D) expect(row.eta?.arrivals.length, row.stopId).toBeGreaterThan(0)
  })
})
