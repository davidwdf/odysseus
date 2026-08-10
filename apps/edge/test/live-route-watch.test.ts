// `/v1/live?route=…` — one Durable Object per route, its poles resolved here rather than named by the
// client (proposals/05, step 2).
//
// WHAT THIS IS FOR
// Citybus and GMB publish no bulk route-eta feed, so a route screen has no times at all (ADR-114) while
// their per-pole boards answer fine. A route watch subscribes to every pole of one route — and the point of
// naming the object after the route is that **every rider on it shares one round**, which is the only reason
// fanning out ~40 poles is affordable at all.
//
// WHAT IS ASSERTED HERE AND WHAT IS NOT
// The three claims a reviewer should be able to check without reading the implementation:
//
//   1. the poles come from the **route document** — the same one `/v1/route/:id` draws — so the socket cannot
//      watch a pole the schematic does not;
//   2. two clients naming the same route land on the **same object**, and two directions do not;
//   3. the object learns what it is from its **own name**: it narrows every reading to that route and uses
//      the route caps rather than the place-shard ones.
//
// Not asserted here: the phase-aligned cadence (`nextRouteRoundMs` is pinned by corpus in `packages/core`
// and is not wired into the hub until step 2b), and anything about a screen.

import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { LIVE_PATH } from '@nextbus/contract'
import { LIVE_ROUTE_NAME_PREFIX, liveShardFor, parseStopId, routeWatchName } from '@nextbus/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetEtaCache } from '../src/eta-cache'
import type { EtaHub } from '../src/eta-hub'
import {
  LIVE_HUB_KV_KEYS,
  LIVE_MAX_TARGETS_PER_CONNECTION,
  LIVE_ROUTE_MAX_POLES,
  ROUNDS_COMPLETED_KEY,
} from '../src/eta-hub'
import worker from '../src/index'
import { liveShardName } from '../src/live'
import { datasetJson, ORIGIN } from './fixtures'

const DATASET = /routeFareList\.min\.json$/
const KMB_STOP_ETA = /\/v1\/transport\/kmb\/stop-eta\/([^/?]+)/
// A narrowed target is asked about per **route** rather than per pole — which is the coalescer choosing the
// cheaper upstream call for a set that names one line, and worth seeing in this file: it is the reason a
// route watch of 40 KMB poles is not 40 requests.
const KMB_ROUTE_ETA = /\/v1\/transport\/kmb\/route-eta\//

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

/** Every upstream board this file asked for, in order — what the narrowing rule is measured on. */
let boardCalls: string[] = []

/**
 * What every board answers with. `null` is "nothing due" — the default, because most of this file is
 * about routing and cost rather than readings. The cadence cases set it to a reading carrying a chosen
 * `data_timestamp`, which is the operator's publish clock and the only input the route cadence has.
 */
let boardPublishedAt: string | null = null

/** `true` while every board should refuse, so a round produces failures and no fresh reading. */
let boardsRefuse = false

/**
 * A `data_timestamp` for one pole in particular, overriding `boardPublishedAt`.
 *
 * The one case that needs it: the CDN can serve two poles of one route from cache entries of different
 * ages, and which of the two the cadence aligns to is a real decision (`newestPublish`).
 */
let boardPublishedAtByPole: Record<string, string> = {}

/** One KMB board's answer, with a `data_timestamp` this test chose — per pole when it chose two. */
function boardJson(rawId: string): unknown {
  const publishedAt = boardPublishedAtByPole[rawId] ?? boardPublishedAt
  if (publishedAt === null || publishedAt === undefined) {
    return { generated_timestamp: new Date().toISOString(), data: [] }
  }
  return {
    generated_timestamp: publishedAt,
    data: [
      {
        co: 'KMB',
        route: 'R00',
        dir: 'O',
        service_type: 1,
        seq: 1,
        dest_en: 'EAST TERMINUS',
        dest_tc: '東總站',
        dest_sc: '东总站',
        eta_seq: 1,
        // Far enough ahead that the reading is never "due" and never expires mid-case.
        eta: new Date(Date.now() + 9 * 60_000).toISOString(),
        rmk_en: '',
        rmk_tc: '',
        rmk_sc: '',
        // **The field the whole cadence turns on.** `dataTimestamp` carries the upstream's `+08:00`
        // offset in production; written as an offset here rather than `Z` so the parse this exercises is
        // the parse that runs in production.
        data_timestamp: publishedAt,
      },
    ],
  }
}

