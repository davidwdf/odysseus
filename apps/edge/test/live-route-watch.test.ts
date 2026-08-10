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

import { env, runInDurableObject } from 'cloudflare:test'
import { LIVE_PATH } from '@nextbus/contract'
import { LIVE_ROUTE_NAME_PREFIX, routeWatchName } from '@nextbus/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetEtaCache } from '../src/eta-cache'
import { LIVE_MAX_TARGETS_PER_CONNECTION, LIVE_ROUTE_MAX_POLES } from '../src/eta-hub'
import worker from '../src/index'
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

/** Every board answers with nothing due — this file is about routing, caps and cost, not readings. */
function stubUpstream(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (DATASET.test(url)) return jsonResponse(datasetJson())
    if (KMB_STOP_ETA.test(url) || KMB_ROUTE_ETA.test(url)) {
      boardCalls.push(url)
      return jsonResponse({ generated_timestamp: new Date().toISOString(), data: [] })
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
        async (instance) =>
          (instance as unknown as { ctx: DurableObjectState }).ctx.getWebSockets().length,
      )
      if (remaining === 0) break
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
    expect(remaining, `${routeId} still holds sockets, which would leak into the next case`).toBe(0)
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
    const watched = await inRouteObject(ROUTE_ID, async (instance) => {
      const seen = new Set<string>()
      for (const ws of (instance as unknown as { ctx: DurableObjectState }).ctx.getWebSockets()) {
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
    const narrowings = await inRouteObject(ROUTE_ID, async (instance) => {
      const out: (string[] | undefined)[] = []
      for (const ws of (instance as unknown as { ctx: DurableObjectState }).ctx.getWebSockets()) {
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
      async (instance) =>
        (instance as unknown as { ctx: DurableObjectState }).ctx.getWebSockets().length,
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
function inRouteObject<T>(routeId: string, read: (instance: unknown) => Promise<T>): Promise<T> {
  const stub = (env.ETA_HUB as NonNullable<typeof env.ETA_HUB>).getByName(
    routeWatchName(routeId) as string,
  )
  return runInDurableObject(stub, read as never) as Promise<T>
}

async function connectToRouteObject(
  routeId: string,
  targets: readonly string[],
): Promise<{ ws: WebSocket; statuses: () => string[] }> {
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
  return { ws, statuses: () => messages.filter((m) => m.includes('"status"')) }
}

/** How many targets the object is actually watching, summed over its sockets. */
function keptTargets(routeId: string): Promise<number> {
  return inRouteObject(routeId, async (instance) => {
    let n = 0
    for (const ws of (instance as unknown as { ctx: DurableObjectState }).ctx.getWebSockets()) {
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
    const { statuses } = await connectToRouteObject('KMB:LONG:outbound:1', long)
    expect(await keptTargets('KMB:LONG:outbound:1')).toBe(long.length)
    expect(statuses().filter((s) => s.includes('not watching'))).toEqual([])
  })

  it('drops the excess past its own cap, and names what it dropped', async () => {
    // The cap has to bite somewhere, and a rider is owed the truth about where. A pathological dataset row
    // is the only way to reach it — no HK bus route calls at 65 poles — but "no route is that long" is an
    // argument for the number, not for leaving the arithmetic unchecked.
    const absurd = synthetic(LIVE_ROUTE_MAX_POLES + 6, 'HUGE')
    const routeId = 'KMB:HUGE:outbound:1'
    const { statuses } = await connectToRouteObject(routeId, absurd)
    expect(await keptTargets(routeId)).toBe(LIVE_ROUTE_MAX_POLES)
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
