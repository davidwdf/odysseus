// WP5-6: this app shell really reads `EXPO_PUBLIC_LIVE_TRANSPORT`, and the default really is `poll`.
//
// Why it needs a test at all: the two variables were documented in three `.env.example` files and in
// docs/10 for a whole wave while **nothing read them**, so `/v1/live` shipped unreachable from a real
// build. A grep-level check would not have caught that (the strings were all present, in prose), and
// `live-select.test.ts` in `@nextbus/api-client` proves the *rule* without proving that this renderer
// applies it. This file is the join, and it is here rather than in `lib/` because
// `scripts/check-view-transport-free.mjs` polices `apps/mobile/lib/` including its test files.
//
// TWO THINGS ABOUT THE MECHANISM, BOTH INHERENT RATHER THAN AWKWARDNESS FOR ITS OWN SAKE
//  · `lib/datasource.ts` reads its environment at **module scope**, which is what babel-preset-expo's
//    inliner requires — it visits only a literal `process.env.X` member expression, so a helper taking
//    the variable's *name* would compile, run in dev, and bake in `undefined` in a production bundle. So
//    a test cannot set the value and call a function; it resets the module registry and re-imports.
//  · The platform globals are stubbed **before** the import, not after. `EdgeClient`'s constructor does
//    `globalThis.fetch.bind(globalThis)` — bound once, at construction — so a stub installed afterwards
//    is invisible to the poll emulator. That bug cost this file one run, and it is exactly the shape of
//    thing that makes a module-scope singleton hard to test.

import { describe, expect, it, vi } from 'vitest'

interface Probe {
  engine: 'poll' | 'socket'
  fetched: string[]
  sockets: string[]
}

/**
 * Build `lib/datasource` with `EXPO_PUBLIC_LIVE_TRANSPORT` set to `value`, subscribe once, and report
 * which engine actually ran.
 *
 * Read by subscribing, because `watch()` returns a bare `Subscription` (ADR-004 fixes the signature) and
 * `EdgeClient` exposes no engine label — deliberately, since a screen must not be able to tell which
 * engine answered. So the observable difference is what the transport *does*: the poll emulator fetches
 * `/v1/etas/:id` immediately, and the socket opens a `WebSocket` and fetches nothing.
 */
async function probe(value: string | undefined): Promise<Probe> {
  const fetched: string[] = []
  const sockets: string[] = []
  const realFetch = globalThis.fetch
  const realWebSocket = globalThis.WebSocket
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetched.push(String(input))
    // An `EtaBatch`, because the poll emulator asks `/v1/etas?ids=…` since WP5-7. An `EtaReport` body
    // would still parse — the transport reads `.reports`, finds `undefined` and reports every target as
    // unanswered — so the URL assertion below is what actually pins the shape.
    return new Response('{"reports":[]}', { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  // biome-ignore lint/suspicious/noExplicitAny: a minimal stand-in for the platform global
  ;(globalThis as any).WebSocket = class {
    onopen: unknown = null
    onmessage: unknown = null
    onclose: unknown = null
    onerror: unknown = null
    constructor(url: string) {
      sockets.push(url)
    }
    send() {}
    close() {}
  }

  try {
    vi.resetModules()
    vi.stubEnv('EXPO_PUBLIC_LIVE_TRANSPORT', value)
    const { dataSource } = await import('../lib/datasource')
    const sub = dataSource.watch([{ stopId: 'KMB:A' }], () => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    sub.unsubscribe()
  } finally {
    vi.unstubAllEnvs()
    globalThis.fetch = realFetch
    globalThis.WebSocket = realWebSocket
  }

  // Exactly one of the two, asserted as an exclusive pair rather than as "did it fetch": an engine that
  // did both would be a socket with a polling fallback, which this repo deliberately does not have —
  // there is no `auto` precisely because no such fallback exists.
  expect(
    [fetched.length > 0, sockets.length > 0],
    `fetched ${JSON.stringify(fetched)}, opened ${JSON.stringify(sockets)}`,
  ).toEqual(value === 'poll' ? [true, false] : [false, true])
  return { engine: sockets.length > 0 ? 'socket' : 'poll', fetched, sockets }
}

describe('apps/mobile selects its live engine from the environment', () => {
  it('opens the socket when nothing is configured — the shipped default', async () => {
    // **Flipped by ADR-121**, on a measurement rather than a preference: the poll emulator asks
    // `/v1/etas?ids=…`, which carries no per-id route list, so every pole is asked about every route
    // calling there — 153 upstream calls and 19.9 s for twelve poles of Citybus 182, against 12 and
    // 0.49 s narrowed. A whole round was 75.7 s against a 30 s cadence, so rounds queued.
    const { engine, sockets } = await probe(undefined)
    expect(engine).toBe('socket')
    // The endpoint, not just "a socket was opened": `ws:` and not `wss:` because the default API URL is
    // `http://localhost:8787` — the half of `liveSocketUrl` that ships a rider's location in cleartext
    // when it is forgotten, works perfectly in dev, and shows no symptom.
    expect(sockets[0]).toBe(`ws://localhost:8787/v1/live?targets=${encodeURIComponent('KMB:A')}`)
  })

  it('polls when it is asked to, which is what an environment with no WebSocket path needs', async () => {
    // Still real configuration, in the other direction now: a proxy that strips upgrades or a runtime with
    // no `WebSocket` global has nothing else to fall back to, because there is deliberately no automatic
    // detection (see the typo case below).
    const { engine, fetched } = await probe('poll')
    expect(engine).toBe('poll')
    // The **batch** endpoint, which since WP5-7 is one request per round rather than one per target — and
    // the endpoint whose missing per-id route list is why this is no longer the default.
    expect(fetched[0]).toContain('/v1/etas?ids=')
  })

  it('falls back to the default, loudly, when the value is a typo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await probe('websockets')).engine).toBe('socket')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('reads the same declaration `apps/web` reads', async () => {
    // Not a second `=== 'socket'`. If this app ever grew its own comparison, the two renderers could
    // disagree about a spelling — which is the drift the repo's one-declaration discipline exists for,
    // and the reason `liveTransportFromEnv` is exported at all.
    const api = await import('@nextbus/api-client')
    expect(typeof api.liveTransportFromEnv).toBe('function')
    expect(api.DEFAULT_LIVE_ENGINE).toBe('socket')
  })
})