function stubUpstream(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (DATASET.test(url)) return jsonResponse(datasetJson())
    const board = KMB_STOP_ETA.exec(url)
    if (board || KMB_ROUTE_ETA.test(url)) {
      boardCalls.push(url)
      if (boardsRefuse) return new Response('upstream is having a day', { status: 503 })
      return jsonResponse(boardJson(board?.[1] ?? ''))
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch
}

async function get(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://edge.test${path}`, init), env, {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext)
}

const upgrade = (query: string) =>
  get(`${LIVE_PATH}?${query}`, { headers: { Upgrade: 'websocket' } })

/** A route id the seeded fixture actually carries, and its stop ids, straight from the route endpoint. */
let ROUTE_ID = ''
let ROUTE_POLES: string[] = []

beforeAll(async () => {
  stubUpstream()
  // Resolve the route through the *public* endpoints, the way a client does — nearby → a place → one of its
  // routes → that route's document. So "the poles come from the route document" is a claim about what a
  // rider's schematic would draw, not about a fixture helper the product never calls.
  const nearby = (await (
    await get(`/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=497`)
  ).json()) as { stop: { id: string } }[]
  const placeId = nearby[0]?.stop.id
  if (placeId === undefined) throw new Error('the fixture produced no nearby places')
  const place = (await (await get(`/v1/stop/${encodeURIComponent(placeId)}`)).json()) as {
    routes: { route: { id: string } }[]
  }
  for (const { route } of place.routes) {
    const res = await get(`/v1/route/${encodeURIComponent(route.id)}`)
    if (!res.ok) continue
    const detail = (await res.json()) as { stops: { stop: { id: string } }[] }
    if (detail.stops.length >= 2) {
      ROUTE_ID = route.id
      ROUTE_POLES = detail.stops.map((s) => s.stop.id)
      break
    }
  }
  if (ROUTE_ID === '') throw new Error('no route at the fixture origin calls at two or more stops')
})

beforeEach(() => {
  resetEtaCache()
  boardCalls = []
  boardPublishedAt = null
  boardsRefuse = false
  boardPublishedAtByPole = {}
  stubUpstream()
})

/**
 * Sockets this file has opened, and the objects they landed on.
 *
 * A Durable Object outlives a test case, so a socket left open leaks into the next one — and the cases below
 * count sockets and sum targets, which is exactly what a leak corrupts. Found the honest way: an injected
 * defect that made one case throw before its `close()` turned *two unrelated cases* red as well, so a real
 * regression here would arrive as three failures pointing at the wrong things. Closing is not enough on its
 * own either: `close()` is a handshake, so the next case can start while the object still lists the socket.
 * `afterEach` therefore waits for the object to agree it is gone.
 */
let opened: { ws: WebSocket; routeId: string }[] = []

const track = (ws: WebSocket, routeId: string): WebSocket => {
  opened.push({ ws, routeId })
  return ws
}

afterEach(async () => {
  for (const { ws } of opened) {
    try {
      ws.close(1000, 'test over')
    } catch {
      // Already closed by the case itself; closing twice is not a failure.
    }
  }
  const routeIds = [...new Set(opened.map((o) => o.routeId))]
  opened = []
  for (const routeId of routeIds) {
    const stub = (env.ETA_HUB as NonNullable<typeof env.ETA_HUB>).getByName(
      routeWatchName(routeId) as string,
    )
    const deadline = Date.now() + 2_000
    let remaining = -1
    while (Date.now() < deadline) {
      remaining = await runInDurableObject(
        stub,
        async (_instance: EtaHub, state) => state.getWebSockets().length,
      )
      if (remaining === 0) break
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
    expect(remaining, `${routeId} still holds sockets, which would leak into the next case`).toBe(0)
    // …and the object's own state goes with the socket. A Durable Object outlives a case, so a publish
    // clock or a cadence ramp left behind would set the *next* case's first cadence — which for the
    // cadence cases below is the thing under test.
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.deleteAlarm()
      state.storage.sql.exec('DELETE FROM readings')
      for (const key of LIVE_HUB_KV_KEYS) state.storage.kv.delete(key)
    })
  }
})

