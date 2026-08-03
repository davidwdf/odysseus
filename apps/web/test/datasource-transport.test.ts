// WP5-6, the second renderer: `apps/web` reads `VITE_LIVE_TRANSPORT`, and its default is `poll` too.
//
// The twin of `apps/mobile/test/datasource-transport.test.ts`, and it exists for the reason Wave 4 built
// this app at all (ADR-068/069): a claim about "both renderers" that only one renderer tests is a claim
// about one renderer. Two waves running, the asymmetries this app has caught have all been of exactly
// this shape — something wired in one shell and merely *documented* in the other.
//
// **What this app cannot assert, stated rather than implied:** no screen here calls
// `DataSource.watch()` — `Nearby` fetches `getNearby` on an interval — so selecting the socket is real
// configuration that changes nothing a rider of this app sees until WP5-7 makes Nearby a live adopter.
// What is testable today is that the seam is wired identically, which is the part that would otherwise
// be discovered to be missing on the day it is needed.

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
    return new Response('{"etas":[]}', { headers: { 'content-type': 'application/json' } })
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
  ).toEqual(value === 'socket' ? [false, true] : [true, false])
  return { engine: sockets.length > 0 ? 'socket' : 'poll', urls: [...fetched, ...sockets] }
}

describe('apps/web selects its live engine from the environment', () => {
  it('polls when nothing is configured — the same default as apps/mobile', async () => {
    const { engine, urls } = await probe(undefined)
    expect(engine).toBe('poll')
    expect(urls[0]).toContain('/v1/etas/')
  })

  it('opens the socket when VITE_LIVE_TRANSPORT=socket', async () => {
    const { engine, urls } = await probe('socket')
    expect(engine).toBe('socket')
    // Derived from the API URL by `liveSocketUrl`, not configured: one variable per renderer, and the
    // socket URL is not one of them (ADR-056 decision 8).
    expect(urls[0]).toBe(`ws://localhost:8787/v1/live?targets=${encodeURIComponent('KMB:A')}`)
  })

  it('polls, loudly, when the value is a typo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await probe('auto')).engine).toBe('poll')
    // `auto` specifically, because it is the value somebody will reach for first — and it does not exist
    // on purpose: an automatic choice implies a socket→poll fallback, and `createSocketTransport`
    // reconnects for ever rather than degrading, so `auto` would be a promise the code does not keep.
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
