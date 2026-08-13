// The socket transport, driven without a socket.
//
// Every platform edge is injected — the connection factory, the timers, the jitter source — so this
// asserts the *policy* rather than a browser's behaviour: when the second attempt happens, what the
// delay was, what bytes the keepalive puts on the wire, and the two ways a subscription stops for good.
// Nothing in this repo had ever held a reconnect before WP5-1, so there was no prior art to copy and no
// existing test to extend; a policy nobody can watch happen is a policy nobody can disagree with.

import type { ServerFrame } from '@nextbus/core'
import type { Clock } from '@nextbus/ports'
import { describe, expect, it } from 'vitest'
import {
  createLiveEtaController,
  createSocketTransport,
  type LiveSocketConnection,
  type LiveSocketFactory,
  type LiveSocketHandlers,
  type Timers,
} from '../src'

const clock: Clock = { now: () => Date.parse('2026-07-30T02:00:00.000Z') }
const STOP_A = 'KMB:A'
const ROUTE_1 = 'KMB:1:outbound:1'

/** One fake connection, with its handlers exposed so a test can play the network. */
interface FakeSocket {
  url: string
  sent: string[]
  closed: boolean
  handlers: LiveSocketHandlers
}

function fakeSockets() {
  const sockets: FakeSocket[] = []
  const factory: LiveSocketFactory = (url, handlers) => {
    const socket: FakeSocket = { url, sent: [], closed: false, handlers }
    sockets.push(socket)
    const connection: LiveSocketConnection = {
      send(data) {
        socket.sent.push(data)
      },
      close() {
        socket.closed = true
      },
    }
    return connection
  }
  return { sockets, factory, latest: () => sockets[sockets.length - 1] }
}

/** The same manual timers the matrix uses, kept local: a shared helper would let one edit relax both. */
function manualTimers() {
  const repeating: Array<{ fn: () => void; live: boolean }> = []
  const once: Array<{ ms: number; fn: () => void; live: boolean }> = []
  const timers: Timers = {
    every(_ms, fn) {
      const entry = { fn, live: true }
      repeating.push(entry)
      return () => {
        entry.live = false
      }
    },
    after(ms, fn) {
      const entry = { ms, fn, live: true }
      once.push(entry)
      return () => {
        entry.live = false
      }
    },
  }
  return {
    timers,
    tick() {
      for (const entry of [...repeating]) if (entry.live) entry.fn()
    },
    /** Fire every live one-shot and report the delays they were scheduled with. */
    fireOnce(): number[] {
      const due = once.filter((e) => e.live)
      for (const entry of due) {
        entry.live = false
        entry.fn()
      }
      return due.map((e) => e.ms)
    },
    scheduled: () => once.filter((e) => e.live).map((e) => e.ms),
    liveRepeating: () => repeating.filter((e) => e.live).length,
  }
}

const snapshotFrame: ServerFrame = {
  type: 'snapshot',
  seq: 1,
  at: '2026-07-30T02:00:00.000Z',
  targets: [{ stopId: STOP_A }],
  etas: [
    {
      routeId: ROUTE_1,
      stopId: STOP_A,
      operator: 'KMB',
      arrivals: ['2026-07-30T10:02:00+08:00'],
      dataTimestamp: '2026-07-30T09:59:00+08:00',
      observedAt: '2026-07-30T01:59:00.000Z',
    },
  ],
}

/** A transport wired to a controller, which is the only way it is ever used. */
function harness(
  options: { random?: () => number; backoff?: { maxMs: number }; route?: string } = {},
) {
  const net = fakeSockets()
  const clocks = manualTimers()
  const transport = createSocketTransport({
    url: 'wss://api.example.test/v1/live',
    clock,
    timers: clocks.timers,
    socketFactory: net.factory,
    // A constant, so the assertion is the schedule and not a distribution. `() => 1` puts the
    // half-jitter at its ceiling, which is the deterministic upper edge of the real policy.
    random: options.random ?? (() => 1),
    backoff: options.backoff,
    ...(options.route === undefined ? {} : { route: options.route }),
  })
  const updates: Array<string> = []
  const controller = createLiveEtaController({
    transport,
    targets: options.route === undefined ? [{ stopId: STOP_A }] : [],
    ...(options.route === undefined ? {} : { declaredInUrl: true }),
    emit: (u) => updates.push(`${u.status.state}:${u.etas.length}`),
  })
  return { ...net, ...clocks, transport, controller, updates }
}

