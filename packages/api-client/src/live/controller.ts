// The subscription lifecycle: one live session, over any transport.
//
// WHY THIS IS THE SAME SHAPE AS `createLocationController`
// Because it is the same class of thing, and the repo has already paid for getting it wrong once. The
// location state machine lived inside `apps/mobile/lib/useLocation.ts` until WP4-1, which meant a second
// renderer had to reimplement the *sequence* and not just the adapter — recorded in ADR-051 as
// "conflates the port with shared logic". A live subscription has a longer sequence and more ways to be
// wrong (a resync, a reconnect, a frame that arrives after unmount), so the same discipline applies:
// explicit `deps`, an `emit` per transition, an `alive?()` guard for the caller that has gone away, and
// no framework of any kind inside. Each platform's hook is then ten lines that hold nothing —
// `apps/mobile/lib/useLiveEtas.ts` is the first.
//
// WHAT IT OWNS, AND WHAT IT REFUSES TO OWN
// It owns exactly two things a transport must not: the *session* (the reduced readings and the status,
// folded through the kernel's `applyLiveFrame`) and the *decision to ask again* when the reducer says the
// session can no longer be trusted. It owns no rule about what a frame means, no ordering, no threshold
// and no fallback — all of those are in `@nextbus/core`, pinned by `spec/live.spec.json`, because they
// are the part iOS and Android have to reproduce byte-for-byte.

import type { Eta, LiveSession, LiveStatus, SubscribeFrame, WatchTarget } from '@nextbus/core'
import { applyLiveFrame, LIVE_SESSION_START } from '@nextbus/core'
import type { LiveEngine, LiveEtaEngine } from './engine'

/** One repaint's worth of truth: every current reading, and what the connection is doing. */
export interface LiveEtaUpdate {
  /** Canonically ordered by `(stopId, routeId)` — the kernel's order, so both engines agree (D1). */
  etas: readonly Eta[]
  /**
   * The connection state and the failure behind it. The whole `LiveStatus` rather than the bare
   * `LiveState`, because the two are only useful together: "retrying" is a label, and `error.code` /
   * `error.retryable` is what a screen needs to decide between "we are reconnecting" and "this stop is
   * gone". Splitting them would let a caller render one without the other.
   */
  status: LiveStatus
}

export interface LiveEtaControllerDeps {
  /** The engine. Any `LiveTransport` that can say which engine it is — see `LiveEtaEngine`. */
  transport: LiveEtaEngine
  /** What to watch. Declared once, in one frame, and re-declared verbatim on every resync. */
  targets: readonly WatchTarget[]
  /** Called on every applied frame, in order. */
  emit(update: LiveEtaUpdate): void
  /**
   * Whether the caller still cares. A screen that unmounted mid-flight passes `false` and no further
   * update is emitted. It gates *emission only*, not the transport: releasing the connection is
   * `stop()`'s job, and conflating the two would leave a socket open whenever a component re-rendered
   * to `alive() === false`. Same split as `createLocationController`.
   */
  alive?(): boolean
}

export interface LiveEtaController {
  /** Open the transport and declare the targets. Idempotent — a second call does nothing. */
  start(): void
  /** Release everything. After this, nothing is emitted and the transport is closed. */
  stop(): void
  /**
   * Which engine is driving.
   *
   * A **property, not a frame** (D1). A field on the wire would make the poll emulator's and the
   * socket's output differ by construction, and the byte-identity that is this wave's whole point would
   * be unprovable. A screen that wants to tell a rider "live" rather than "polling" reads this — and
   * needs an i18n key for it, which is a follow-up rather than something to improvise at a call site.
   */
  readonly engine: LiveEngine
}

/**
 * Bind a transport to a listener: fold every frame through the kernel, emit the result, and ask for a
 * fresh snapshot when the reducer says the session has a hole in it.
 */
export function createLiveEtaController(deps: LiveEtaControllerDeps): LiveEtaController {
  const alive = () => deps.alive?.() ?? true
  /**
   * The complete target set, as one frame, kept so a resync re-declares it **verbatim**.
   *
   * `subscribe` replaces rather than adds (see `SubscribeFrameSchema`), so re-sending the same frame is
   * idempotent and is exactly what a reconnect has to send anyway. Building a fresh frame per resync
   * would open the door to sending a *different* set than the one the snapshot echo is compared against.
   */
  const subscription: SubscribeFrame = { type: 'subscribe', targets: [...deps.targets] }

  let session: LiveSession = LIVE_SESSION_START
  let started = false
  let released = false

  return {
    engine: deps.transport.engine,

    start() {
      if (started) return
      started = true
      // `open` strictly before `send`, and it matters: `createMemoryTransport` delivers its whole script
      // synchronously inside the `send()` call that triggers it, so a controller that declared its
      // targets before wiring the sink would drop every frame — and would do so *only* against a fake or
      // a native transport that behaves the same way, which is the worst place for a bug to hide.
      deps.transport.open({
        frame: (frame) => {
          if (released) return
          const result = applyLiveFrame(session, frame)
          session = result.state
          // `applied: false` is a `pong` or a `delta` whose `seq` has already been seen — nothing about
          // the readings changed, so a repaint would be work for no new information. The reducer's own
          // doc says a caller may skip on `false`; this is the caller that does.
          if (result.applied && alive()) {
            deps.emit({ etas: session.etas, status: session.status })
          }
          // Re-declaring the targets *is* the resync: the server answers a `subscribe` with a fresh
          // `snapshot`, and the poll emulator restarts its rounds from one. Sent after the emit, so the
          // screen shows what we just applied before we ask for more.
          //
          // This cannot loop. The only frame that can arrive in response is a `snapshot`, and
          // `applyLiveFrame` never reports `resyncNeeded` for a snapshot — it applies whatever `seq` it
          // carries, deliberately, because the snapshot is the recovery path (see the kernel's rules). So
          // the sequence terminates in one step by construction rather than by a counter or a cooldown.
          if (result.resyncNeeded) deps.transport.send(subscription)
        },
      })
      deps.transport.send(subscription)
    },

    stop() {
      released = true
      deps.transport.close()
    },
  }
}
