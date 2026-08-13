// **The poll emulator's behaviour, which used to be the default and is now what `poll` selects.**
//
// `watch()` was rewritten over a frame protocol and a pluggable transport, and the whole point of the
// rewrite was that a screen cannot tell: the requests, their URLs and their cadence had to be exactly what
// the old `setInterval` shim issued. This file establishes that, and it still does — but it now names
// `createPollTransport` explicitly, because **ADR-121 made the socket the default**. That is a real loss of
// coverage, stated rather than glossed: these cases used to exercise the path an unconfigured client takes,
// and they now exercise a path somebody has to ask for. What replaces it is the assertion in
// `live-select.test.ts` that the default *is* the socket, plus the socket's own suite.
//
// It stays worth having. `poll` is what an environment with no WebSocket path gets — a corporate proxy that
// strips upgrades, a runtime without `WebSocket` — and it is the engine the shared corpus compares the
// socket against (ADR-074), so an engine nobody could observe would be an engine nobody could trust.
//
// Two behaviours deliberately differ, and both are asserted here.
//
//  · A round in which nothing changed no longer calls the listener. The shim called it every cadence with
//    a fresh copy of identical data, which is the repaint ADR-008's "update the value only when fresh data
//    arrives" rules out.
//  · **A round is one request, not one per target** (WP5-7). The shim — and this engine until WP5-7 —
//    issued `/v1/etas/:id` per target, so a screen watching six places issued six requests per window
//    where the screen itself issued one. That was the regression that kept Nearby off this engine, so the
//    request *count* is now a pinned property rather than a consequence.

import { CLIENT_POLICY_DEFAULTS, type Eta } from '@nextbus/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPollTransport, EdgeClient } from '../src'

const STOP_A = 'KMB:A'
const STOP_B = 'KMB:B'
const ROUTE_1 = 'KMB:1:outbound:1'

function eta(stopId: string, hhmm: string): Eta {
  return {
    routeId: ROUTE_1,
    stopId,
    operator: 'KMB',
    arrivals: [`2026-07-30T${hhmm}:00+08:00`],
    dataTimestamp: '2026-07-30T09:59:00+08:00',
    observedAt: '2026-07-30T01:59:00.000Z',
  }
}

/** The ids a `/v1/etas?ids=a&ids=b` URL asked about, decoded — the repeated parameter, read back. */
function idsOf(url: string): string[] {
  return new URL(url).searchParams.getAll('ids')
}

/**
 * A `fetch` that records what was asked for and answers from a per-stop table.
 *
 * The body is an `EtaBatch` — one entry per requested id, each an `EtaReport` (`{ etas }` with `failed`
 * **absent**, which is what the endpoint serves when every board answered, ADR-073) plus the id it
 * answers for. Spelled out here rather than hidden in a helper because this file's whole subject is the
 * *default* engine talking to the real endpoint shape: a stub that answered a bare array, or that
 * omitted `id`, would keep passing against a client that had stopped reading the field.
 */
