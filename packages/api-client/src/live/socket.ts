// The real transport: one WebSocket, and the reconnect *schedule* nothing in this repo has ever held.
//
// WHERE THE POLICY LIVES, AND WHY IT IS NOT ALL IN THIS FILE
// Before this file the repo had no reconnect of any kind: `watch()`'s `setInterval` simply failed and
// tried again a cadence later, and nothing anywhere decided how long to wait, how fast to widen or when
// to stop. A socket has to decide all three, and if it is not written down each platform will answer
// differently — iOS in a `URLSession` delegate, Android in an OkHttp listener — and a reviewer will have
// no artefact to disagree with.
//
// This file used to *be* that artefact, and that was the defect: `packages/ports/src/live-transport.ts`
// asserted the policy "is written down once in `createSocketTransport`" in the same breath as naming
// `URLSessionWebSocketTask` and OkHttp as the iOS and Android implementations — neither of which can read
// TypeScript. So on the two platforms the port exists for, the policy was written down nowhere. The
// arithmetic is now `liveReconnectDelayMs` in `@nextbus/core`, with 24 corpus rows that go red on every
// platform until the schedule is ported, and the numbers themselves are the kernel's
// `LIVE_RECONNECT_*` / `LIVE_KEEPALIVE_MS` constants, where each one's reason is stated.
//
// What stays here is everything the corpus cannot express, which is the part a test has to *watch*: the
// timer, the attempt counter, and when the counter resets.
//
// THE HALF OF THE POLICY THAT IS THIS FILE'S
//   · **Half jitter, from an injected source.** The delay is `capped/2 + random()·capped/2` — the sum is
//     the kernel's; `random` is injected here so the test asserts a schedule rather than a distribution.
//   · **`state: 'closed'` *with* a `retryable: false` error stops it, and both halves are required.**
//     Reconnecting into a subscription that can never work would produce the same frame for ever, so the
//     transport stops, having delivered the frame, and the session records the state so the screen can
//     say so. This is ADR-064's boolean doing the job it was put on the wire for.
//
//     **It used to test `retryable` alone, and that was too broad — found by WP5-3, when a real server
//     existed to send the frame.** `retryable` is documented as "whether the identical *request* may
//     succeed later", and the request is the thing the message names: the shard reports a favourite whose
//     id no longer parses as `{ state: 'live', error: { retryable: false } }` while the rider's other five
//     stops keep updating. Under the old rule the socket tore itself down on that frame and never came
//     back, so one stale favourite silently killed live ETAs everywhere — while the poll emulator, given
//     the same flag, dropped the one target and carried on. Two engines, one frame, opposite behaviour,
//     and nothing compared them: the scenario matrix drives the poll transport against a hand-written
//     script, never against this file. `state` describes the **connection**; `error` describes the thing
//     it names.
//   · **The attempt counter resets when a *frame* arrives, not when the socket opens.** A socket that
//     connects and dies before delivering anything is not a working connection — a Worker that accepts
//     the upgrade and then throws looks exactly like that — and resetting on `open` would turn the
//     backoff into a tight loop against it.
//
// WHAT IS DELIBERATELY NOT HERE
// No `Origin` header (a browser sets it and cannot be told otherwise; a native client may omit it, so it
// is never authorisation — see the scout's RFC 6455 reading), no auth, and no subscription rules. What a
// frame *means* is `applyLiveFrame` in the kernel; declaring targets and asking for a resync is
// `./controller.ts`. This file connects, sends bytes, receives bytes, and comes back when it drops.

import type {
  ClientFrame,
  PingFrame,
  ServerFrame,
  SubscribeFrame,
  WatchTarget,
} from '@nextbus/core'
import {
  LIVE_KEEPALIVE_MS,
  LIVE_RECONNECT_FACTOR,
  LIVE_RECONNECT_INITIAL_MS,
  LIVE_RECONNECT_MAX_MS,
  liveReconnectDelayMs,
} from '@nextbus/core'
import type { Clock, LiveTransportSink } from '@nextbus/ports'
import { wireErrorOf } from '../errors'
import { frameAt, type LiveEtaEngine, systemTimers, type Timers } from './engine'

