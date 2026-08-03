// The poll emulator: HTTP polling, wearing the socket protocol.
//
// ONE REQUEST PER ROUND, NOT ONE PER TARGET (WP5-7)
// It was one per target, and that is the single fact that kept this engine off the busiest screen in the
// app: Nearby watches up to six places and fetches its own list once per window, so adopting a
// subscription would have taken it from one request per window to six. `/v1/etas?ids=…` answers about a
// whole round, `chunkIds` splits a set larger than the wire's cap, and everything below the fetch is
// unchanged — the per-target bookkeeping, the retention, the drop and the failure ordering all still work
// on one `RoundResult` per accepted target, because that is the unit the *rules* are written in. What
// genuinely changed shape is failure: a **request** can now fail for several targets at once, which a
// per-target fan-out could not express and which the shard can never produce, so it is fanned back out to
// one failure per target of that request. See `runRound`.
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
//     (ADR-008, D2), pointed the other way. Since ADR-073 the same rule runs one level down as well:
//     a target can answer *partially*, because a place is several boarding poles and an upstream board
//     call is per pole, so `EtaReport.failed` names the kerbs that refused and `retainFailedPoles` —
//     the kernel's rule, called identically by the shard — keeps their readings. Before that field
//     existed the edge's cache resolved a refused board to an empty list, so this rule was enforced
//     here, enforced again in `eta-hub.ts`, and defeated below both of them.
//  2. **An unchanged round sends nothing at all.** No empty `delta`, no heartbeat. A shard pushing a
//     frame every 45 s per subscriber for no news is the cost model's 20:1 message meter being spent on
//     nothing, and a repaint on every round would defeat `sameReading`'s whole purpose (see
//     `COMPARED_FIELDS` in `@nextbus/core`). The listener hears from us when something has changed.

import type {
  ClientFrame,
  Eta,
  EtaBatch,
  EtaBatchEntry,
  EtaFailure,
  ServerFrame,
  WatchTarget,
  WireError,
} from '@nextbus/core'
import {
  acceptTargets,
  diffEtas,
  ETAS_BATCH_MAX_IDS,
  narrowEtasToRoutes,
  retainFailedPoles,
} from '@nextbus/core'
import type { Clock, LiveTransportSink } from '@nextbus/ports'
import { wireErrorOf } from '../errors'
import { frameAt, type LiveEtaEngine, systemTimers, type Timers } from './engine'

/** One target's answer for one round: readings (possibly partial), or the failure that came instead. */
interface RoundOk {
  target: WatchTarget
  etas: readonly Eta[]
  /** The boarding points inside this target that refused. Empty when the whole place answered. */
  failed: readonly EtaFailure[]
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
   * What to poll: `/v1/etas?ids=…`, **one request for the whole round** (WP5-7).
   *
   * `EdgeClient.getEtasBatch` in production — taken as a function rather than the whole client so this
   * module cannot reach for a second endpoint, and so a test can hand it four scripted rounds without a
   * fetch stub.
   *
   * It replaced a per-target `getEtas` rather than joining it. Six targets meant six requests per
   * cadence, which is why Nearby could not adopt this engine at all; and keeping both shapes would put
   * the round's rules — retention, the permanent drop, the failure ordering — on two paths, one of them
   * unreachable in production and therefore only ever exercised by a test.
   */
  getEtasBatch(ids: readonly string[]): Promise<EtaBatch>
  /** Stamps each frame's `at`. The kernel may not read a clock; this layer may, through the port. */
  clock: Clock
  /** Cadence, ms. `EdgeClient` defaults it to the served `refreshAfterMs` (ADR-053). */
  pollMs: number
  timers?: Timers
}

/**
 * Split a round's ids into requests the endpoint will accept.
 *
 * The cap is the contract's (`ETAS_BATCH_MAX_IDS`, restated in `@nextbus/core` and pinned to it by the
 * type system), and the client **chunks** rather than truncating: over the cap the endpoint answers a
 * `400`, and a subscription that silently dropped its thirteenth target would hold that target's
 * previous readings for ever with no `status` frame to explain it. A screen watching ≤ 12 places — every
 * screen in this app — makes exactly one request per cadence, which is the acceptance criterion.
 */
function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += ETAS_BATCH_MAX_IDS) {
    chunks.push([...ids.slice(i, i + ETAS_BATCH_MAX_IDS)])
  }
  return chunks
}