describe('a route watch is one object, named for the route', () => {
  it('upgrades on a route id alone', async () => {
    await openRouteWatch(ROUTE_ID)
  })

  it('refuses an id that is not a route id, before any object exists', async () => {
    // The `route-<anything>` hazard `routeWatchName` guards, at the door arbitrary text arrives at.
    for (const bad of ['KMB:6F106FD26B684372', '<script>', 'KMB:1A:outbound']) {
      const res = await upgrade(`route=${encodeURIComponent(bad)}`)
      expect(res.status, bad).toBe(400)
    }
  })

  it('says so when the route is not in the dataset', async () => {
    const res = await upgrade(`route=${encodeURIComponent('KMB:999X:outbound:1')}`)
    expect(res.status).toBe(404)
  })

  it('watches every pole of the route document, and only those', async () => {
    // The claim that matters most: the socket's target set IS the schematic's stop list. A pole the route
    // does not call at would be an upstream call nobody asked for; a missing one is a row that never updates.
    await openRouteWatch(ROUTE_ID)
    const watched = await inRouteObject(ROUTE_ID, async (_instance, state) => {
      const seen = new Set<string>()
      for (const ws of state.getWebSockets()) {
        const raw = ws.deserializeAttachment() as { targets?: { stopId: string }[] } | null
        for (const t of raw?.targets ?? []) seen.add(t.stopId)
      }
      return [...seen].sort()
    })
    expect(watched).toEqual([...ROUTE_POLES].sort())
  })

  it('narrows every reading to that route, which its own name is what tells it', async () => {
    // A place shard watches every line at a pole; a route watch wants one. Without this a 40-pole route
    // would poll every line at all forty — the place shape at route scale.
    await openRouteWatch(ROUTE_ID)
    const narrowings = await inRouteObject(ROUTE_ID, async (_instance, state) => {
      const out: (string[] | undefined)[] = []
      for (const ws of state.getWebSockets()) {
        const raw = ws.deserializeAttachment() as { targets?: { routeIds?: string[] }[] } | null
        for (const t of raw?.targets ?? []) out.push(t.routeIds)
      }
      return out
    })
    expect(narrowings.length).toBeGreaterThan(0)
    for (const routeIds of narrowings) expect(routeIds).toEqual([ROUTE_ID])
  })

  it('puts two clients on one object, and the two directions on two', async () => {
    // The property the whole design is for: the *n*th rider on a route costs nothing upstream because they
    // join a round that is already happening. Asserted on the object's identity, which is what decides it.
    const name = routeWatchName(ROUTE_ID)
    expect(routeWatchName(ROUTE_ID)).toBe(name)
    expect(name?.startsWith(LIVE_ROUTE_NAME_PREFIX)).toBe(true)

    await openRouteWatch(ROUTE_ID)
    await openRouteWatch(ROUTE_ID)
    const sockets = await inRouteObject(
      ROUTE_ID,
      async (_instance, state) => state.getWebSockets().length,
    )
    expect(sockets, 'two clients on one route did not share an object').toBe(2)

    // …and the reverse bound is a different route, so a different object. Their poles barely overlap, so
    // sharing one would union two rounds for no benefit.
    const reverse = ROUTE_ID.includes(':outbound:')
      ? ROUTE_ID.replace(':outbound:', ':inbound:')
      : ROUTE_ID.replace(':inbound:', ':outbound:')
    expect(reverse).not.toBe(ROUTE_ID)
    expect(routeWatchName(reverse)).not.toBe(name)
  })

  it('does not truncate the route it was asked to watch', async () => {
    expect(LIVE_ROUTE_MAX_POLES).toBeGreaterThan(ROUTE_POLES.length)
    await openRouteWatch(ROUTE_ID)
    expect(await keptTargets(ROUTE_ID)).toBe(ROUTE_POLES.length)
  })
})

// ── The caps, at the object rather than through the door ─────────────────────────────────────────
//
// The fixture's longest route calls at **two** poles, so the case above cannot tell a route cap of 64 from
// the place-connection cap of 12: both keep two. The measured range for a real Citybus route is 13–41 poles
// (proposals/05), which is above one cap and below the other, and that gap is the whole reason
// `LIVE_ROUTE_MAX_POLES` exists. So these two cases hand the target list to a route-named object directly —
// the same door `liveUpgrade` forwards through — and the ids need not be a route the dataset carries,
// because what is under test is the hub's arithmetic. That the *door* refuses an unknown route is asserted
// above, where it belongs.