/**
 * The platform's socket, reduced to what this transport needs: send a string, close, and three events.
 *
 * **Why a second seam, when `LiveTransport` is already the port.** They answer different questions.
 * `LiveTransport` is what the controller talks to, so a platform that wants its own reconnect policy
 * implements *that* and this file is not involved. This interface is the hole in *this* implementation
 * where a platform socket goes — so any platform whose socket can send a string (the browser, React
 * Native, `URLSessionWebSocketTask`, OkHttp) inherits the policy above instead of reinventing it. The
 * DOM's `WebSocket` type stays confined to `browserSocketFactory` below, which is also what lets a test
 * drive a connection without jsdom.
 */
export interface LiveSocketHandlers {
  /** The connection is usable. Queued frames go out now. */
  onOpen(): void
  /** One inbound message, as text. Binary messages are not ours and are dropped by the factory. */
  onMessage(data: string): void
  /**
   * The connection is gone, for any reason. Called **at most once** per connection by contract; the
   * transport also guards against a double call, because a browser fires `error` *and* `close`.
   */
  onClose(reason: string): void
}

/** One live connection, as this transport uses it. */
export interface LiveSocketConnection {
  send(data: string): void
  /** Close, and do not call `onClose` — a deliberate teardown is not an event the caller needs back. */
  close(): void
}

export type LiveSocketFactory = (url: string, handlers: LiveSocketHandlers) => LiveSocketConnection

/**
 * How the reconnect delay grows — the three inputs `liveReconnectDelayMs` takes, as an injection point.
 *
 * Kept as a shape here rather than folded into the kernel call because it is what a test overrides (the
 * cap assertion runs the whole schedule at `maxMs: 3_000`), and because a native transport that wants a
 * different curve should be able to say so without reimplementing the arithmetic. Each field's reason is
 * on the kernel constant it defaults to.
 */
export interface SocketBackoff {
  initialMs: number
  factor: number
  maxMs: number
}

/**
 * The shipped schedule, restated from the kernel's constants rather than as literals.
 *
 * That indirection is the fix for finding 12: three numbers spelled here were the *only* statement of the
 * policy, in a file iOS and Android cannot read. They are now declared where the corpus can pin them.
 */
export const DEFAULT_SOCKET_BACKOFF: SocketBackoff = {
  initialMs: LIVE_RECONNECT_INITIAL_MS,
  factor: LIVE_RECONNECT_FACTOR,
  maxMs: LIVE_RECONNECT_MAX_MS,
}

/** How often to ping. See `LIVE_KEEPALIVE_MS` for the number and why it is not a measurement. */
export const DEFAULT_KEEPALIVE_MS = LIVE_KEEPALIVE_MS

/**
 * The keepalive bytes.
 *
 * Encoded from a value the compiler checks is a `PingFrame`, rather than restating the string, which
 * closes the loop with the contract: `buildAsyncApiDocument()` asserts that `LIVE_PING_MESSAGE` *is* the
 * JSON encoding of `PingFrameSchema` and refuses to emit the document otherwise. So a change to the
 * frame breaks the `satisfies` here and the assertion there, and neither the auto-response string nor
 * this client can drift alone. One different byte would mean every keepalive wakes a hibernated shard —
 * the difference between an idle connection costing nothing and one billed around the clock.
 */
const PING_MESSAGE = JSON.stringify({ type: 'ping' } satisfies PingFrame)

export interface SocketTransportDeps {
  /** The socket URL, e.g. `wss://api.nextbus.hk/v1/live` — `resolveEndpoints().socketUrl`. */
  url: string
  clock: Clock
  timers?: Timers
  /** Defaults to the platform `WebSocket`. Injected in tests, and by a native client that has its own. */
  socketFactory?: LiveSocketFactory
  keepaliveMs?: number
  backoff?: Partial<SocketBackoff>
  /** Jitter source. `Math.random` in production; a constant in a test asserting the schedule. */
  random?: () => number
  /**
   * Watch **one whole route** instead of a named target set — `?route=<canonical route id>` (ADR-116).
   *
   * When this is set the connect URL is the complete subscription and this transport connects on `open()`
   * rather than waiting for a `subscribe` frame, because none is coming: the client deliberately does not
   * know the route's poles. The server resolves them from the route document and the object it lands on is
   * named for the route, so every client watching that route shares one round.
   *
   * A `subscribe` frame is still *sendable* on such a connection and the controller sends one to recover
   * from a `seq` gap — re-declaring the accepted set the `snapshot` echoed, which the object re-narrows to
   * its own route anyway. What must never happen is a frame declaring the *empty* set on connect: that is
   * a legal frame meaning "stop sending me readings", and it would silently switch off the round.
   */
  route?: string
}

