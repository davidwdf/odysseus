// **The request deadline (ADR-137): a connection that will never answer becomes a failure, on time.**
//
// Everything in this package that copes with a failed request — the poll round's `requestError`, a
// screen's query retry, the supervisor's fallback — needs a *rejection* to fire, and a blackholed
// connection (a network switch mid-ride, a NAT entry that expired without an RST) never produces one.
// Before ADR-137 a hung `/v1/etas` request simply never settled: rounds stacked behind it, no
// `retrying` status was ever emitted, and the screen stayed labelled live over ageing readings — the
// silent-dead-pipe defect the socket's connect watch and keepalive close (ADR-135), alive on the one
// engine that exists *for* hostile networks.
//
// The stubs here honour `init.signal` the way a real platform fetch does — rejection on abort — because
// that is the whole mechanism: the deadline works by making the platform produce the rejection the
// failure arms already know how to classify.

import { CLIENT_POLICY_DEFAULTS, type Eta } from '@nextbus/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPollTransport, EdgeClient, INDEX_DEADLINE_MS, REQUEST_DEADLINE_MS } from '../src'

const STOP_A = 'KMB:A'
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

/** A promise that settles only when the request's own signal aborts — a blackholed connection. */
function hangUntilAborted<T>(signal: AbortSignal | null | undefined): Promise<T> {
  return new Promise<T>((_, reject) => {
    signal?.addEventListener('abort', () =>
      reject(new DOMException('The operation was aborted.', 'AbortError')),
    )
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the request deadline (ADR-137)', () => {
  it('a request that never answers rejects at the deadline, naming the path and the wait', async () => {
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) =>
      hangUntilAborted<Response>(init?.signal)) as typeof fetch
    const client = new EdgeClient({ baseUrl: 'http://localhost:8787', fetchImpl })

    // The platform's own abort rejection says "The operation was aborted", which names nothing a log
    // reader can use; the thrown message must say which request and how long we waited.
    const failure = expect(client.getStop(STOP_A)).rejects.toThrow(
      `/v1/stop/${encodeURIComponent(STOP_A)} → no response in ${REQUEST_DEADLINE_MS} ms`,
    )
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS)
    await failure
  })

  it('a server that sends headers and then wedges the body is the same dead pipe', async () => {
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        json: () => hangUntilAborted(init?.signal),
      }) as unknown as Response) as typeof fetch
    const client = new EdgeClient({ baseUrl: 'http://localhost:8787', fetchImpl })

    const failure = expect(client.getStop(STOP_A)).rejects.toThrow('no response in')
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS)
    await failure
  })

  it('/v1/index gets the whole-blob ceiling, not the request deadline', async () => {
    // The search index is the one endpoint whose transfer time is the rider's downlink × the whole
    // blob, so 15 s could fail a slow first load that was still succeeding. It gets 60 s — a hang
    // detector sized like the dataset download's (ADR-138) — and the ordinary deadline must NOT have
    // fired at 15 s, or every retry would restart the download from byte zero into the same wall.
    let settled = false
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) =>
      hangUntilAborted<Response>(init?.signal)) as typeof fetch
    const client = new EdgeClient({ baseUrl: 'http://localhost:8787', fetchImpl })

    const request = client.getSearchIndex().catch((thrown: Error) => {
      settled = true
      return thrown
    })
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS)
    expect(settled, 'the ordinary deadline must not end the index download').toBe(false)
    await vi.advanceTimersByTimeAsync(INDEX_DEADLINE_MS - REQUEST_DEADLINE_MS)
    expect(settled).toBe(true)
    expect(String(await request)).toContain(`/v1/index → no response in ${INDEX_DEADLINE_MS} ms`)
  })

  it('a poll subscription outlives a blackholed round: the deadline fails it, the next round recovers', async () => {
    let blackholed = true
    let aborted = 0
    const urls: string[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      urls.push(url)
      if (blackholed) {
        init?.signal?.addEventListener('abort', () => {
          aborted++
        })
        return hangUntilAborted<Response>(init?.signal)
      }
      const reports = new URL(url).searchParams
        .getAll('ids')
        .map((id) => ({ id, etas: [eta(id, '10:02')] }))
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
    const sub = client.watch([{ stopId: STOP_A }], (etas) => seen.push(etas))

    // Round 1 starts immediately and hangs. Before ADR-137 this promise never settled: the round
    // never published, and every later round stacked another pending request behind it forever.
    await vi.advanceTimersByTimeAsync(0)
    expect(urls.length).toBe(1)
    expect(seen.length).toBe(0)

    // The deadline fires inside the cadence — the hung round is *over* before round 2 begins, so a
    // dead connection costs exactly one in-flight request at a time, never a stack. The abort count
    // is the load-bearing assertion: the recovery below happened on the clock even before ADR-137
    // (the poll engine schedules rounds by timer, not by completion), but only a request that
    // carries the signal is ever *ended* rather than left pending against the connection pool.
    expect(REQUEST_DEADLINE_MS).toBeLessThan(CLIENT_POLICY_DEFAULTS.refreshAfterMs)
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS)
    expect(aborted).toBe(1)

    // The network comes back; the next scheduled round answers and the listener finally hears.
    blackholed = false
    await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs)
    expect(urls.length).toBe(2)
    expect(seen.at(-1)?.map((e) => e.stopId)).toEqual([STOP_A])
    sub.unsubscribe()
  })
})
