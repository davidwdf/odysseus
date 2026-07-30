// The poll emulator: HTTP polling, wearing the socket protocol.
//
// WHY EMULATE A SERVER RATHER THAN JUST CALL BACK WITH A LIST
// Because `watch()` is the seam the whole v2 plan turns on (ADR-004), and until now it was a *shim* —
// it fanned out `getEtas`, concatenated the results and handed the caller a flat `Eta[]` every 30
// seconds. Nothing about that shape could be compared with a socket: a socket sends a snapshot and then
// describes changes, so the two engines produced different *kinds* of thing and "the UI is identical
// against either implementation" was a claim with no test behind it. This module makes the polling
// engine speak the same frames the `EtaHub` shard will, using the same kernel function to compute them
// (`diffEtas`), so the scenario matrix in `../../test/live-matrix.test.ts` can assert that a listener
// cannot tell which one it is talking to — same values, same order, same number of updates.
//
// TWO THINGS IT KNOWS THAT THE SHARD WILL HAVE TO KNOW TOO
// Both are stated here because nothing binds them together — the corpus can pin what a frame *means*,
// but not what a transport does when a fetch fails, and Brief 3 has to make the Durable Object agree:
//
//  1. **A failed round is not a departure.** If a target's fetch fails, its previous readings stay in
//     this transport's state. Reporting them as `gone` would tell the rider the bus has left when all
//     that happened is that we could not ask — the exact dishonesty `gone` was added to prevent
//     (ADR-008, D2), pointed the other way.
//  2. **An unchanged round sends nothing at all.** No empty `delta`, no heartbeat. A shard pushing a
//     frame every 45 s per subscriber for no news is the cost model's 20:1 message meter being spent on
//     nothing, and a repaint on every round would defeat `sameReading`'s whole purpose (see
//     `COMPARED_FIELDS` in `@nextbus/core`). The listener hears from us when something has changed.

import type { ClientFrame, Eta, ServerFrame, WatchTarget, WireError } from '@nextbus/core'
import { acceptTargets, diffEtas } from '@nextbus/core'
import type { Clock, LiveTransportSink } from '@nextbus/ports'
import { wireErrorOf } from '../errors'
import { frameAt, type LiveEtaEngine, systemTimers, type Timers } from './engine'

/** One target's answer for one round: readings, or the failure that came instead. */
interface RoundOk {
  target: WatchTarget
  etas: readonly Eta[]
}
interface RoundFailure {
  target: WatchTarget
  error: WireError
}
// Spelled as two interfaces rather than left to inference: an inferred union of the two object literals
// gives each member the *other's* key as `?: undefined`, and `'etas' in result` then narrows to
// `readonly Eta[] | undefined` — a real `tsc` error, and the kind that tempts a cast.
type RoundResult = RoundOk | RoundFailure

export interface PollTransportDeps {
  /**
   * What to poll. `EdgeClient.getEtas` in production — taken as a function rather than the whole
   * client so this module cannot reach for a second endpoint, and so a test can hand it four scripted
   * rounds without a fetch stub.
   */
  getEtas(stopId: string, routeIds?: string[]): Promise<Eta[]>
  /** Stamps each frame's `at`. The kernel may not read a clock; this layer may, through the port. */
  clock: Clock
  /** Cadence, ms. `EdgeClient` defaults it to the served `refreshAfterMs` (ADR-053). */
  pollMs: number
  timers?: Timers
}

/**
 * A `LiveTransport` that polls `/v1/etas/:id` per target and synthesizes the frames a server would
 * send: a `snapshot` on the first round, a `delta` computed by the kernel's `diffEtas` afterwards, and
 * a `status` frame per failure.
 *
 * **This is the default engine**, and that is the point of it: with no transport configured,
 * `EdgeClient.watch()` builds one of these, so today's behaviour — one request per target per
 * `refreshAfterMs`, every target independent, a failure on one leaving the others alone — is what a
 * screen gets, and a socket is opt-in.
 */
