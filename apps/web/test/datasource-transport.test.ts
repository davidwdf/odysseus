// WP5-6, the second renderer: `apps/web` reads `VITE_LIVE_TRANSPORT`, and its default is `poll` too.
//
// The twin of `apps/mobile/test/datasource-transport.test.ts`, and it exists for the reason Wave 4 built
// this app at all (ADR-068/069): a claim about "both renderers" that only one renderer tests is a claim
// about one renderer. Two waves running, the asymmetries this app has caught have all been of exactly
// this shape — something wired in one shell and merely *documented* in the other.
//
// **Since WP5-7 the configuration is no longer inert here.** `Nearby` holds a subscription
// (`src/hooks/useLiveNearby.ts`), so `VITE_LIVE_TRANSPORT=socket` changes which engine feeds the arrivals
// a rider of *this* app reads — where until then it was real configuration that changed nothing visible.
// The paragraph this replaces said so, and the correction matters because that sentence was the reason
// nobody looked here.

import { describe, expect, it, vi } from 'vitest'

/** Build `src/adapters/datasource` with `VITE_LIVE_TRANSPORT` set, subscribe once, report the engine. */
async function probe(
  value: string | undefined,
): Promise<{ engine: 'poll' | 'socket'; urls: string[] }> {
  const fetched: string[] = []
  const sockets: string[] = []
  const realFetch = globalThis.fetch
  const realWebSocket = globalThis.WebSocket
  // Before the import, not after: `EdgeClient` binds `globalThis.fetch` in its constructor, so a stub
  // installed later is invisible to the poll emulator. Same trap the mobile twin documents.
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
    vi.stubEnv('VITE_LIVE_TRANSPORT', value)
    const { dataSource } = await import('../src/adapters/datasource')
    const sub = dataSource.watch([{ stopId: 'KMB:A' }], () => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    sub.unsubscribe()
  } finally {
    vi.unstubAllEnvs()
    globalThis.fetch = realFetch
    globalThis.WebSocket = realWebSocket
  }

  expect(
    [fetched.length > 0, sockets.length > 0],
    `fetched ${JSON.stringify(fetched)}, opened ${JSON.stringify(sockets)}`,
  ).toEqual(value === 'poll' ? [true, false] : [false, true])
  return { engine: sockets.length > 0 ? 'socket' : 'poll', urls: [...fetched, ...sockets] }
}

describe('apps/web selects its live engine from the environment', () => {
  it('opens the socket when nothing is configured — the same default as apps/mobile', async () => {
    // **Flipped by ADR-121**, on a measurement rather than a preference: the poll emulator asks
    // `/v1/etas?ids=…`, which carries no per-id route list, so every pole is asked about every route
    // calling there — 153 upstream calls and 19.9 s for twelve poles of Citybus 182, against 12 and
    // 0.49 s narrowed. The whole round was 75.7 s against a 30 s cadence, so rounds queued behind
    // each other for as long as a screen stayed open.
    const { engine, urls } = await probe(undefined)
    expect(engine).toBe('socket')
    expect(urls[0]).toContain('/v1/live?targets=')
  })

  it('polls when it is asked to, which is what an environment with no WebSocket path needs', async () => {
    // The other direction since ADR-121, and still real configuration: a proxy that strips upgrades or a
    // runtime with no `WebSocket` global has nothing else to fall back to, because there is deliberately
    // no automatic detection (see the typo case below for why).
    const { engine, urls } = await probe('poll')
    expect(engine).toBe('poll')
    expect(urls[0]).toContain('/v1/etas?ids=')
  })

  it('derives the socket URL from the API URL rather than taking one of its own', async () => {
    const { urls } = await probe(undefined)
    // `liveSocketUrl` in the kernel: one variable per renderer, and the socket URL is not one of them
    // (ADR-056 decision 8) — so `VITE_LIVE_TRANSPORT` cannot point the two halves at different hosts.
    expect(urls[0]).toBe(`ws://localhost:8787/v1/live?targets=${encodeURIComponent('KMB:A')}`)
  })

  it('falls back to the default, loudly, when the value is a typo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await probe('auto')).engine).toBe('socket')
    // `auto` specifically, because it is the value somebody will reach for first — and it does not exist
    // on purpose: an automatic choice implies a socket→poll fallback, and `createSocketTransport`
    // reconnects for ever rather than degrading, so `auto` would be a promise the code does not keep.
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