/**
 * A `LiveTransport` over one WebSocket, with keepalive and reconnect.
 *
 * It connects on the first `subscribe` rather than on `open`, and that is forced by D4: the shard is
 * derived by the **Worker** from `?targets=` on the connect URL, so the URL cannot be built until the
 * client has said what it wants. It is also the same sequence the poll emulator follows, which is what
 * lets the two be compared at all.
 */
export function createSocketTransport(deps: SocketTransportDeps): LiveEtaEngine {
  const timers = deps.timers ?? systemTimers
  const backoff = { ...DEFAULT_SOCKET_BACKOFF, ...deps.backoff }
  const keepaliveMs = deps.keepaliveMs ?? DEFAULT_KEEPALIVE_MS
  const random = deps.random ?? Math.random
  const socketFactory = deps.socketFactory ?? browserSocketFactory

  let sink: LiveTransportSink<ServerFrame> | null = null
  /** `close()` was called. Terminal, and nothing is emitted afterwards. */
  let released = false
  /** A `retryable: false` failure arrived. Terminal too, but the caller was told why. */
  let stopped = false
  let connection: LiveSocketConnection | null = null
  let ready = false
  /** Consecutive connections that never delivered a frame. Drives the backoff. */
  let attempt = 0
  /** The last target declaration. A reconnect re-sends exactly this — `subscribe` replaces, so one is enough. */
  let subscription: SubscribeFrame | null = null
  let queued: ClientFrame[] = []
  let stopKeepalive: (() => void) | null = null
  let cancelReconnect: (() => void) | null = null

  const emit = (frame: ServerFrame) => {
    if (!released) sink?.frame(frame)
  }

  /**
   * How long until the next attempt. The arithmetic is the kernel's, corpus-pinned and hand-ported; what
   * this line contributes is the two things a fixture cannot hold — the live failure count and a jitter
   * source. See `liveReconnectDelayMs`.
   */
  const delayFor = (failures: number): number =>
    liveReconnectDelayMs({ attempt: failures, jitter: random(), ...backoff })

  /**
   * `?targets=` — the comma-separated stop ids the **Worker** hashes to pick a shard.
   *
   * Sent unfiltered: `liveShardFor` runs `acceptTargets` server-side before hashing, so a malformed id
   * in the list cannot change which shard we land on, and the client deciding for itself which targets
   * are legal would make the `snapshot`'s accepted-set echo — the mechanism the contract specifies for
   * telling a rider a favourite was dropped — describe a set the client had already filtered.
   */
  const connectUrl = (targets: readonly WatchTarget[]): string =>
    deps.route === undefined
      ? `${deps.url}?targets=${encodeURIComponent(targets.map((t) => t.stopId).join(','))}`
      : // One id, whatever the route's length, on every reconnect — and percent-encoded because a route id
        // is full of `:`. The server resolves the poles, so there is nothing else to say.
        `${deps.url}?route=${encodeURIComponent(deps.route)}`

  const teardownConnection = () => {
    stopKeepalive?.()
    stopKeepalive = null
    connection?.close()
    connection = null
    ready = false
  }

  const connect = () => {
    // A route watch has no `subscription` to wait for — its URL is the subscription — so the guard is
    // "nothing to connect *with*" rather than "no subscribe frame yet".
    if (released || stopped || (subscription === null && deps.route === undefined)) return
    // Whatever was queued is superseded: a subscription is a replacement, so re-declaring the latest one
    // is both necessary and sufficient. Anything else in the queue was written for a connection that no
    // longer exists. For a route watch there is nothing to re-declare: the URL does it.
    queued = subscription === null ? [] : [subscription]
    let settled = false
    ready = false
    connection = socketFactory(connectUrl(subscription?.targets ?? []), {
      onOpen() {
        if (released) return
        ready = true
        const pending = queued
        queued = []
        for (const frame of pending) connection?.send(JSON.stringify(frame))
        stopKeepalive = timers.every(keepaliveMs, () => connection?.send(PING_MESSAGE))
      },
      onMessage(data) {
        if (released) return
        let frame: ServerFrame
        try {
          frame = JSON.parse(data) as ServerFrame
        } catch {
          // Not JSON, so not ours. Dropped rather than reported: this client performs no validation at
          // all (ADR-052 decision 2 — the contract's types erase), so "malformed" here can only mean
          // "not from our Worker", and the reducer's own tolerant default already covers a frame type
          // this build has never heard of.
          return
        }
        attempt = 0
        emit(frame)
        if (
          frame.type === 'status' &&
          frame.state === 'closed' &&
          frame.error?.retryable === false
        ) {
          // Delivered first, then torn down: the session must record the state before we stop, or a
          // screen would be left labelled `retrying` for ever with nothing coming.
          stopped = true
          cancelReconnect?.()
          cancelReconnect = null
          teardownConnection()
        }
      },
      onClose(reason) {
        if (settled) return // a browser fires `error` and then `close`; one is enough
        settled = true
        stopKeepalive?.()
        stopKeepalive = null
        connection = null
        ready = false
        if (released || stopped) return
        // A close code is not an HTTP status and `ERROR_CODES` has no member for one, so this reuses the
        // same `internal` / `retryable: true` fallback `classifyFailure` uses for a response body that is
        // not ours (see `wireErrorOf`). Inventing a code for it would put a value on the wire that the
        // status table does not bind.
        emit({
          type: 'status',
          at: frameAt(deps.clock.now()),
          state: 'retrying',
          error: wireErrorOf(new Error(reason)),
        })
        attempt += 1
        cancelReconnect = timers.after(delayFor(attempt), () => {
          cancelReconnect = null
          connect()
        })
      },
    })
  }

  return {
    engine: 'socket',
    open(nextSink) {
      sink = nextSink
      // A stop watch has nothing to connect to yet — the connect URL carries the target set (D4), which the
      // client has not declared. A **route** watch has everything it needs from `deps.route`, and waiting
      // for a `subscribe` frame that will never arrive would mean never connecting at all.
      if (deps.route !== undefined) connect()
    },
    send(frame: ClientFrame) {
      if (released || stopped) return
      if (frame.type === 'subscribe') {
        subscription = frame
        if (connection === null) {
          connect()
          return
        }
      }
      if (ready && connection !== null) connection.send(JSON.stringify(frame))
      else queued.push(frame)
    },
    close() {
      released = true
      cancelReconnect?.()
      cancelReconnect = null
      teardownConnection()
      sink = null
    },
  }
}