export function createPollTransport(deps: PollTransportDeps): LiveEtaEngine {
  const timers = deps.timers ?? systemTimers

  let sink: LiveTransportSink<ServerFrame> | null = null
  let closed = false

  /** The accepted target set, minus any target we have stopped asking about. */
  let watching: WatchTarget[] = []
  /** Last known readings per target id. A target that failed keeps its entry — see the header. */
  let readings = new Map<string, readonly Eta[]>()
  /** What the client has already been told, flattened. `diffEtas`' left-hand side. */
  let sent: readonly Eta[] = []
  /** The wire's counter. 0 until the first `snapshot` goes out, which is the sentinel the kernel uses. */
  let seq = 0
  /** True once a whole round has succeeded; false again after any failure, so recovery re-announces. */
  let announcedLive = false
  let stopTimer: (() => void) | null = null
  /**
   * Bumped by every `subscribe`. A round that completes after the targets changed under it must be
   * discarded: its readings describe a set nobody asked for any more, and merging them would show a
   * rider arrivals for a stop they have navigated away from. Nothing in the old shim could hit this
   * (its target list was fixed for the life of the subscription); a resync can, and does.
   */
  let generation = 0

  const emit = (frame: ServerFrame) => {
    if (!closed) sink?.frame(frame)
  }
  const status = (state: 'live' | 'retrying' | 'closed', error?: WireError) => {
    const at = frameAt(deps.clock.now())
    // Two literals rather than one with `error` always present: an *absent* key is what the schema's
    // `.optional()` means, and a present-but-`undefined` one is a different value to `'error' in frame`
    // and to a strict structural comparison — which is precisely what the scenario matrix does to the
    // two engines' output. Same reasoning as `applyLiveFrame`'s own two-branch `status` case.
    emit(error === undefined ? { type: 'status', at, state } : { type: 'status', at, state, error })
  }

  const stopPolling = () => {
    stopTimer?.()
    stopTimer = null
  }

  /** Flatten per-target readings in accepted order. `diffEtas` dedupes, so order only has to be stable. */
  const flatten = (): Eta[] => watching.flatMap((t) => [...(readings.get(t.stopId) ?? [])])

  const runRound = async () => {
    const round = generation
    const results: RoundResult[] = await Promise.all(
      watching.map(async (target): Promise<RoundResult> => {
        try {
          return { target, etas: await deps.getEtas(target.stopId, target.routeIds) }
        } catch (thrown) {
          return { target, error: wireErrorOf(thrown) }
        }
      }),
    )
    // Two ways this round is no longer wanted: the subscription was released, or the target set moved
    // while the requests were in flight.
    if (closed || round !== generation) return

    // **The data frame goes out before the status frames**, and this ordering is load-bearing rather
    // than tidy. A `status` frame changes only the status, so with the statuses first the very first
    // update of every subscription would be `{ etas: [], state: 'live' }` — and
    // `applyLiveEtasToStopDetail` maps a row with no live reading to `null` *on purpose* (that is
    // `gone`'s honesty rule), so a screen would blank every arrival and refill it one tick later, on
    // every mount. Data first, then how much of it to trust. Both engines follow it; the scenario
    // matrix would fail on the first row if either did not.
    const failed = results.filter((r): r is RoundFailure => 'error' in r)
    for (const { target, error } of failed) {
      // `retryable: false` means *stop asking* — that is the field's own documentation, and honouring
      // it is the whole reason ADR-064 put a boolean on the wire instead of a status code a client has
      // to interpret. A favourite whose stop id no longer resolves would otherwise be re-requested
      // every round for as long as the rider keeps it. The target leaves `watching`, and its readings
      // therefore appear in this round's `gone` list — which is exactly what `DeltaFrame.gone`'s own
      // description covers: "the bus departed, **or the target was dropped**".
      if (!error.retryable) {
        watching = watching.filter((t) => t.stopId !== target.stopId)
        readings.delete(target.stopId)
      }
    }

    for (const result of results) {
      if ('etas' in result) readings.set(result.target.stopId, result.etas)
    }

    const next = flatten()
    const { changed, gone } = diffEtas(sent, next)
    if (seq === 0) {
      seq = 1
      sent = next
      emit({
        type: 'snapshot',
        seq,
        at: frameAt(deps.clock.now()),
        targets: watching,
        etas: next,
      })
    } else if (changed.length > 0 || gone.length > 0) {
      seq += 1
      sent = next
      emit({ type: 'delta', seq, at: frameAt(deps.clock.now()), changed, gone })
    }
    // else: nothing changed, so nothing is sent. See the header.

    for (const { error } of failed) status('retrying', error)
    // A `status` frame is a **transition, not a heartbeat**. `live` goes out on the first complete round
    // and again after a recovery, and nothing in between: a frame every round saying "still fine" would
    // repaint every screen every cadence, which is the cost the delta protocol exists to avoid. The flag
    // is reset by any failure, which is what makes the recovery observable — without it a screen labelled
    // "reconnecting" keeps that label for ever while data flows in behind it.
    if (failed.length > 0) announcedLive = false
    else if (!announcedLive) {
      announcedLive = true
      status('live')
    }

    if (watching.length === 0) {
      // Every target has been dropped as permanently unresolvable. There is nothing left to ask for, so
      // the honest thing is to stop and say so rather than keep a timer alive doing zero work for ever.
      stopPolling()
      status('closed')
    }
  }

  const subscribe = (targets: readonly WatchTarget[]) => {
    generation += 1
    stopPolling()
    // One rule decides the accepted set, and it is the kernel's, so this transport and the shard drop
    // the same malformed favourite. Rejects are not reported as their own frame: the `snapshot`'s
    // `targets` echo *is* the mechanism — "compare it with what you sent and tell the rider about the
    // difference" (`SnapshotFrame.targets`).
    watching = acceptTargets(targets).accepted
    readings = new Map()
    sent = []
    seq = 0
    announcedLive = false

    if (watching.length === 0) {
      // Nothing to poll: either the client asked for nothing (a legal `subscribe`, meaning "stop sending
      // me readings") or every target it named was rejected. It still gets a `snapshot`, because an
      // empty echo is how it learns which of the two happened, and then `closed`, because a transport
      // with nothing to fetch that kept a timer running would be billing a wakeup to say nothing.
      seq = 1
      emit({ type: 'snapshot', seq, at: frameAt(deps.clock.now()), targets: [], etas: [] })
      status('closed')
      return
    }

    void runRound()
    stopTimer = timers.every(deps.pollMs, () => void runRound())
  }

  return {
    engine: 'poll',
    open(nextSink) {
      sink = nextSink
      // No `connecting` frame: a session starts at `connecting` (`LIVE_SESSION_START`), and a transport
      // whose first act was to announce the state the client is already in would make every subscription
      // one repaint more expensive for no information. Polling starts on `subscribe`, like a socket.
    },
    send(frame: ClientFrame) {
      switch (frame.type) {
        case 'subscribe':
          subscribe(frame.targets)
          return
        case 'ping':
          // Nothing to keep alive. A `pong` here would be a lie about there being a connection, and the
          // controller does not send pings to this engine anyway — keepalive is a socket's concern and
          // lives in `./socket.ts`.
          return
        default: {
          // Same pairing the kernel's reducer uses: tolerant at runtime, exhaustive at compile time.
          // `frame` is `never` here today, so adding a member to `ClientFrameSchema` makes this line a
          // typecheck error until this transport decides what to do with it — while an unknown frame
          // from a newer caller is ignored rather than thrown.
          const unhandled: never = frame
          void unhandled
          return
        }
      }
    },
    close() {
      closed = true
      stopPolling()
      sink = null
    },
  }
}