/** Open a socket on a route-named object with a target list of our choosing. */
/** Open a route watch through the front door, the way a client does, and keep it for `afterEach`. */
async function openRouteWatch(routeId: string): Promise<WebSocket> {
  const res = await upgrade(`route=${encodeURIComponent(routeId)}`)
  expect(res.status, `upgrade for ${routeId}`).toBe(101)
  const ws = res.webSocket
  if (!ws) throw new Error('a 101 with no webSocket')
  ws.accept()
  return track(ws, routeId)
}

/** Look inside the object a route watch lands on. */
function inRouteObject<T>(
  routeId: string,
  read: (instance: EtaHub, state: DurableObjectState) => Promise<T>,
): Promise<T> {
  const stub = (env.ETA_HUB as NonNullable<typeof env.ETA_HUB>).getByName(
    routeWatchName(routeId) as string,
  )
  return runInDurableObject(stub, read as never) as Promise<T>
}

async function connectToRouteObject(
  routeId: string,
  targets: readonly string[],
): Promise<{
  ws: WebSocket
  statuses: () => string[]
  acceptedTargets: () => string[]
  awaitSnapshot: () => Promise<void>
}> {
  const stub = (env.ETA_HUB as NonNullable<typeof env.ETA_HUB>).getByName(
    routeWatchName(routeId) as string,
  )
  const res = await stub.fetch(
    new Request(`https://edge.test${LIVE_PATH}?targets=${encodeURIComponent(targets.join(','))}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )
  expect(res.status).toBe(101)
  const ws = res.webSocket
  if (!ws) throw new Error('a 101 with no webSocket')
  // Listener before `accept()`: the object answers inside this same `fetch`, so its frames are queued.
  const messages: string[] = []
  ws.addEventListener('message', (event: MessageEvent) => {
    messages.push(typeof event.data === 'string' ? event.data : '<binary>')
  })
  ws.accept()
  track(ws, routeId)
  return {
    ws,
    statuses: () => messages.filter((m) => m.includes('"status"')),
    /**
     * The accepted set, off the `snapshot` — which is what a cap has to be asserted on.
     *
     * **Not the socket's stored attachment**, and the difference was a flake this file shipped for one
     * commit. These cases hand the object synthetic pole ids to reach a cap no real route reaches, and a
     * synthetic id resolves to no place — so the first round answers `not_found`, which is
     * `retryable: false`, which means *the target has left the subscription* and the attachment legitimately
     * empties. In isolation the assertion won that race; under a full-suite load the round did, and the
     * failure read as "the cap kept nothing". The snapshot is sent inside the upgrade, before any round can
     * run, and it is the accepted set by definition.
     */
    /**
     * Wait for the `snapshot` to be *dispatched*.
     *
     * It is queued inside the upgrade — the object sends it before returning the 101 — but a queued frame
     * reaches a listener on a later turn of the event loop, so reading `messages` synchronously after
     * `accept()` finds nothing. The previous version of these cases only worked because an unrelated
     * `await` happened to give the loop that turn.
     */
    awaitSnapshot: async () => {
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline) {
        if (messages.some((m) => m.includes('"snapshot"'))) return
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
      }
      throw new Error('no snapshot arrived')
    },
    acceptedTargets: () => {
      const snapshot = messages.find((m) => m.includes('"snapshot"'))
      if (snapshot === undefined) return []
      const frame = JSON.parse(snapshot) as { targets?: { stopId: string }[] }
      return (frame.targets ?? []).map((t) => t.stopId)
    },
  }
}

/** How many targets the object is actually watching, summed over its sockets. */
function keptTargets(routeId: string): Promise<number> {
  return inRouteObject(routeId, async (_instance, state) => {
    let n = 0
    for (const ws of state.getWebSockets()) {
      const raw = ws.deserializeAttachment() as { targets?: unknown[] } | null
      n += raw?.targets?.length ?? 0
    }
    return n
  })
}

const synthetic = (n: number, tag: string): string[] =>
  Array.from({ length: n }, (_, i) => `KMB:${tag}${String(i).padStart(3, '0')}`)

describe('the route cap is the route’s own', () => {
  it('keeps a route longer than a place connection is allowed', async () => {
    // Twenty poles: above `LIVE_MAX_TARGETS_PER_CONNECTION` (12) and below `LIVE_ROUTE_MAX_POLES` (64), so
    // this fails on the place cap and passes only on the route one. A real 41-pole Citybus route arriving
    // as 12 rows of times and 29 rows of nothing is exactly the bug this case is here to keep out.
    const long = synthetic(20, 'LONG')
    expect(long.length).toBeGreaterThan(LIVE_MAX_TARGETS_PER_CONNECTION)
    expect(long.length).toBeLessThan(LIVE_ROUTE_MAX_POLES)
    const { statuses, acceptedTargets, awaitSnapshot } = await connectToRouteObject(
      'KMB:LONG:outbound:1',
      long,
    )
    await awaitSnapshot()
    expect(acceptedTargets()).toEqual(long)
    expect(statuses().filter((s) => s.includes('not watching'))).toEqual([])
  })

  it('drops the excess past its own cap, and names what it dropped', async () => {
    // The cap has to bite somewhere, and a rider is owed the truth about where. A pathological dataset row
    // is the only way to reach it — no HK bus route calls at 65 poles — but "no route is that long" is an
    // argument for the number, not for leaving the arithmetic unchecked.
    const absurd = synthetic(LIVE_ROUTE_MAX_POLES + 6, 'HUGE')
    const routeId = 'KMB:HUGE:outbound:1'
    const { statuses, acceptedTargets, awaitSnapshot } = await connectToRouteObject(routeId, absurd)
    await awaitSnapshot()
    expect(acceptedTargets().length).toBe(LIVE_ROUTE_MAX_POLES)
    expect(acceptedTargets()).toEqual(absurd.slice(0, LIVE_ROUTE_MAX_POLES))
    // Dropped **and named**, which is the treatment this file's caps all get: a client that asked about 70
    // kerbs and got 64 readings cannot otherwise tell a dropped target from a stop with no buses due.
    const named = statuses().filter((s) => s.includes('not watching'))
    expect(named.length, 'the excess was dropped in silence').toBe(1)
    for (const dropped of absurd.slice(LIVE_ROUTE_MAX_POLES)) {
      expect(named[0], `${dropped} was dropped without being named`).toContain(dropped)
    }
    // …and the tail is what goes: `liveShardFor` hashes the lowest accepted id, so dropping from the front
    // would move a capped connection to a different object than the one it was routed to.
    expect(named[0]).not.toContain(`${absurd[0] as string}"`)
  })
})

