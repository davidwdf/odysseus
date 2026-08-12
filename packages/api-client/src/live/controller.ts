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
//
// It also refuses to own the comparison between what was *asked for* and what the server *accepted*. It
// publishes both halves — the caller handed in `targets`, and every update carries the accepted set — and a
// holder decides what a rider is told, because that sentence needs an i18n key and a product decision. See
// `LiveEtaUpdate.targets`.

import type {
  Eta,
  EtaFailure,
  LiveSession,
  LiveStatus,
  SubscribeFrame,
  WatchTarget,
} from '@nextbus/core'
import { applyLiveFrame, LIVE_SESSION_START } from '@nextbus/core'
import type { LiveEngine, LiveEtaEngine } from './engine'

/** One repaint's worth of truth: every current reading, what is being watched, and what the connection is doing. */
export interface LiveEtaUpdate {
  /**
   * The session's `seq` — `0` until the first data frame has been applied (WP6-8b).
   *
   * The sentinel matters more than the counter: `etas: []` means two different things on either side of
   * it. At `seq > 0` it is the server's answer — "nothing is due" — and a holder should paint it. At
   * `seq === 0` no `snapshot` has ever landed, so the empty list is `LIVE_SESSION_START`'s placeholder
   * riding along on a `status` transition, and writing it into a query cache would blank arrivals the
   * screen already painted from its own HTTP fetch — the ADR-073/087 blanking shape, from the client
   * side. `EdgeClient`'s listener door reads this field to hold every update back until data exists;
   * a holder of this controller that writes `etas` anywhere should do the same.
   */
  seq: number
  /** Canonically ordered by `(stopId, routeId)` — the kernel's order, so both engines agree (D1). */
  etas: readonly Eta[]
  /**
   * The targets the **server accepted**, from the last `snapshot` — to be compared with the ones this
   * controller was handed.
   *
   * **Why a holder gets both halves and the diff is not done here.** The accepted set is a fact about the
   * subscription; what to *say* about a target that is missing from it is a product decision with an i18n
   * key attached, and a controller that decided it would be deciding for three renderers at once. So the
   * comparison belongs to whoever holds the controller: it already knows what it asked for, because it
   * passed `deps.targets` in.
   *
   * It is here at all because until this field existed the comparison was unperformable on every platform.
   * `SnapshotFrame.targets` is published so a client can *"compare it with what you sent and tell the
   * rider about the difference"*, and both engines deliberately send no other signal for a target they
   * refused — so with the echo dropped, a rider whose saved pole had stopped resolving was shown "no buses
   * due" for a stop nobody was watching. That is the silent filter ADR-008 rules out.
   *
   * Empty before the first `snapshot`, and empty is not "everything": it is either "we have not been told
   * yet" (`status.state === 'connecting'`) or "nothing you asked for is being watched", which is the state
   * both engines pair with `closed`.
   */
  targets: readonly WatchTarget[]
  /**
   * The boarding points the last data frame said it could not ask about (WP5-14, ADR-081).
   *
   * Straight off the session, which is straight off the frame: the kernel's reducer replaces it from
   * every `snapshot` and `delta` and leaves it alone on a `status`, because the connection's state and the
   * upstream's are different facts. Empty is the normal case and means "nothing is refusing", not "we have
   * not been told" — the session resolves that ambiguity so no holder has to.
   *
   * A holder passes it into `applyLiveEtasToNearby` / `applyLiveEtasToStopDetail`, which have taken a
   * failure set since ADR-077 and were being called with nothing until this field existed. That is the
   * whole reason the field is here: the marker a card draws for an outage was first-paint-only, and this
   * is what makes it live.
   */
  failed: readonly EtaFailure[]
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
  /**
   * The subscription is the transport's connect URL, not a frame — a **route watch** (ADR-116).
   *
   * `targets` is then empty and must stay empty: the client does not know the route's poles, which is the
   * point of naming the route instead. Sending the usual declaration would be actively wrong rather than
   * merely redundant — a `subscribe` frame **replaces** the accepted set and an empty one is the legal way
   * to say *"stop sending me readings"*, so it would switch the round off on connect.
   *
   * Recovery still re-declares, because that is the only thing that fetches a fresh `snapshot`: what it
   * re-declares is the accepted set the **server** echoed, which the route object then re-narrows to its
   * own route. Before the first snapshot there is nothing to re-declare and nothing to recover.
   */
  declaredInUrl?: boolean
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
  const subscription: SubscribeFrame | null = deps.declaredInUrl
    ? null
    : { type: 'subscribe', targets: [...deps.targets] }

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
            deps.emit({
              seq: session.seq,
              etas: session.etas,
              targets: session.targets,
              failed: session.failed,
              status: session.status,
            })
          }
          // Re-declaring the targets *is* the resync: the server answers a `subscribe` with a fresh
          // `snapshot`, and the poll emulator restarts its rounds from one. Sent after the emit, so the
          // screen shows what we just applied before we ask for more.
          //
          // This cannot loop. The only frame that can arrive in response is a `snapshot`, and
          // `applyLiveFrame` never reports `resyncNeeded` for a snapshot — it applies whatever `seq` it
          // carries, deliberately, because the snapshot is the recovery path (see the kernel's rules). So
          // the sequence terminates in one step by construction rather than by a counter or a cooldown.
          // For a route watch there is no frame of our own to re-send, so the accepted set the server just
          // told us about is what goes back. Empty means no snapshot has arrived yet — nothing to recover
          // to, and an empty `subscribe` would mean "stop sending me readings".
          if (result.resyncNeeded) {
            if (subscription !== null) deps.transport.send(subscription)
            else if (session.targets.length > 0) {
              deps.transport.send({ type: 'subscribe', targets: [...session.targets] })
            }
          }
        },
      })
      if (subscription !== null) deps.transport.send(subscription)
    },

    stop() {
      released = true
      deps.transport.close()
    },
  }
}