describe('createSocketTransport', () => {
  it('connects on subscribe, not on open, and puts the targets in the URL', () => {
    const h = harness()
    h.transport.open({ frame: () => {} })
    // D4: the **Worker** derives the shard from `?targets=`, so the URL cannot be built until the client
    // has said what it wants — which is also why this transport starts on `subscribe` like the poll one.
    expect(h.sockets).toEqual([])
    h.transport.send({ type: 'subscribe', targets: [{ stopId: STOP_A }] })
    expect(h.sockets.length).toBe(1)
    expect(h.latest()?.url).toBe('wss://api.example.test/v1/live?targets=KMB%3AA')
  })

  it('queues the subscribe frame until the connection is open, then sends it', () => {
    const h = harness()
    h.controller.start()
    // Nothing can be written to a socket that has not opened. A transport that dropped this frame would
    // leave a connected socket that never receives anything — the failure is silent on both ends.
    expect(h.latest()?.sent).toEqual([])
    h.latest()?.handlers.onOpen()
    expect(h.latest()?.sent).toEqual(['{"type":"subscribe","targets":[{"stopId":"KMB:A"}]}'])
  })

  it('keeps alive with the exact bytes the hibernation auto-response matches', () => {
    const h = harness()
    h.controller.start()
    h.latest()?.handlers.onOpen()
    h.tick()
    // Byte-for-byte: `LIVE_PING_MESSAGE` in `@nextbus/contract` is asserted by
    // `buildAsyncApiDocument()` to be exactly this encoding of `PingFrameSchema`, and Cloudflare replies
    // without waking the Durable Object only on an exact match. One extra space and every keepalive
    // wakes a hibernated shard.
    expect(h.latest()?.sent.at(-1)).toBe('{"type":"ping"}')
  })

  it('delivers frames to the sink and reduces them', () => {
    const h = harness()
    h.controller.start()
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onMessage(JSON.stringify(snapshotFrame))
    expect(h.updates).toEqual(['connecting:1'])
  })

  it('drops a message that is not JSON without disturbing the session', () => {
    const h = harness()
    h.controller.start()
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onMessage('<html>captive portal</html>')
    // Not reported as an error: this client validates nothing (ADR-052 decision 2), so "malformed" can
    // only mean "not from our Worker", and a `status` frame invented here would tell a rider their bus
    // data was broken because a proxy answered.
    expect(h.updates).toEqual([])
  })

  it('reconnects with a widening delay, and re-declares its targets each time', () => {
    const h = harness()
    h.controller.start()
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onClose('socket closed (1006)')
    expect(h.updates).toEqual(['retrying:0'])
    // 1 s, 2 s, 4 s — the policy in the header, at the jitter ceiling.
    expect(h.fireOnce()).toEqual([1_000])
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onClose('socket closed (1006)')
    expect(h.fireOnce()).toEqual([2_000])
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onClose('socket closed (1006)')
    expect(h.fireOnce()).toEqual([4_000])
    expect(h.sockets.length).toBe(4)
    // Every reconnect re-declares the whole target set, because `subscribe` replaces rather than adds and
    // a fresh connection knows nothing.
    h.latest()?.handlers.onOpen()
    expect(h.latest()?.sent).toEqual(['{"type":"subscribe","targets":[{"stopId":"KMB:A"}]}'])
  })

  it('caps the delay', () => {
    const h = harness({ backoff: { maxMs: 3_000 } })
    h.controller.start()
    for (const expected of [1_000, 2_000, 3_000, 3_000]) {
      h.latest()?.handlers.onOpen()
      h.latest()?.handlers.onClose('socket closed (1006)')
      expect(h.fireOnce()).toEqual([expected])
    }
  })

  it('applies half jitter, so a restarted shard is not hit by every client at once', () => {
    const h = harness({ random: () => 0 })
    h.controller.start()
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onClose('socket closed (1006)')
    // The floor of the same schedule: `capped/2`. Full jitter would allow ~0 here, which is the
    // thundering herd the jitter exists to prevent.
    expect(h.fireOnce()).toEqual([500])
  })

  it('resets the delay when a frame arrives, not when the socket opens', () => {
    const h = harness()
    h.controller.start()
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onClose('socket closed (1006)')
    expect(h.fireOnce()).toEqual([1_000])
    // This connection actually delivered something, so it was a working connection.
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onMessage(JSON.stringify(snapshotFrame))
    h.latest()?.handlers.onClose('socket closed (1006)')
    expect(h.fireOnce()).toEqual([1_000])
    // Whereas a socket that opens and dies having delivered nothing — a Worker that accepts the upgrade
    // and then throws looks exactly like this — must not reset it, or the backoff becomes a tight loop.
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onClose('socket closed (1006)')
    expect(h.fireOnce()).toEqual([2_000])
  })

  it('treats error-then-close as one event', () => {
    const h = harness()
    h.controller.start()
    h.latest()?.handlers.onOpen()
    const socket = h.latest()
    // A browser fires `error` and then `close` for the same failure, and both are routed to `onClose`.
    socket?.handlers.onClose('socket error')
    socket?.handlers.onClose('socket closed (1006)')
    expect(h.updates).toEqual(['retrying:0'])
    expect(h.scheduled()).toEqual([1_000])
  })

  it('stops for good on a failure the server says is permanent', () => {
    const h = harness()
    h.controller.start()
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onMessage(
      JSON.stringify({
        type: 'status',
        at: '2026-07-30T02:00:00.000Z',
        state: 'closed',
        error: { code: 'not_found', message: 'no such stop', retryable: false },
      }),
    )
    // Delivered first — the session has to record the state, or the screen sits on a `retrying` label
    // for ever with nothing coming — and then torn down with no reconnect scheduled. This is ADR-064's
    // boolean doing the job it was put on the wire for.
    expect(h.updates).toEqual(['closed:0'])
    expect(h.latest()?.closed).toBe(true)
    expect(h.scheduled()).toEqual([])
    expect(h.sockets.length).toBe(1)
  })

  it('keeps a working subscription when the server rejects one of its targets', () => {
    // **The divergence WP5-3 found, as a test.** The first version of this transport treated *any*
    // `status` frame whose error said `retryable: false` as terminal, and that is too broad: `retryable`
    // is documented as "whether the identical **request** may succeed later", where the request is the
    // thing the message names — a favourite whose id no longer parses — while `state` is what describes
    // the connection. The shard emits exactly this frame for a target it has dropped, alongside the
    // `snapshot` whose `targets` echo says which ones survived, and the other five stops keep updating.
    //
    // Under the old rule the socket tore itself down on that frame and never reconnected, so a rider with
    // one stale favourite lost live ETAs for every stop they had. The poll emulator, given the same
    // information, drops the one target and carries on — so the two engines disagreed about the same
    // frame, and nothing compared them: the scenario matrix drives the poll transport against a
    // hand-written script, never against this file.
    const h = harness()
    h.controller.start()
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onMessage(JSON.stringify(snapshotFrame))
    h.latest()?.handlers.onMessage(
      JSON.stringify({
        type: 'status',
        at: '2026-07-30T02:00:00.000Z',
        state: 'live',
        error: { code: 'bad_request', message: 'not watching: legacy-id', retryable: false },
      }),
    )
    expect(h.updates).toEqual(['connecting:1', 'live:1'])
    expect(h.latest()?.closed, 'the connection must survive a per-target rejection').toBe(false)
    // …and it is still a live connection, not a zombie: the keepalive is still running.
    expect(h.liveRepeating()).toBe(1)
  })

  it('tears down a silently dead connection after two quiet keepalive intervals', () => {
    // The half of the keepalive that was missing (WP6-8b): the ping held intermediaries' idle timers
    // open, but nothing checked that anything came back. A phone that changes networks leaves the
    // platform socket reading OPEN for minutes while `send()` buffers silently — this connection is
    // exactly that, and before this rule it sat labelled `live` with frozen readings until the OS
    // noticed.
    const h = harness()
    h.controller.start()
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onMessage(JSON.stringify(snapshotFrame))
    const dead = h.latest()

    h.tick() // one quiet interval: still a ping, not a verdict — a single delayed pong is not a dead pipe
    expect(dead?.sent.at(-1)).toBe('{"type":"ping"}')
    expect(dead?.closed).toBe(false)

    h.tick() // two quiet intervals: the pipe is dead, whatever the platform says
    expect(dead?.closed).toBe(true)
    // The listener is told (`retrying`, with the session's readings intact — a stale reading with an
    // honest label beats a blank screen), and a reconnect is scheduled. The frame this connection did
    // deliver reset the attempt counter, so the schedule starts at its floor.
    expect(h.updates.at(-1)).toBe('retrying:1')
    expect(h.scheduled()).toEqual([1_000])
  })

  it('any inbound frame resets the silence counter, so a live connection is never torn down', () => {
    const h = harness()
    h.controller.start()
    h.latest()?.handlers.onOpen()
    const socket = h.latest()
    for (let interval = 0; interval < 5; interval++) {
      h.tick()
      // The runtime's auto-response answers each ping without waking the shard, so on a healthy
      // connection a pong is the guaranteed once-per-interval frame even when no bus moves.
      socket?.handlers.onMessage('{"type":"pong"}')
    }
    expect(socket?.closed).toBe(false)
    expect(h.liveRepeating()).toBe(1)
  })

  it('fails a handshake that never completes within one keepalive interval', () => {
    // Most refusals fire `error`/`close` promptly, but a blackholed upgrade — a dropping middlebox, a
    // captive portal that swallows it — leaves the platform socket CONNECTING for its own long timeout,
    // during which this transport would neither deliver nor retry. The watch turns that into an
    // ordinary failure on the ordinary schedule.
    const h = harness()
    h.controller.start()
    const stuck = h.latest()
    expect(stuck?.closed).toBe(false)
    // The only live one-shot is the handshake watch; firing it is the interval elapsing.
    expect(h.fireOnce()).toEqual([30_000])
    expect(stuck?.closed).toBe(true)
    expect(h.updates.at(-1)).toBe('retrying:0')
    expect(h.scheduled()).toEqual([1_000])
  })

  it('releases everything on unsubscribe, including a pending reconnect', () => {
    const h = harness()
    h.controller.start()
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onClose('socket closed (1006)')
    expect(h.scheduled()).toEqual([1_000])
    h.controller.stop()
    expect(h.scheduled()).toEqual([])
    expect(h.liveRepeating()).toBe(0)
    // …and firing the timer anyway does not resurrect it, which is what a `clearTimeout` alone would not
    // guarantee if the callback had already been scheduled by the host.
    h.fireOnce()
    expect(h.sockets.length).toBe(1)
  })
})