/**
 * The platform `WebSocket`, as a `LiveSocketFactory`.
 *
 * Legal here and nowhere near the kernel: `layers.json` denies the `WebSocket` global in
 * `packages/core` and biome renders that ban as a lint message, precisely so this stays in the `client`
 * layer where a platform object belongs. React Native ships the same global, so this one adapter serves
 * both renderers.
 */
export const browserSocketFactory: LiveSocketFactory = (url, handlers) => {
  const socket = new WebSocket(url)
  socket.onopen = () => handlers.onOpen()
  socket.onmessage = (event: MessageEvent) => {
    // Text only. Our frames are JSON, so a `Blob`/`ArrayBuffer` message did not come from our Worker;
    // handing its stringification to `JSON.parse` would produce noise rather than an error.
    if (typeof event.data === 'string') handlers.onMessage(event.data)
  }
  socket.onclose = (event: CloseEvent) => handlers.onClose(`socket closed (${event.code})`)
  // `error` carries no detail by design (browsers withhold it to avoid leaking cross-origin
  // information), so there is nothing to report but the fact.
  socket.onerror = () => handlers.onClose('socket error')
  return {
    send(data) {
      socket.send(data)
    },
    close() {
      // Detach first: a deliberate close would otherwise arrive back as `onClose` and schedule a
      // reconnect for a subscription that has just been released.
      socket.onclose = null
      socket.onerror = null
      socket.onmessage = null
      socket.onopen = null
      socket.close()
    },
  }
}
