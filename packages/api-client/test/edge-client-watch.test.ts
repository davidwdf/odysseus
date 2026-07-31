// **Today's behaviour is the default.** This is the file that establishes it.
//
// `watch()` was rewritten over a frame protocol and a pluggable transport, and the whole point of the
// rewrite is that a screen cannot tell: with no transport configured, `EdgeClient` builds a poll
// emulator, so the requests, their URLs and their cadence must be exactly what the old `setInterval`
// shim issued. That is asserted here against the *real* default path — no injected transport, no
// injected timers, the host's own `setInterval` under `vi.useFakeTimers()` — because a test that
// supplied a transport would be testing the thing the default is supposed to be indistinguishable from.
//
// One behaviour deliberately differs, and it is asserted too: a round in which nothing changed no longer
// calls the listener. The shim called it every cadence with a fresh copy of identical data, which is the
// repaint ADR-008's "update the value only when fresh data arrives" rules out.

import { CLIENT_POLICY_DEFAULTS, type Eta } from '@nextbus/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EdgeClient } from '../src'

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

/** A `fetch` that records what was asked for and answers from a per-stop table. */
function stubFetch(answers: Map<string, Eta[]>) {
  const urls: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)
    const stopId = [...answers.keys()].find((id) => url.includes(encodeURIComponent(id)))
    return new Response(JSON.stringify(stopId ? (answers.get(stopId) ?? []) : []), {
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

describe('EdgeClient.watch() with no transport configured', () => {
  it('issues one /v1/etas request per target and hands the listener a flat list', async () => {
    const answers = new Map([
      [STOP_A, [eta(STOP_A, '10:02')]],
      [STOP_B, [eta(STOP_B, '10:09')]],
    ])
    const { urls, fetchImpl } = stubFetch(answers)
    const client = new EdgeClient({ baseUrl: 'http://localhost:8787', fetchImpl })
    const seen: Eta[][] = []
    const sub = client.watch([{ stopId: STOP_A }, { stopId: STOP_B }], (etas) => seen.push(etas))
    await vi.advanceTimersByTimeAsync(0)

    // The same endpoint the shim called — `/v1/etas/:id`, one request per target, not the whole
    // `/v1/stop/:id` the screen's `useQuery` fetches (D6: the payload gets *smaller*).
    expect(urls).toEqual([
      'http://localhost:8787/v1/etas/KMB%3AA',
      'http://localhost:8787/v1/etas/KMB%3AB',
    ])
    expect(seen.length).toBe(1)
    expect(seen[0]?.map((e) => e.stopId)).toEqual([STOP_A, STOP_B])
    sub.unsubscribe()
  })

  it('narrows to routes when the target does', async () => {
    const { urls, fetchImpl } = stubFetch(new Map([[STOP_A, []]]))
    const client = new EdgeClient({ baseUrl: 'http://localhost:8787', fetchImpl })
    const sub = client.watch([{ stopId: STOP_A, routeIds: [ROUTE_1] }], () => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(urls).toEqual([
      `http://localhost:8787/v1/etas/KMB%3AA?routes=${encodeURIComponent(ROUTE_1)}`,
    ])
    sub.unsubscribe()
  })

  it('polls on the served cadence, and on nothing faster', async () => {
    const answers = new Map([[STOP_A, [eta(STOP_A, '10:02')]]])
    const { urls, fetchImpl } = stubFetch(answers)
    const client = new EdgeClient({ baseUrl: 'http://localhost:8787', fetchImpl })
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
    const client = new EdgeClient({ baseUrl: 'http://localhost:8787', fetchImpl })
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
    const client = new EdgeClient({ baseUrl: 'http://localhost:8787', fetchImpl, pollMs: 5_000 })
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
    const client = new EdgeClient({ baseUrl: 'http://localhost:8787', fetchImpl })
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
    const urls: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input)
      urls.push(url)
      if (url.includes(encodeURIComponent(STOP_B))) {
        return new Response(
          JSON.stringify({ code: 'upstream_timeout', retryable: true, message: 'slow' }),
          {
            status: 504,
            headers: { 'content-type': 'application/json' },
          },
        )
      }
      return new Response(JSON.stringify([eta(STOP_A, '10:02')]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const client = new EdgeClient({ baseUrl: 'http://localhost:8787', fetchImpl })
    const seen: Eta[][] = []
    const sub = client.watch([{ stopId: STOP_A }, { stopId: STOP_B }], (etas) => seen.push(etas))
    await vi.advanceTimersByTimeAsync(0)
    // A stale tile is better than a dead screen: the good target's readings arrive, and the failing one is
    // asked again next round rather than dropped — `retryable: true` says the same request may work later.
    expect(seen.at(-1)?.map((e) => e.stopId)).toEqual([STOP_A])
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs)
    expect(urls.filter((u) => u.includes(encodeURIComponent(STOP_B))).length).toBe(2)
    sub.unsubscribe()
  })

  it('stops fetching on unsubscribe', async () => {
    const { urls, fetchImpl } = stubFetch(new Map([[STOP_A, [eta(STOP_A, '10:02')]]]))
    const client = new EdgeClient({ baseUrl: 'http://localhost:8787', fetchImpl })
    const sub = client.watch([{ stopId: STOP_A }], () => {})
    await vi.advanceTimersByTimeAsync(0)
    sub.unsubscribe()
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs * 3)
    expect(urls.length).toBe(1)
  })
})