// ── A route watch (ADR-116) ──────────────────────────────────────────────────────────────────────
//
// The subscription is the connect URL and nothing else, because the client deliberately does not know the
// route's poles — the server resolves them from the route document, and the object the URL selects is named
// for the route so every client watching it shares one round. Everything below is about that difference and
// the one hazard it creates.

describe('createSocketTransport, watching a route', () => {
  const ROUTE = 'CTB:91:outbound:1'

  it('connects on open, because no subscribe frame is coming', () => {
    const h = harness({ route: ROUTE })
    h.transport.open({ frame: () => {} })
    // The mirror image of the stop-watch case above: there, waiting for `subscribe` is what makes the URL
    // buildable; here it would mean never connecting at all.
    expect(h.sockets.length).toBe(1)
    expect(h.latest()?.url).toBe('wss://api.example.test/v1/live?route=CTB%3A91%3Aoutbound%3A1')
  })

  it('sends no frame on connect, which is the hazard and not a saving', () => {
    const h = harness({ route: ROUTE })
    h.controller.start()
    h.latest()?.handlers.onOpen()
    // **An empty `subscribe` is a legal frame meaning "stop sending me readings"** (the shard treats a
    // subscription as a replacement of the accepted set). So a route watch that declared its empty target
    // list on connect would switch its own round off, and the symptom would be a screen that connects
    // perfectly and never updates. Only the keepalive may be on the wire.
    expect(h.latest()?.sent.filter((frame) => frame.includes('subscribe'))).toEqual([])
  })

  it('keeps the one-id URL across a reconnect', () => {
    const h = harness({ route: ROUTE })
    h.controller.start()
    h.latest()?.handlers.onOpen()
    h.latest()?.handlers.onClose('socket closed (1006)')
    h.fireOnce()
    expect(h.sockets.length).toBe(2)
    // A 41-pole route would otherwise put ~1.5 kB of percent-encoded ids into every reconnect, and a
    // reconnect storm is exactly when that matters.
    expect(h.latest()?.url).toBe('wss://api.example.test/v1/live?route=CTB%3A91%3Aoutbound%3A1')
  })

  it('recovers from a seq gap by re-declaring the set the server itself echoed', () => {
    const h = harness({ route: ROUTE })
    h.controller.start()
    const socket = h.latest() as NonNullable<ReturnType<typeof h.latest>>
    socket.handlers.onOpen()
    // A snapshot tells this client, for the first time, which poles it is watching.
    socket.handlers.onMessage(JSON.stringify(snapshotFrame))
    socket.sent.length = 0
    // Then a delta whose `seq` skips one: the kernel says the session has a hole and asks for a resync.
    socket.handlers.onMessage(
      JSON.stringify({
        type: 'delta',
        seq: 9,
        at: '2026-07-30T02:01:00.000Z',
        changed: [],
        gone: [],
      }),
    )
    // What goes back is the *accepted* set, not an empty frame and not a guess at the poles. The route
    // object re-narrows it to its own route, so this is idempotent.
    expect(socket.sent).toEqual(['{"type":"subscribe","targets":[{"stopId":"KMB:A"}]}'])
  })

  it('asks for nothing when the gap arrives before any snapshot', () => {
    const h = harness({ route: ROUTE })
    h.controller.start()
    const socket = h.latest() as NonNullable<ReturnType<typeof h.latest>>
    socket.handlers.onOpen()
    socket.sent.length = 0
    socket.handlers.onMessage(
      JSON.stringify({
        type: 'delta',
        seq: 4,
        at: '2026-07-30T02:01:00.000Z',
        changed: [],
        gone: [],
      }),
    )
    // There is nothing to re-declare yet, and the empty frame that would otherwise be sent is the one
    // frame that must never be sent. Silence is correct: the connection is already the declaration.
    expect(socket.sent.filter((frame) => frame.includes('subscribe'))).toEqual([])
  })
})