/**
 * A `LiveTransport` that polls `/v1/etas/:id` per target and synthesizes the frames a server would
 * send: a `snapshot` on the first round, a `delta` computed by the kernel's `diffEtas` afterwards, and
 * a `status` frame per failure.
 *
 * **This is the default engine**, and that is the point of it: with no transport configured,
 * `EdgeClient.watch()` builds one of these, so what a screen gets is one request per `refreshAfterMs`
 * for its whole target set, a target dropped only when its id stops resolving, and a failure that never
 * reads as a departure — and a socket is opt-in.
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
    const asked = watching
    /** Every entry the round came back with, by the id it answers for. */
    const entries = new Map<string, EtaBatchEntry>()
    /**
     * The failure of a *request*, as opposed to of an id.
     *
     * A request can fail for the whole chunk — the phone is offline, the Worker 502s — where before
     * there were N independent requests and N independent failures.
     */
    let requestError: WireError | null = null
    await Promise.all(
      chunkIds(asked.map((t) => t.stopId)).map(async (ids) => {
        try {
          for (const entry of (await deps.getEtasBatch(ids)).reports) entries.set(entry.id, entry)
        } catch (thrown) {
          // First one wins, and only the ids in this chunk are affected — the loop below decides that
          // per target by looking for its entry, so a chunk that answered is not lost to one that did
          // not. Recorded rather than thrown so the round still publishes what it learned.
          requestError ??= wireErrorOf(thrown)
        }
      }),
    )
    // Two ways this round is no longer wanted: the subscription was released, or the target set moved
    // while the requests were in flight.
    if (closed || round !== generation) return

    // **Walked in accepted-target order, never in the response's order**, and narrowed here rather than
    // by the server. Two things depend on it: `reportable` below publishes failures in exactly this
    // order and `eta-hub.ts` builds the identical sequence from `session.targets`, so trusting the
    // server's array would make the two engines order one round's `status` frames differently the moment
    // a round carried two failures.
    //
    // **A request failure is fanned out to one `RoundFailure` per target of that request, not collapsed
    // to one.** The shard cannot produce a request-level failure at all — it calls the read path per
    // target inside the object — so collapsing would make this engine emit a different number of
    // `status` frames than the socket for an offline client, which is the byte-identity WP5-1 exists to
    // assert. A missing entry for an id we *did* ask about, with no request failure to explain it, is a
    // bug of ours rather than an empty board: `internal`, retryable, and never an empty reading list,
    // because "nothing came back" and "this stop has no buses" being the same value is the whole defect
    // ADR-073 is about.
    const results: RoundResult[] = asked.map((target): RoundResult => {
      const entry = entries.get(target.stopId)
      if (entry === undefined) {
        return {
          target,
          error:
            requestError ??
            wireErrorOf(new Error(`no report for ${target.stopId} in a round that answered`)),
        }
      }
      if (entry.error !== undefined) return { target, error: entry.error }
      return {
        target,
        // `narrowEtasToRoutes` is the kernel's rule and the *same* one `/v1/etas/:id?routes=` applies
        // server-side, so a narrowed target sees the identical list on either engine. The batch carries
        // no per-id route list — there is no delimiter safe under the id grammar — so the narrowing
        // happens here, one hop later, over a few more bytes on the wire.
        etas: narrowEtasToRoutes(entry.etas, target.routeIds),
        failed: entry.failed ?? [],
      }
    })

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
      if (!('etas' in result)) continue
      // **The same rule as the whole-target one above, one level down** (ADR-073). A place is N
      // boarding poles and an upstream board call is per pole, so a target can come back partially:
      // some kerbs answered, one refused. `retainFailedPoles` keeps the refusing kerb's previous
      // readings — the ones this round did not replace — so they never reach `gone`, and it is the
      // kernel's function rather than this file's, called with the identical arguments by `eta-hub.ts`.
      readings.set(
        result.target.stopId,
        result.failed.length === 0
          ? result.etas
          : retainFailedPoles(
              readings.get(result.target.stopId) ?? [],
              result.etas,
              result.failed.map((f) => f.stopId),
            ),
      )
    }

    const next = flatten()
    const { changed, gone } = diffEtas(sent, next)
    // **A failed first round is not an empty world.** The header's rule — *a failed round is not a
    // departure* — held from round two only: the `seq === 0` branch used to fire whatever came back, so a
    // round in which every request threw published `snapshot { etas: [] }`, which is the frame for "this
    // stop has no arrivals". Downstream, `applyLiveEtasToStopDetail` nulls every row it cannot match (by
    // design, that is `gone`'s honesty rule), the screen loses the minutes it had just painted from its own
    // HTTP fetch, and the blanked document is still `status: 'success'` — so ADR-058's persister dehydrates
    // it and an offline start replays the blank instead of the arrivals it exists to keep. The `retrying`
    // status that would explain it cannot reach a listener that only receives `Eta[]`, and with the Place
    // screen no longer polling while its query succeeds, nothing repaired it for a whole cadence.
    //
    // So: a round that told us **nothing** produces no snapshot. `seq` stays at 0 and the next round that
    // learns something sends it — which is the state a subscription is in before its first successful
    // round, exactly.
    //
    // "Nothing" has to include a permanent rejection, and that distinction is not decoration: the first
    // draft suppressed the snapshot whenever no target *answered*, which took the echo away from the one
    // case that needs it most. A target rejected `retryable: false` leaves `watching`, and the empty
    // snapshot is then not a claim that the stop has no buses — it is the accepted-set echo saying *we are
    // not watching what you asked for*, which is the only signal a rider gets that a saved favourite has
    // stopped resolving (ADR-008's no-silent-filter rule, and `SnapshotFrame.targets`' whole purpose).
    // Caught by the `nothing left to watch closes the subscription` row going red, which is the row that
    // exists for precisely this shape.
    // Every failure this round should be reported for, in `watching` order and — inside one target —
    // in the order the wire listed its poles. One flat list rather than two loops, because `eta-hub.ts`
    // builds the identical sequence from the identical `EtaReport` and a round carrying both kinds
    // would otherwise order them differently on the two engines. A target either failed outright or
    // answered (possibly partially), never both, so nothing is reported twice.
    const reportable: WireError[] = results.flatMap((result) =>
      'error' in result ? [result.error] : result.failed.map((f) => f.error),
    )
    const answered = results.some((result) => 'etas' in result)
    const dropped = failed.some(({ error }) => !error.retryable)
    if (seq === 0 && (answered || dropped)) {
      seq = 1
      sent = next
      emit({
        type: 'snapshot',
        seq,
        at: frameAt(deps.clock.now()),
        targets: watching,
        etas: next,
      })
    } else if (seq > 0 && dropped) {
      // **A mid-stream drop re-echoes the accepted set, and it takes a snapshot to do it.** A `delta`
      // carries readings and cannot restate membership — only a `snapshot` has `targets` — so a target
      // that stops resolving after the first round would otherwise leave the client holding an accepted
      // set naming a pole nobody polls. The rider is then shown "no buses due" for a stop we are not
      // watching, which is the silent filter ADR-008 rules out and the exact thing
      // `SnapshotFrame.targets` exists to prevent.
      //
      // This is a divergence the shard found first: `EtaHub` re-echoes on a round-time drop, and this
      // engine's re-echo was gated on `seq === 0`, so the two engines answered the same upstream
      // differently after round one. The scenario matrix could not see it, because its hand-written
      // scripts describe what *this* engine does — which is the honest limit of comparing two engines
      // against a script rather than against each other.
      seq += 1
      sent = next
      emit({
        type: 'snapshot',
        seq,
        at: frameAt(deps.clock.now()),
        targets: watching,
        etas: next,
      })
    } else if (seq > 0 && (changed.length > 0 || gone.length > 0)) {
      seq += 1
      sent = next
      emit({ type: 'delta', seq, at: frameAt(deps.clock.now()), changed, gone })
    }
    // else: nothing changed, so nothing is sent. See the header.

    for (const error of reportable) status('retrying', error)
    // A `status` frame is a **transition, not a heartbeat**. `live` goes out on the first complete round
    // and again after a recovery, and nothing in between: a frame every round saying "still fine" would
    // repaint every screen every cadence, which is the cost the delta protocol exists to avoid. The flag
    // is reset by any failure — including a *partial* one, because a place whose second kerb refused is
    // not a place we are fully live on, and a rider whose row has stopped moving should not be told
    // otherwise. Without the reset a screen labelled "reconnecting" keeps that label for ever while
    // data flows in behind it.
    if (reportable.length > 0) announcedLive = false
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
