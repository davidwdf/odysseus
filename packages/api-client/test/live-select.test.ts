// WP5-6: the engine a configured spelling names, and the default when nothing is configured.
//
// The reason this file is worth its lines rather than being obvious: before WP5-6 there was **no
// assertion anywhere that the default engine is the poll emulator**. It was pinned only behaviourally,
// by `edge-client-watch.test.ts` observing `/v1/etas/:id` requests — which is a good test of the poll
// path and says nothing about what happens the day somebody changes a `??`. Since the socket is now one
// environment variable away, and since selecting it un-latches five confirmed shard findings that
// shipped green because nothing could reach the Durable Object (ADR-056), "the default is `poll`" is a
// claim that needs a test of its own.

import { describe, expect, it, vi } from 'vitest'
import type { LiveTransportContext } from '../src'
import {
  createPollTransport,
  DEFAULT_LIVE_ENGINE,
  LIVE_ENGINES,
  liveEngineFrom,
  liveTransportFor,
  liveTransportFromEnv,
} from '../src'

/** Enough of a context to build either engine. Neither connects nor fetches until `subscribe`. */
const ctx: LiveTransportContext = {
  endpoints: { apiUrl: 'https://api.example.test', socketUrl: 'wss://api.example.test/v1/live' },
  getEtasBatch: async () => ({ reports: [] }),
  pollMs: 30_000,
  clock: { now: () => Date.parse('2026-07-30T02:00:00.000Z') },
}