function stubFetch(answers: Map<string, Eta[]>) {
  const urls: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)
    const reports = idsOf(url).map((id) => ({ id, etas: answers.get(id) ?? [] }))
    return new Response(JSON.stringify({ reports }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { urls, fetchImpl }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('EdgeClient.watch() on the poll emulator', () => {
  it('issues ONE /v1/etas request for the whole round and hands the listener a flat list', async () => {
    const answers = new Map([
      [STOP_A, [eta(STOP_A, '10:02')]],
      [STOP_B, [eta(STOP_B, '10:09')]],
    ])
    const { urls, fetchImpl } = stubFetch(answers)
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const seen: Eta[][] = []
    const sub = client.watch([{ stopId: STOP_A }, { stopId: STOP_B }], (etas) => seen.push(etas))
    await vi.advanceTimersByTimeAsync(0)

    // The repeated parameter, percent-encoded per id — `,` is a legal `idchar`, so a delimited list
    // could not be parsed back (see the `ids` parameter in `@nextbus/contract`). And it is the ETA
    // endpoint rather than the whole `/v1/stop/:id` the screen's `useQuery` fetches: the payload gets
    // *smaller* on the live path, not larger.
    expect(urls).toEqual(['http://localhost:8787/v1/etas?ids=KMB%3AA&ids=KMB%3AB'])
    expect(seen.length).toBe(1)
    expect(seen[0]?.map((e) => e.stopId)).toEqual([STOP_A, STOP_B])
    sub.unsubscribe()
  })

  it('makes ONE request per window for a six-place screen, which is what Nearby needed', async () => {
    // **The acceptance criterion of WP5-7, as an assertion.** Six is `MAX_STOPS` in
    // `apps/edge/src/nearby.ts` — the number of cards Nearby renders — and the per-target fan-out this
    // replaced would make this number 6 and then 12. The screen fetches `/v1/nearby` once per window, so
    // anything above 1 here is a request-count regression a rider pays for a feature they cannot see.
    const ids = ['KMB:1', 'KMB:2', 'KMB:3', 'CTB:4', 'GMB:5', 'P:KMB:6+CTB:7']
    const { urls, fetchImpl } = stubFetch(new Map(ids.map((id) => [id, [eta(id, '10:02')]])))
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const sub = client.watch(
      ids.map((stopId) => ({ stopId })),
      () => {},
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(urls.length).toBe(1)
    // Every id in one request, and the `+` of the place id escaped — unescaped it would arrive as a
    // space, which is not an `idchar`, and the entry would come back `bad_request`.
    expect(idsOf(urls[0] as string).sort()).toEqual([...ids].sort())
    expect(urls[0]).toContain(encodeURIComponent('P:KMB:6+CTB:7'))

    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs)
    expect(urls.length).toBe(2)
    sub.unsubscribe()
  })

  it('narrows to routes when the target does — after the batch answers, not in the request', async () => {
    // The batch carries no per-id `routes=`: there is no delimiter safe under the id grammar for a
    // nested list. So it answers every route and `narrowEtasToRoutes` — the kernel rule the edge applies
    // to `/v1/etas/:id?routes=` — runs one hop later. The observable property is the listener's list,
    // which is what the socket engine (narrowing server-side) produces too.
    const ROUTE_6 = 'KMB:6:outbound:1'
    const { urls, fetchImpl } = stubFetch(
      new Map([[STOP_A, [eta(STOP_A, '10:02'), { ...eta(STOP_A, '10:09'), routeId: ROUTE_6 }]]]),
    )
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const seen: Eta[][] = []
    const sub = client.watch([{ stopId: STOP_A, routeIds: [ROUTE_1] }], (etas) => seen.push(etas))
    await vi.advanceTimersByTimeAsync(0)
    expect(urls).toEqual(['http://localhost:8787/v1/etas?ids=KMB%3AA'])
    expect(seen.at(-1)?.map((e) => e.routeId)).toEqual([ROUTE_1])
    sub.unsubscribe()
  })

  it('polls on the served cadence, and on nothing faster', async () => {
    const answers = new Map([[STOP_A, [eta(STOP_A, '10:02')]]])
    const { urls, fetchImpl } = stubFetch(answers)
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const sub = client.watch([{ stopId: STOP_A }], () => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(urls.length).toBe(1)

    // ADR-053: the cadence is the served policy's, which is also the edge's own ETA cache TTL. The shim's
    // hard-coded interval was the fourth of the four values that disagreed.
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs - 1)
    expect(urls.length).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(urls.length).toBe(2)
    sub.unsubscribe()
  })

  it('runs on the cadence the CALLER was served, not on the one compiled in', async () => {
    // The regression this pins, found by review after WP5-0 shipped: `EdgeClient` is constructed at module
    // scope (`apps/mobile/lib/datasource.ts`), so its `pollMs` is `CLIENT_POLICY_DEFAULTS` — the
    // compiled-in number — and nothing later told it what the edge actually served. The three screens
    // still using `refetchInterval` read the served value through `useClientPolicy`, so an edge that moved
    // the cadence moved it for them and **not** for the seam meant to replace them. That is ADR-053's own
    // defect (a threshold the edge can move, in force nowhere) rebuilt one layer down — and the screen
    // carried a comment claiming the opposite.
    //
    // The case above pins the *default* path and remains right; this pins the served path, which nothing
    // asserted. Deliberately a value nothing in the repo uses, so it cannot pass by coincidence.
    const served = 7_000
    expect(served).not.toBe(CLIENT_POLICY_DEFAULTS.refreshAfterMs)

    const answers = new Map([[STOP_A, [eta(STOP_A, '10:02')]]])
    const { urls, fetchImpl } = stubFetch(answers)
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const sub = client.watch([{ stopId: STOP_A }], () => {}, { refreshAfterMs: served })
    await vi.advanceTimersByTimeAsync(0)
    expect(urls.length).toBe(1)

    await vi.advanceTimersByTimeAsync(served - 1)
    expect(urls.length).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(urls.length).toBe(2)
    sub.unsubscribe()
  })

  it('falls back to the construction-time cadence when the caller states none', async () => {
    // `WatchOptions`' absence must mean "I do not know the policy" — not "never poll" and not "poll at
    // once". A cold start genuinely has no served policy, so a caller omitting it is the ordinary case.
    const answers = new Map([[STOP_A, [eta(STOP_A, '10:02')]]])
    const { urls, fetchImpl } = stubFetch(answers)
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      pollMs: 5_000,
      transport: createPollTransport,
    })
    const sub = client.watch([{ stopId: STOP_A }], () => {}, {})
    await vi.advanceTimersByTimeAsync(0)
    expect(urls.length).toBe(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(urls.length).toBe(2)
    sub.unsubscribe()
  })

  it('calls the listener only when the reading changed', async () => {
    const answers = new Map([[STOP_A, [eta(STOP_A, '10:02')]]])
    const { fetchImpl } = stubFetch(answers)
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const seen: Eta[][] = []
    const sub = client.watch([{ stopId: STOP_A }], (etas) => seen.push(etas))
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.length).toBe(1)

    // Same data, one cadence later: no call. The shim called the listener here with an identical list,
    // and every consumer would have repainted.
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs)
    expect(seen.length).toBe(1)

    answers.set(STOP_A, [eta(STOP_A, '10:05')])
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs)
    expect(seen.length).toBe(2)
    expect(seen[1]?.[0]?.arrivals).toEqual(['2026-07-30T10:05:00+08:00'])
    sub.unsubscribe()
  })

  it('keeps the other targets alive when one fails, exactly as the shim did', async () => {
    // **A target-level failure is an entry, and the request is a 200** (WP5-7). It used to be a 504 on
    // that target's own request; now the batch answers about both ids and names the failure on one of
    // them, because failing the whole request would throw away the readings of the id that answered —
    // the same judgement ADR-073 made one level down for a place whose second kerb refused.
    const urls: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input)
      urls.push(url)
      const reports = idsOf(url).map((id) =>
        id === STOP_B
          ? {
              id,
              etas: [],
              error: { code: 'upstream_timeout', message: 'slow', retryable: true },
            }
          : { id, etas: [eta(STOP_A, '10:02')] },
      )
      return new Response(JSON.stringify({ reports }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const seen: Eta[][] = []
    const sub = client.watch([{ stopId: STOP_A }, { stopId: STOP_B }], (etas) => seen.push(etas))
    await vi.advanceTimersByTimeAsync(0)
    // A stale tile is better than a dead screen: the good target's readings arrive, and the failing one is
    // asked again next round rather than dropped — `retryable: true` says the same request may work later.
    expect(seen.at(-1)?.map((e) => e.stopId)).toEqual([STOP_A])
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs)
    expect(urls.filter((u) => idsOf(u).includes(STOP_B)).length).toBe(2)
    sub.unsubscribe()
  })

  it('a whole-request failure is one status per target, and no reading departs', async () => {
    // The one failure shape only this engine can have — the phone is offline, or the Worker 502s — and
    // the shard cannot produce it at all, because it calls the read path per target inside the object.
    // So it is fanned back out to one failure per target of the request: collapsing it to one would make
    // the two engines emit a different number of `status` frames for identical circumstances, which is
    // the byte-identity WP5-1 exists to assert.
    let offline = false
    const urls: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input)
      urls.push(url)
      if (offline) throw new TypeError('Network request failed')
      const reports = idsOf(url).map((id) => ({ id, etas: [eta(id, '10:02')] }))
      return new Response(JSON.stringify({ reports }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const seen: Eta[][] = []
    const sub = client.watch([{ stopId: STOP_A }, { stopId: STOP_B }], (etas) => seen.push(etas))
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.at(-1)?.map((e) => e.stopId)).toEqual([STOP_A, STOP_B])

    offline = true
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs)
    // **Nothing departed.** A failed round is not a departure (ADR-073), so the listener is not called
    // again at all — the readings it holds are still the truth we have, ageing by the operator's clock.
    expect(seen.length).toBe(1)
    // And the round is retried rather than the targets dropped: the failure is retryable.
    offline = false
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs)
    expect(idsOf(urls.at(-1) as string)).toEqual([STOP_A, STOP_B])
    sub.unsubscribe()
  })

  it('stops fetching on unsubscribe', async () => {
    const { urls, fetchImpl } = stubFetch(new Map([[STOP_A, [eta(STOP_A, '10:02')]]]))
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const sub = client.watch([{ stopId: STOP_A }], () => {})
    await vi.advanceTimersByTimeAsync(0)
    sub.unsubscribe()
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs * 3)
    expect(urls.length).toBe(1)
  })
})

