// The supervised socket→poll fallback (WP6-8b), at the seam it lives on: `EdgeClient.watch()` and
// `watchRoute()`.
//
// The socket became the default engine in ADR-121, and its characteristic failure is invisible by
// platform design — a browser exposes neither the status nor the body of a refused WebSocket upgrade —
// so a proxy that strips the protocol, a captive portal, and a deployment without the `ETA_HUB`
// binding all look identical: `retrying` for ever at the backoff cap, over a screen frozen on its
// first HTTP fetch. The supervisor rebuilds the *subscription* on the poll engine after
// `SOCKET_FALLBACK_AFTER_FAILURES` fruitless connections; it never swaps an engine that has ever
// delivered a frame, because that socket has proved the path works and its failures belong to the
// reconnect schedule. ADR-056's "no fallback" stance is amended, not ignored: no *transport* quietly
// becomes another transport — the swap is whole-subscription, with a stated trigger, right here where
// it can be watched.

import type { Eta, EtaFailure, RouteDetail, ServerFrame } from '@nextbus/core'
import { describe, expect, it } from 'vitest'
import { createEdgeClient, type LiveEtaEngine, SOCKET_FALLBACK_AFTER_FAILURES } from '../src'

const STOP = 'KMB:A'
const ROUTE = 'KMB:1:outbound:1'

const readingAt = (stopId: string, arrival: string): Eta => ({
  routeId: ROUTE,
  stopId,
  operator: 'KMB',
  arrivals: [arrival],
  dataTimestamp: '2026-08-12T19:59:00+08:00',
  observedAt: '2026-08-12T11:59:00.000Z',
})

/** A socket engine whose network the test plays: it records subscriptions and emits what it is told. */
function fakeSocketEngine() {
  let sink: ((frame: ServerFrame) => void) | null = null
  let closed = false
  const engine: LiveEtaEngine = {
    engine: 'socket',
    open(nextSink) {
      sink = nextSink.frame.bind(nextSink)
    },
    send() {},
    close() {
      closed = true
    },
  }
  const retrying = (): ServerFrame => ({
    type: 'status',
    at: '2026-08-12T12:00:00.000Z',
    state: 'retrying',
    error: { code: 'internal', message: 'socket error', retryable: true },
  })
  return {
    engine,
    emitRetrying: () => sink?.(retrying()),
    emitSnapshot: () =>
      sink?.({
        type: 'snapshot',
        seq: 1,
        at: '2026-08-12T12:00:00.000Z',
        targets: [{ stopId: STOP }],
        etas: [readingAt(STOP, '2026-08-12T20:02:00+08:00')],
      }),
    wasClosed: () => closed,
  }
}