describe('liveEngineFrom', () => {
  it('defaults to the socket when nothing is configured', () => {
    // **Flipped 2026-08-11 (ADR-121), and the reason is measured**: the poll emulator asks
    // `/v1/etas?ids=…`, which cannot carry a per-id route list, so every pole it names is asked about every
    // route calling there. One chunk of twelve poles on Citybus 182 cost 153 upstream calls and 19.9 s
    // against the same twelve narrowed costing 12 and 0.49 s.
    expect(DEFAULT_LIVE_ENGINE).toBe('socket')
    expect(liveEngineFrom(undefined)).toBe('socket')
    // An empty string is what an env file with a bare `VITE_LIVE_TRANSPORT=` produces, and what Expo's
    // inliner leaves behind for an unset variable in some configurations. It is "unset", not a typo, so
    // it must not warn.
    expect(liveEngineFrom('')).toBe('socket')
  })

  it('selects each legal spelling, and there are exactly two', () => {
    expect([...LIVE_ENGINES]).toEqual(['poll', 'socket'])
    for (const engine of LIVE_ENGINES) expect(liveEngineFrom(engine)).toBe(engine)
    // **No `auto`.** An automatic choice implies a socket→poll fallback and none exists —
    // `createSocketTransport` reconnects for ever rather than degrading. Asserted rather than left to
    // the comment, because `auto` is the value somebody will reach for first.
    expect(liveEngineFrom('auto')).toBe(DEFAULT_LIVE_ENGINE)
  })

  it('falls back loudly on a spelling it does not recognise', () => {
    // The two failure modes are both real and neither is free: throwing breaks first paint over an
    // optional knob, and silently falling back is this repo's recurring shape — somebody sets the variable,
    // sees ordinary behaviour, and concludes it took effect. So: fall back, and say so once. Note the
    // fallback is now the *socket*, so a typo no longer quietly costs a rider the fan-out it was meant to
    // avoid — it costs them the engine they were trying to opt out of, which is the safer direction.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(liveEngineFrom('websocket')).toBe(DEFAULT_LIVE_ENGINE)
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    // The message has to carry the value it rejected and the values it accepts, or it is a warning that
    // tells a reader to go and read the source.
    expect(message).toContain('websocket')
    for (const engine of LIVE_ENGINES) expect(message).toContain(engine)
    warn.mockRestore()
  })

  it('is case-sensitive, deliberately', () => {
    // `SOCKET` is a typo, not a synonym. Normalising case would mean the set of accepted spellings is
    // larger than the documented one, and `.env.example` would stop being the whole answer.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(liveEngineFrom('SOCKET')).toBe(DEFAULT_LIVE_ENGINE)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('liveTransportFor', () => {
  it('builds the engine it names, and the transport says which it is', () => {
    // `LiveEtaEngine.engine` is the label a controller reports, and it is a property of the transport
    // rather than a field on any frame — which is what makes byte-identical frames from two engines
    // provable at all (ADR-056 decision 4). Asserting it here is asserting that this mapping is not
    // crossed over: a `socket` spelling that produced the poll emulator would look correct everywhere
    // else, because the poll emulator works.
    expect(liveTransportFor('poll')(ctx).engine).toBe('poll')
    expect(liveTransportFor('socket')(ctx).engine).toBe('socket')
  })

  it('gives the poll branch the client’s own factory, not a wrapper', () => {
    // Identity, not behaviour: `EdgeClient` falls back to `createPollTransport` when no transport is
    // configured, so if this branch returned a *wrapper* the configured-`poll` path and the
    // nothing-configured path would be two code paths that merely look alike.
    expect(liveTransportFor('poll')).toBe(createPollTransport)
  })

  it('connects to the URL in the context it was handed, per subscription', () => {
    // The claim: `liveTransportFor('socket')` reads `ctx.endpoints.socketUrl` **inside** the factory.
    // `EdgeClient.watch()` calls the factory once per *subscription*, and the connect URL carries
    // `?targets=` because the Worker derives the shard from it (ADR-056 decision 7) — so a factory that
    // had captured a URL built at module scope would be wrong the moment a second screen watched a
    // different place, and would be wrong invisibly, because one screen would still work.
    //
    // Observed at the only place that can see it: `browserSocketFactory` is what this branch defaults
    // to, and it calls `new WebSocket(url)` on the platform global. Stubbing the global is therefore
    // asserting the real path rather than an injected stand-in.
    const opened: string[] = []
    const realWebSocket = globalThis.WebSocket
    // biome-ignore lint/suspicious/noExplicitAny: a minimal stand-in for the platform global
    ;(globalThis as any).WebSocket = class {
      onopen: unknown = null
      onmessage: unknown = null
      onclose: unknown = null
      onerror: unknown = null
      constructor(url: string) {
        opened.push(url)
      }
      send() {}
      close() {}
    }
    try {
      for (const [socketUrl, stopId] of [
        ['wss://one.test/v1/live', 'KMB:A'],
        ['wss://two.test/v1/live', 'KMB:B'],
      ] as const) {
        const transport = liveTransportFor('socket')({
          ...ctx,
          endpoints: { apiUrl: '', socketUrl },
        })
        transport.open({ frame: () => {} })
        // It connects on the first `subscribe`, not on `open` — the target set is part of the URL.
        transport.send({ type: 'subscribe', targets: [{ stopId }] })
        transport.close()
      }
    } finally {
      globalThis.WebSocket = realWebSocket
    }
    expect(opened).toEqual([
      `wss://one.test/v1/live?targets=${encodeURIComponent('KMB:A')}`,
      `wss://two.test/v1/live?targets=${encodeURIComponent('KMB:B')}`,
    ])
  })

  it('forwards a route watch’s route, which is the whole of its connect URL', () => {
    // **The defect this case exists for shipped and was found in a browser.** This factory is where a
    // `LiveTransportContext` becomes `SocketTransportDeps`, and it copied two fields by hand: when the
    // context grew `route` (ADR-116/119) the new field was silently dropped, so `watchRoute` built its
    // controller, called `open()` — and connected to nothing, because a route watch has no `subscribe`
    // frame to trigger a connection with. Every unit test still passed: they construct
    // `createSocketTransport` directly and pass `route` themselves. Asserted here, at the seam that lost it.
    const opened: string[] = []
    const realWebSocket = globalThis.WebSocket
    // biome-ignore lint/suspicious/noExplicitAny: a minimal stand-in for the platform global
    ;(globalThis as any).WebSocket = class {
      onopen: unknown = null
      onmessage: unknown = null
      onclose: unknown = null
      onerror: unknown = null
      constructor(url: string) {
        opened.push(url)
      }
      send() {}
      close() {}
    }
    try {
      const transport = liveTransportFor('socket')({ ...ctx, route: 'CTB:91:outbound:1' })
      // No `send` — that is the point. The URL is the subscription, so `open()` alone must connect.
      transport.open({ frame: () => {} })
      transport.close()
    } finally {
      globalThis.WebSocket = realWebSocket
    }
    expect(opened).toEqual([
      `${ctx.endpoints.socketUrl}?route=${encodeURIComponent('CTB:91:outbound:1')}`,
    ])
  })
})

describe('liveTransportFromEnv', () => {
  it('returns undefined for the default, so the client stays the one place that names it', () => {
    // `undefined` leaves *the client* holding the answer to "what is the default", instead of two app
    // shells each restating it. That mechanism was tested the day the default changed: flipping
    // `DEFAULT_LIVE_ENGINE` to `'socket'` moved both shells and neither shell was edited.
    expect(liveTransportFromEnv(undefined)).toBeUndefined()
    expect(liveTransportFromEnv('socket')).toBeUndefined()
  })

  it('returns a poll factory only when polling was asked for', () => {
    // The other way round since ADR-121. `poll` is still selectable and still supported — it is what an
    // environment with no WebSocket path has — so it is a factory rather than a default now.
    const factory = liveTransportFromEnv('poll')
    expect(factory).toBeDefined()
    expect(factory?.(ctx).engine).toBe('poll')
  })

  it('returns undefined for an unrecognised spelling, having warned', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(liveTransportFromEnv('sockets')).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