// ── watchRoute() on the poll emulator ────────────────────────────────────────────────────────────
//
// The socket half is asserted in `live-socket.test.ts` (the URL, the absent frame, the resync). This is the
// emulated half: it has no route endpoint to emulate, so it must resolve the route's poles itself and then
// be an ordinary `watch()` — the one thing the socket path never does.
//
// **It is no longer what ships** (ADR-121 made the socket the default), and the measurement that moved it is
// worth carrying here too, because these cases look cheap and are not: one round of Citybus 182's 31 poles
// through this path is ~395 upstream calls and 75.7 s, against 31 calls and 1.2 s over the socket. What this
// path is *for* is an environment that cannot open a WebSocket at all.

/** A `fetch` that answers `/v1/route/:id` from a stop list, and `/v1/etas` from a per-stop table. */
function stubRouteAndEtas(routeId: string, poles: string[], answers: Map<string, Eta[]>) {
  const urls: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)
    if (url.includes('/v1/route/')) {
      return new Response(
        JSON.stringify({
          route: {
            id: routeId,
            operator: 'CTB',
            routeNo: '91',
            bound: 'outbound',
            serviceType: '1',
          },
          stops: poles.map((id, seq) => ({ seq, stop: { id }, eta: null })),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    // The route batch (ADR-136). Deliberately NOT narrowed here, unlike the real server: the client
    // applies `narrowEtasToRoutes` per target as well, and the narrowing test below asserts that layer
    // holds even against a producer that narrows nothing.
    if (url.includes('/v1/etas?route=')) {
      const reports = poles.map((id) => ({ id, etas: answers.get(id) ?? [] }))
      return new Response(JSON.stringify({ reports }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const reports = idsOf(url).map((id) => ({ id, etas: answers.get(id) ?? [] }))
    return new Response(JSON.stringify({ reports }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { urls, fetchImpl }
}

describe('EdgeClient.watchRoute() on the poll emulator', () => {
  const ROUTE = 'CTB:91:outbound:1'
  const POLES = ['CTB:001', 'CTB:002', 'CTB:003']

  it('resolves the route’s poles once, then watches them narrowed to that route', async () => {
    const answers = new Map(POLES.map((id) => [id, [{ ...eta(id, '10:02'), routeId: ROUTE }]]))
    const { urls, fetchImpl } = stubRouteAndEtas(ROUTE, POLES, answers)
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const seen: Eta[][] = []
    const sub = client.watchRoute(ROUTE, (etas) => seen.push(etas))
    await vi.advanceTimersByTimeAsync(0)

    // The route document first — the targets and their narrowing come from it — and then one
    // `?route=` batch for the whole route, whose fan-out the SERVER narrows (ADR-136).
    expect(urls[0]).toBe(`http://localhost:8787/v1/route/${encodeURIComponent(ROUTE)}`)
    expect(urls.length).toBe(2)
    expect(urls[1]).toBe(`http://localhost:8787/v1/etas?route=${encodeURIComponent(ROUTE)}`)
    expect(seen[0]?.map((e) => e.stopId)).toEqual(POLES)

    // …and **once**: the poles are resolved at subscribe time, not per round. A route document re-read
    // every 30 s would be a bigger payload than the readings it exists to address.
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs)
    expect(urls.filter((u) => u.includes('/v1/route/')).length).toBe(1)
    expect(urls.length).toBe(3)
    sub.unsubscribe()
  })

  it('narrows every target to the route, so a shared pole cannot bring another line’s times', async () => {
    // A Citybus pole serves a dozen routes. Without `routeIds` per target the batch would answer with all
    // of them and the screen would attach another line's bus to this route's row — which is the exact
    // failure `narrowEtasToRoutes` exists for, one level down.
    const other = 'CTB:5B:outbound:1'
    const answers = new Map(
      POLES.map((id) => [
        id,
        [
          { ...eta(id, '10:02'), routeId: ROUTE },
          { ...eta(id, '10:04'), routeId: other },
        ],
      ]),
    )
    const { fetchImpl } = stubRouteAndEtas(ROUTE, POLES, answers)
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const seen: Eta[][] = []
    const sub = client.watchRoute(ROUTE, (etas) => seen.push(etas))
    await vi.advanceTimersByTimeAsync(0)

    expect(seen[0]?.length).toBe(POLES.length)
    expect(new Set(seen[0]?.map((e) => e.routeId))).toEqual(new Set([ROUTE]))
    sub.unsubscribe()
  })

  it('asks nothing at all when unsubscribed before the route resolves', async () => {
    // A screen that navigates away during the resolve must not start a round afterwards. The subscription
    // returns synchronously while the resolution is still in flight, so this is the ordinary case on a slow
    // connection rather than a corner one.
    const { urls, fetchImpl } = stubRouteAndEtas(ROUTE, POLES, new Map())
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const sub = client.watchRoute(ROUTE, () => {})
    sub.unsubscribe()
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs * 2)
    expect(urls.filter((u) => u.includes('/v1/etas'))).toEqual([])
  })

  it('survives a route document that will not load', async () => {
    // The screen renders from the same document, so an unreachable one means there is no schematic to put
    // times on and it is already retrying. What must not happen is an unhandled rejection from a
    // subscription nobody awaited.
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).includes('/v1/route/')) return new Response('nope', { status: 502 })
      return new Response(JSON.stringify({ reports: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const client = new EdgeClient({
      baseUrl: 'http://localhost:8787',
      fetchImpl,
      transport: createPollTransport,
    })
    const seen: Eta[][] = []
    const sub = client.watchRoute(ROUTE, (etas) => seen.push(etas))
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs)
    expect(seen).toEqual([])
    sub.unsubscribe()
  })
})