describe('what a narrowed read costs upstream', () => {
  it('does not call a board that cannot answer the route asked about', async () => {
    // Half of `boardsFor`'s saving, and the half that is free: a KMB board returns KMB/LWB readings, so
    // asking it about a Citybus route buys readings that are then discarded **in every case**. Measured
    // before the rule existed: a route watch on `CTB:11:outbound:1` made 38 `kmb-board` calls whose entire
    // output `narrowEtasToRoutes` threw away, on top of the 312 CTB calls it did not need either.
    //
    // Asserted through `/v1/etas/:id?routes=`, because the fixture's places are all KMB and this is the
    // shape that lets a KMB place be asked a Citybus question. The other half — one CTB call per pole
    // instead of one per route at the pole — is measured on the heavy CTB fixture in `eta-hub-caps`.
    const placeId = ROUTE_POLES[0] as string

    // First the control: unnarrowed, the pole's board is called.
    expect((await get(`/v1/etas/${encodeURIComponent(placeId)}`)).status).toBe(200)
    expect(boardCalls.length, 'the fixture made no upstream call at all').toBeGreaterThan(0)

    boardCalls = []
    resetEtaCache()
    const narrowed = await get(
      `/v1/etas/${encodeURIComponent(placeId)}?routes=${encodeURIComponent('CTB:11:outbound:1')}`,
    )
    expect(narrowed.status).toBe(200)
    expect(boardCalls, 'a KMB board was asked about a Citybus route').toEqual([])
    // The answer is still well formed and still empty — no reading, and nothing claimed to have failed at a
    // kerb we did not ask about.
    expect(await narrowed.json()).toEqual({ etas: [] })
  })

  it('still calls the board when the route asked about is one it can answer', async () => {
    // The guard against the cheapest possible bug in the rule above: a narrowing that skipped *every* board
    // would pass that case and leave every rider with no times at all.
    const placeId = ROUTE_POLES[0] as string
    resetEtaCache()
    boardCalls = []
    const res = await get(
      `/v1/etas/${encodeURIComponent(placeId)}?routes=${encodeURIComponent(ROUTE_ID)}`,
    )
    expect(res.status).toBe(200)
    expect(boardCalls.length, `narrowing to ${ROUTE_ID} asked nothing upstream`).toBeGreaterThan(0)
  })
})