/** An edge whose `/v1/etas` and `/v1/route/:id` answer instantly, recording every path asked. */
function fakeEdge() {
  const paths: string[] = []
  const routeDetail: Pick<RouteDetail, 'route' | 'stops'> = {
    route: {
      id: ROUTE,
      operator: 'KMB',
      routeNo: '1',
      bound: 'outbound',
      serviceType: '1',
      origin: { en: 'O', 'zh-Hant': 'O', 'zh-Hans': 'O' },
      destination: { en: 'D', 'zh-Hant': 'D', 'zh-Hans': 'D' },
    },
    stops: [
      {
        seq: 1,
        stop: {
          id: STOP,
          name: { en: 'A', 'zh-Hant': 'A', 'zh-Hans': 'A' },
          location: { lat: 22.3, lng: 114.1 },
          sources: [{ operator: 'KMB', operatorStopId: 'RAW' }],
        },
        eta: null,
      },
    ],
  }
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    paths.push(url)
    if (url.includes('/v1/route/')) {
      return new Response(JSON.stringify(routeDetail), { status: 200 })
    }
    if (url.includes('/v1/etas?')) {
      return new Response(
        JSON.stringify({
          reports: [{ id: STOP, etas: [readingAt(STOP, '2026-08-12T20:04:00+08:00')] }],
        }),
        { status: 200 },
      )
    }
    return new Response('{"code":"not_found","message":"?","retryable":false,"error":"?"}', {
      status: 404,
    })
  }
  return { paths, fetchImpl }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('EdgeClient.watch, socket-first', () => {
  it('falls back to polling after the stated number of fruitless connections', async () => {
    const socket = fakeSocketEngine()
    const edge = fakeEdge()
    const client = createEdgeClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: edge.fetchImpl,
      transport: () => socket.engine,
    })
    const updates: Array<{ etas: Eta[]; failed: EtaFailure[] }> = []
    const sub = client.watch([{ stopId: STOP }], (etas, failed) =>
      updates.push({ etas, failed: failed ?? [] }),
    )

    for (let failure = 0; failure < SOCKET_FALLBACK_AFTER_FAILURES; failure++) {
      socket.emitRetrying()
    }
    await flush()

    // The socket subscription was released and the poll engine took over: one `/v1/etas?ids=…` round,
    // whose readings reached the same listener — a rider on a WebSocket-hostile network gets live
    // times slowly rather than never.
    expect(socket.wasClosed()).toBe(true)
    expect(edge.paths.filter((p) => p.includes('/v1/etas?'))).toHaveLength(1)
    expect(updates.at(-1)?.etas[0]?.arrivals[0]).toBe('2026-08-12T20:04:00+08:00')

    sub.unsubscribe()
  })

  it('never falls back once the socket has delivered a frame', async () => {
    const socket = fakeSocketEngine()
    const edge = fakeEdge()
    const client = createEdgeClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: edge.fetchImpl,
      transport: () => socket.engine,
    })
    const updates: Array<{ etas: Eta[] }> = []
    const sub = client.watch([{ stopId: STOP }], (etas) => updates.push({ etas }))

    socket.emitSnapshot()
    // Far past the trigger: a socket that has proved the path works belongs to the reconnect
    // schedule, and swapping it for the slow engine mid-journey would punish a transient outage.
    for (let failure = 0; failure < SOCKET_FALLBACK_AFTER_FAILURES * 3; failure++) {
      socket.emitRetrying()
    }
    await flush()

    expect(socket.wasClosed()).toBe(false)
    expect(edge.paths.filter((p) => p.includes('/v1/etas?'))).toHaveLength(0)
    expect(updates[0]?.etas[0]?.arrivals[0]).toBe('2026-08-12T20:02:00+08:00')

    sub.unsubscribe()
  })
})

describe('EdgeClient.watchRoute, socket-first', () => {
  it('falls back to the polled route path: resolve the poles once, then poll them narrowed', async () => {
    const socket = fakeSocketEngine()
    const edge = fakeEdge()
    const client = createEdgeClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: edge.fetchImpl,
      transport: () => socket.engine,
    })
    const updates: Array<{ etas: Eta[] }> = []
    const sub = client.watchRoute(ROUTE, (etas) => updates.push({ etas }))

    for (let failure = 0; failure < SOCKET_FALLBACK_AFTER_FAILURES; failure++) {
      socket.emitRetrying()
    }
    await flush()
    await flush() // the fallback fetches the route document first, then its first round

    expect(socket.wasClosed()).toBe(true)
    expect(edge.paths.some((p) => p.includes('/v1/route/'))).toBe(true)
    // The round is ONE `?route=` request, narrowed by the server (ADR-136) — never the chunked `ids`
    // fan-out ADR-121 measured at ~19× the upstream cost and 10–20 s a chunk.
    expect(edge.paths.filter((p) => p.includes('/v1/etas?route='))).toHaveLength(1)
    expect(edge.paths.filter((p) => p.includes('/v1/etas?ids='))).toHaveLength(0)
    expect(updates.at(-1)?.etas[0]?.arrivals[0]).toBe('2026-08-12T20:04:00+08:00')

    sub.unsubscribe()
  })
})