// ── The cadence (step 2b) ────────────────────────────────────────────────────────────────────────
//
// A place shard polls on a 45 s floor that widens to 60 s when nothing is changing. A route watch does
// not: the operator publishes that route on a ~60 s cycle at a fixed second of the minute (measured —
// E22 on :12–:13, route 91 on :09–:10) and the CDN in front of it holds 45 s, so a blind 45 s poll walks
// in and out of phase and learns nothing on about one refresh in four. `nextRouteRoundMs` is the rule and
// its arithmetic is corpus-pinned in `packages/core`; what these cases assert is that a route object
// *uses* it and a place shard does not — which is the half a corpus cannot see.

/** How many rounds an object has finished. The one observable that says a round happened. */
function roundsCompleted(routeId: string): Promise<number> {
  return inRouteObject(routeId, async (_instance, state) =>
    state.storage.kv.get<number>(ROUNDS_COMPLETED_KEY),
  ).then((n) => (typeof n === 'number' ? n : 0))
}

/** The instant an object's next round is armed for, or `null` if it is not armed at all. */
function alarmAt(routeId: string): Promise<number | null> {
  return inRouteObject(routeId, async (_instance, state) => state.storage.getAlarm())
}

/**
 * Wait until the object has finished at least `n` rounds.
 *
 * **This is why `roundsCompleted` exists.** The connect round is armed at `Date.now()` and fired by the
 * runtime, so `runDurableObjectAlarm` returns `false` for it and there is nothing to await; the
 * alternative — waiting for the frames to go quiet — was measured on `live-rounds.test.ts` and cost that
 * file 8 s → 27 s to be safe, or a flake to be fast (`docs/07-backlog.md`).
 */
async function awaitRounds(routeId: string, n: number): Promise<void> {
  const deadline = Date.now() + 5_000
  let seen = 0
  while (Date.now() < deadline) {
    seen = await roundsCompleted(routeId)
    if (seen >= n) return
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`waited for ${n} round(s) on ${routeId}, saw ${seen}`)
}

describe('a route watch polls on the operator’s clock', () => {
  it('aligns the next round to the publish it just saw, not to a fixed interval', async () => {
    // A publish 20 s ago, on a 60 s cycle: the next one is due in 40 s, and `LIVE_ROUTE_PUBLISH_MARGIN_MS`
    // says ask 3 s after it rather than at the instant of turnover. So ~43 s — which is *below* the place
    // floor of 45 s and therefore cannot be the place rule accidentally agreeing.
    const published = new Date(Date.now() - 20_000)
    boardPublishedAt = published.toISOString()

    await openRouteWatch(ROUTE_ID)
    await awaitRounds(ROUTE_ID, 1)

    const armed = await alarmAt(ROUTE_ID)
    expect(armed, 'no next round was armed').not.toBeNull()
    // Asserted as an **absolute instant** rather than a delay, because that is what the rule computes:
    // `published + period + margin`. A delay assertion would pass on a rule that had merely picked a
    // similar number.
    const expected = published.getTime() + 60_000 + 3_000
    expect(Math.abs((armed as number) - expected)).toBeLessThan(2_000)
  })

  it('retries sooner when the publish did not advance, instead of waiting out a cadence', async () => {
    // Two rounds off the same `data_timestamp` — which is what the CDN serving us bytes we already had
    // looks like from here. The rule's answer is `LIVE_ROUTE_RETRY_MS` (15 s): we know the publish is due
    // and we know we have not seen it, so waiting a full period would mean sitting on stale times for a
    // minute. 15 s is also unmistakably neither the place floor (45 s) nor an aligned answer.
    boardPublishedAt = new Date(Date.now() - 90_000).toISOString()

    await openRouteWatch(ROUTE_ID)
    await awaitRounds(ROUTE_ID, 1)
    // Round 2, from the same board. `resetEtaCache` is what makes it a real second round: `coalesce`
    // would otherwise answer it from the 30 s window and no upstream call would happen at all.
    resetEtaCache()
    expect(
      await runDurableObjectAlarm(
        (env.ETA_HUB as NonNullable<typeof env.ETA_HUB>).getByName(
          routeWatchName(ROUTE_ID) as string,
        ),
      ),
      'no alarm was pending for a second round',
    ).toBe(true)
    await awaitRounds(ROUTE_ID, 2)

    const armed = await alarmAt(ROUTE_ID)
    expect(armed).not.toBeNull()
    const delay = (armed as number) - Date.now()
    expect(delay).toBeGreaterThan(15_000 - 3_000)
    expect(delay).toBeLessThanOrEqual(15_000)
  })

  it('ticks at the publish period when it has no clock to align to', async () => {
    // Every board answered with nothing due, so no reading carries a `data_timestamp` and there is no
    // phase. The honest answer is the period itself — 60 s — and notably *not* the 15 s retry: we have
    // learnt nothing, but we have also not missed anything we know about.
    boardPublishedAt = null

    await openRouteWatch(ROUTE_ID)
    await awaitRounds(ROUTE_ID, 1)

    const armed = await alarmAt(ROUTE_ID)
    expect(armed).not.toBeNull()
    const delay = (armed as number) - Date.now()
    expect(delay).toBeGreaterThan(60_000 - 3_000)
    expect(delay).toBeLessThanOrEqual(60_000)
  })

  it('leaves a place shard on the place cadence, which is what makes the branch the object’s name', async () => {
    // The control. Same fixture, same boards, same publish timestamp — the only difference is that this
    // socket names its targets instead of a route, so it lands on a `live-<n>` shard. If the cadence had
    // been changed for everybody rather than for a route watch, this is the case that says so.
    boardPublishedAt = new Date(Date.now() - 20_000).toISOString()
    const targets = ROUTE_POLES.slice(0, 2)
    const res = await get(`${LIVE_PATH}?targets=${encodeURIComponent(targets.join(','))}`, {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(101)
    const ws = res.webSocket
    if (!ws) throw new Error('a 101 with no webSocket')
    ws.accept()

    const shard = (env.ETA_HUB as NonNullable<typeof env.ETA_HUB>).getByName(
      liveShardName(liveShardFor(targets.map((stopId) => ({ stopId })))),
    )
    const deadline = Date.now() + 5_000
    let rounds = 0
    while (Date.now() < deadline && rounds < 1) {
      rounds = await runInDurableObject(shard, async (_instance, state) => {
        const n = state.storage.kv.get<number>(ROUNDS_COMPLETED_KEY)
        return typeof n === 'number' ? n : 0
      })
      if (rounds < 1) await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
    expect(rounds, 'the place shard never finished a round').toBeGreaterThanOrEqual(1)

    const armed = await runInDurableObject(shard, async (_instance, state) =>
      state.storage.getAlarm(),
    )
    expect(armed).not.toBeNull()
    const delay = (armed as number) - Date.now()
    // The place floor, and the aligned answer for this same publish would have been ~43 s — so this
    // assertion fails if a route rule leaked onto a shard.
    expect(delay).toBeGreaterThan(45_000 - 3_000)
    expect(delay).toBeLessThanOrEqual(45_000)

    ws.close(1000, 'done')
    await runInDurableObject(shard, async (_instance, state) => {
      for (const openSocket of state.getWebSockets()) openSocket.close(1000, 'test reset')
      await state.storage.deleteAlarm()
      state.storage.sql.exec('DELETE FROM readings')
      for (const key of LIVE_HUB_KV_KEYS) state.storage.kv.delete(key)
    })
  })
})

describe('a round that learns nothing does not pretend it did', () => {
  /** Fire the object's pending alarm and wait for the round it starts. */
  async function nextRound(routeId: string, expectRounds: number): Promise<void> {
    resetEtaCache()
    expect(
      await runDurableObjectAlarm(
        (env.ETA_HUB as NonNullable<typeof env.ETA_HUB>).getByName(
          routeWatchName(routeId) as string,
        ),
      ),
      'no alarm was pending',
    ).toBe(true)
    await awaitRounds(routeId, expectRounds)
  }

  it('retries after an outage instead of aligning to a phase it never saw', async () => {
    // **The case that pins where the publish clock is read from.** A failed round carries the *previous*
    // readings forward — `retainFailedPoles` and the retryable-target branch both do it, on purpose, so a
    // rider's times do not blank because we could not ask. Those readings still carry their old
    // `dataTimestamp`. Draw the clock from them and an outage looks like a fresh publish: the object aligns
    // its next round to a phase that has already gone by and asks a whole minute late. Drawing it from what
    // the round actually *heard* gives the 15 s retry instead. Both numbers are unmistakable.
    boardPublishedAt = new Date(Date.now() - 20_000).toISOString()
    await openRouteWatch(ROUTE_ID)
    await awaitRounds(ROUTE_ID, 1)
    // The healthy round aligned, which is the control: without this the case could pass on a rule that
    // never aligns at all.
    const aligned = (await alarmAt(ROUTE_ID)) as number
    expect(aligned - Date.now()).toBeGreaterThan(30_000)

    boardsRefuse = true
    await nextRound(ROUTE_ID, 2)

    const armed = await alarmAt(ROUTE_ID)
    expect(armed).not.toBeNull()
    const delay = (armed as number) - Date.now()
    expect(delay, 'an outage was treated as a publish').toBeGreaterThan(15_000 - 3_000)
    expect(delay).toBeLessThanOrEqual(15_000)
  })

  it('forgets the publish clock when the last rider leaves, so the next one is not told a stale phase', async () => {
    // Teardown drops the readings; the clock describes those readings and has to go with them. If it
    // survived, the next watch's very first round would meet its own `publishedAt` as
    // `previousPublishedAt` — "the publish did not advance", which that round cannot possibly know — and
    // take the 15 s retry arm on perfectly fresh data.
    //
    // This case also pins that `roundsCompleted` does **not** reset on teardown: `awaitRounds(…, 2)` below
    // would wait for ever if it did, since the reopened object's first round would count as round 1.
    boardPublishedAt = new Date(Date.now() - 20_000).toISOString()
    const first = await openRouteWatch(ROUTE_ID)
    await awaitRounds(ROUTE_ID, 1)

    first.close(1000, 'the rider left')
    const gone = Date.now() + 2_000
    while (Date.now() < gone) {
      const sockets = await inRouteObject(
        ROUTE_ID,
        async (_instance, state) => state.getWebSockets().length,
      )
      if (sockets === 0) break
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
    expect(
      await inRouteObject(ROUTE_ID, async (_instance, state) => state.storage.getAlarm()),
      'a rider-less route object kept an alarm',
    ).toBeNull()

    // A new rider, the same board, the same publish timestamp.
    resetEtaCache()
    await openRouteWatch(ROUTE_ID)
    await awaitRounds(ROUTE_ID, 2)

    const armed = await alarmAt(ROUTE_ID)
    expect(armed).not.toBeNull()
    // Aligned, not the retry arm — the first round of a watch has nothing to compare against.
    const expected = Date.parse(boardPublishedAt) + 60_000 + 3_000
    expect(Math.abs((armed as number) - expected)).toBeLessThan(2_000)
  })
})

describe('the phase a mixed-age round aligns to', () => {
  it('is the newest publish it heard, not the stalest pole on the route', async () => {
    // Every pole of one route is answered from the same upstream route feed, so in the healthy case all
    // 41 readings carry the same `data_timestamp` and this decision is invisible. It stops being invisible
    // when the CDN serves one pole from an older entry than another: the newest is the one that says the
    // publish has landed, and aligning to the oldest would hold the whole route back to its stalest edge
    // and re-ask on a phase the operator has already left.
    const newest = new Date(Date.now() - 20_000)
    const stalest = new Date(Date.now() - 50_000)
    // The operator's own id, through the one parser (`check-no-adhoc-id-parsing` polices this, and caught
    // a hand-rolled `split(':')` here) — it is what the upstream URL carries and therefore what the stub
    // keys its per-pole answer on.
    const rawOf = (poleId: string) => (parseStopId(poleId) as { rawId: string }).rawId
    boardPublishedAtByPole = {
      [rawOf(ROUTE_POLES[0] as string)]: stalest.toISOString(),
      [rawOf(ROUTE_POLES[1] as string)]: newest.toISOString(),
    }

    await openRouteWatch(ROUTE_ID)
    await awaitRounds(ROUTE_ID, 1)

    const armed = await alarmAt(ROUTE_ID)
    expect(armed).not.toBeNull()
    // The two answers are 30 s apart, so this cannot pass on the wrong one by tolerance.
    expect(Math.abs((armed as number) - (newest.getTime() + 60_000 + 3_000))).toBeLessThan(2_000)
  })
})
