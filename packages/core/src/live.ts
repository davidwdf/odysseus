// The live-protocol rules: what a frame means, what a client does with it, and how a socket is
// addressed. Every function here is pure, takes what it needs as an argument, and would produce the
// same bytes on a phone, in a Worker and in a Swift test.
//
// **Why the rules are here and the transport is not.** The kernel may hold no timer, no clock and no
// socket — `layers.json` denies `setTimeout`, `setInterval`, `WebSocket`, `fetch`, the clock reads
// `Date.now` and a bare `new Date`, `Math.random` and `toLocale*` in this package, and
// `scripts/boundaries/check.mjs` enforces it. (It enforces it by matching raw source lines, with no
// comment stripper — unlike the other `check-*.mjs` gates, which all argue at length that a gate
// flagging its own documentation would be deleted within a week. So a file in this package cannot
// *spell* the forms it is forbidden to call, which is why the sentence above reads oddly. Recorded in
// the WP5-1 report as a gap rather than worked around silently.)
// That is not asceticism. Two of these rules are the *same* declaration used by two
// different runtimes — `diffEtas` runs in the client poll emulator **and** in the `EtaHub` Durable
// Object, `acceptTargets` decides the accepted set on both sides — and a function that read a clock or
// opened a connection could not be shared, so each side would grow its own copy and the copies would
// disagree about a departed bus. The transport lives in `packages/api-client` (`client` layer) and
// `apps/edge` (`server`); what a frame *means* lives here, once.
//
// **The one decision the whole module rests on: output is canonically ordered.** Every list these
// functions return is sorted by `(stopId, routeId)` in code-point order — no locale, no arrival time.
// WP5-1's acceptance is byte-identical listener output from the poll emulator and a socket fake, and
// without a total order that criterion cannot be met by *any* implementation: the poll emulator
// re-fetches whole lists and inherits the server's order, while a socket applies deltas in place and
// ends up with an order that depends on the history of the connection. Two transports, two orders,
// same data. So the order is data (ADR-063 learned this for the search index), and nothing is lost
// because display order is `nearbyView`/`stopCardView`'s job — with the one exception documented at
// `applyLiveEtasToNearby`, which is a *card* ordering rather than a listener one.

// The path is declared in the contract (`LIVE_PATH`) because it is part of the wire, and imported here
// **as a type** so the kernel keeps its empty runtime dependency list (ADR-052 decision 2). See the
// note on the constant below for why a restated literal is not a second declaration.
import type { LIVE_PATH as WireLivePath } from '@nextbus/contract'
import { formatFavoriteRouteKey, memberStopIds, parseRouteId, parseStopOrPlaceId } from './ids'
import type {
  DeltaFrame,
  Eta,
  EtaRef,
  LiveState,
  NearbyStop,
  ServerFrame,
  SnapshotFrame,
  StopDetail,
  WatchTarget,
  WireError,
} from './types'

// `@spec <module>#<export>` below means: that export's behaviour is pinned by the language-neutral
// JSON corpus at `../spec/<module>.spec.json`, group `<export>`. These are **domain rules** — the
// one kind of change no schema can generate (ADR-052 context, kind 2), so they are hand-ported to
// Swift and Kotlin and the corpus is the only thing keeping the ports equal. Change a rule and you
// edit the corpus; every platform's suite then goes red until it has been ported.
// `scripts/check-spec-coverage.mjs` fails a tagged export with no corpus **and** a corpus with no tag.

// ── Constants ───────────────────────────────────────────────────────────────────────────────

/**
 * The socket path, restated here and **pinned to the contract's declaration by the type system**.
 *
 * `packages/contract` exports `LIVE_PATH = '/v1/live'`; that is the declaration, and the AsyncAPI
 * channel address and the Worker's router read it directly. This module cannot: `core → contract` is
 * `import type` only, so a runtime string cannot cross that boundary — the same constraint that put
 * `CLIENT_POLICY_DEFAULTS`' *values* in `policy.ts` while their *shape* stayed in the contract.
 *
 * What makes the restatement safe rather than a second source of truth is the annotation:
 * `typeof WireLivePath` is the literal type `'/v1/live'`, so changing the contract's constant makes
 * **this line a typecheck error** — verified by changing it and watching `tsc` fail, not assumed. A
 * plain `const LIVE_PATH = '/v1/live'` here would have been exactly the silent-copy problem this repo
 * spends its gates on.
 *
 * Not exported: one public declaration of the path is enough, and it is the contract's.
 */
const LIVE_PATH: typeof WireLivePath = '/v1/live'

/**
 * The fastest cadence a shard will poll upstream, and the slowest.
 *
 * **45 s is the floor because that is the data's own floor.** Measured 2026-07-30 against
 * `data.etabus.gov.hk` (one KMB route, 20 samples at 10 s, off-peak): distinct `data_timestamp` values
 * arrived at intervals of 32, 59, 60 and 28 s — mean **44.75 s**, range 28–60 s. A faster alarm
 * returns a byte-identical body most rounds, and cannot even reliably see a fresher origin: every
 * response carried `Cache-Control: max-age=300`, and `generated_timestamp` was observed going
 * *backwards* between consecutive polls (independent CDN edges), so polling harder is not merely
 * wasteful — it is non-monotonic. That is n=4 intervals on one route on one morning: a first
 * measurement, not a characterisation, and peak hours and CTB/GMB are unmeasured.
 *
 * The ceiling is 60 s, the vendor's stated refresh interval (`docs/02`, citing the KMB ETA API
 * specification). Between them the rule below widens as nothing changes, which is what makes an idle
 * shard cheap: Cloudflare hibernates an object after 10 s of inactivity and a hibernated object accrues
 * **no** duration charge, so at this cadence a shard is asleep for 35–50 s of every cycle. The
 * *cost* case for 45–60 s over 15 s is weaker than the repo's cost model claims — once sharded, the
 * marginal cost of a 15 s alarm is on the order of $10/month per 1000 hot stops, which is an estimate
 * built from published rates and not a measurement — so the argument to lean on is the data one above,
 * which holds at any scale.
 */
export const LIVE_CADENCE_FLOOR_MS = 45_000
/** See `LIVE_CADENCE_FLOOR_MS`. The vendor's stated upstream refresh interval. */
export const LIVE_CADENCE_CEILING_MS = 60_000
/**
 * How many consecutive unchanged rounds it takes to reach the ceiling.
 *
 * Three, so the ramp is 45 → 50 → 55 → 60 s in whole seconds. A named constant rather than a `3` in
 * the expression because a hand-port would otherwise transcribe an unexplained integer, and because the
 * ramp's shape — linear, bounded, one step per quiet round — is the part a reviewer should be able to
 * disagree with.
 */
export const LIVE_CADENCE_RAMP_ROUNDS = 3

/**
 * How many `EtaHub` shards exist (D4).
 *
 * The client never sees this number: it connects to `/v1/live?targets=…` and the **Worker** derives the
 * shard, precisely so a client compiled against a stale count cannot silently land somewhere else. It
 * is exported because the Worker needs it and because `liveShardFor`'s corpus pins the arithmetic
 * against it.
 */
export const LIVE_SHARD_COUNT = 8

/**
 * The reconnect schedule: where it starts, how fast it widens, and where it stops widening.
 *
 * **Why these live in the kernel when the timer that uses them does not.** The numbers used to sit in
 * `packages/api-client/src/live/socket.ts`, whose port declaration claimed the policy was *"written down
 * once"* — in a file iOS and Android cannot read, in the same breath as naming
 * `URLSessionWebSocketTask` and OkHttp as their implementations. So on the two platforms the port exists
 * for, the policy was written down nowhere. The repo's own test for kernel membership settles it: the
 * schedule is a pure rule over plain data whose only nondeterminism is an injected jitter, exactly the
 * argument that keeps `nextLiveCadenceMs` here — a server-only ramp with a single consumer and twelve
 * corpus rows, on the ground that a hand-port would otherwise transcribe an unexplained integer. A
 * *client* rule that three platforms each reconnect by has a stronger claim than that, not a weaker one.
 *
 *  · **1 s to start.** Short enough that a connection dropped in a tunnel repairs itself before a rider
 *    notices; long enough not to be a tight loop against a Worker that is refusing the upgrade.
 *  · **Doubling to a 30 s cap.** 1 → 2 → 4 → 8 → 16 → 30 → 30 … The cap matters more than the growth: an
 *    uncapped exponential reaches an hour, and a screen left open all afternoon on a bad connection would
 *    then take an hour to notice the network came back. 30 s is below the shard's own 45–60 s poll
 *    cadence (`LIVE_CADENCE_FLOOR_MS`), so a reconnect landing inside one cycle loses no data at all.
 *
 * *When* to try again — the timer, the attempt counter, and "reset on a frame, not on an open" — stays in
 * `createSocketTransport`, where a test can watch the second attempt happen at the right moment. This is
 * the arithmetic only.
 */
export const LIVE_RECONNECT_INITIAL_MS = 1_000
/** See `LIVE_RECONNECT_INITIAL_MS`. Doubling; `1` would be a constant-delay policy, below `1` a tight loop. */
export const LIVE_RECONNECT_FACTOR = 2
/** See `LIVE_RECONNECT_INITIAL_MS`. Below the shard's poll cadence, so a reconnect inside one cycle loses nothing. */
export const LIVE_RECONNECT_MAX_MS = 30_000

/**
 * How often a client pings to hold a socket open.
 *
 * Deliberately a **separate** constant from `LIVE_RECONNECT_MAX_MS` despite sharing its value: they are
 * two unrelated round numbers, and a hand-port that folded them together would tie a keepalive interval
 * to a backoff cap for ever. One incoming ping every 30 s is the cheapest thing a client can send —
 * incoming protocol pings are not billed and Cloudflare's hibernation auto-response answers them
 * **without waking the shard**, provided the bytes match `LIVE_PING_MESSAGE` exactly. Chosen to sit well
 * inside the idle timeouts intermediaries impose, and **not** a measurement: WP0-5 has not happened, so
 * there is no deployment to have measured one against. Revisit it with the first real socket.
 */
export const LIVE_KEEPALIVE_MS = 30_000

/**
 * A session that has applied nothing yet.
 *
 * `seq: 0` is the sentinel, and it is load-bearing: the wire's counter starts at 1, so "`seq` is 0"
 * means "no snapshot has ever landed" without needing a fourth field to say so. `applyLiveFrame` reads
 * it that way — a `delta` arriving against `seq: 0` is applied *and* reported as needing a resync,
 * because a delta is a description of a change to a state we do not have.
 */
export const LIVE_SESSION_START: LiveSession = {
  seq: 0,
  etas: [],
  targets: [],
  status: { state: 'connecting' },
}

// ── Shapes ──────────────────────────────────────────────────────────────────────────────────

/** The transport's own state, and the failure that put it there — a `StatusFrame` minus its envelope. */
export interface LiveStatus {
  state: LiveState
  /** Present only when `state` reflects a failure. */
  error?: WireError
}

/** Everything a subscribed screen holds between frames. */
export interface LiveSession {
  /** The `seq` of the last data frame applied; `0` before any snapshot. */
  seq: number
  /** Every current reading, in canonical `(stopId, routeId)` order. */
  etas: readonly Eta[]
  /**
   * The target set the server said it **accepted**, from the last `snapshot`. Empty before any.
   *
   * **This field is the reader `SnapshotFrame.targets` was published for, and it did not exist.** The
   * frame carries the accepted set precisely so a client can compare it with what it asked for —
   * *"compare it with what you sent and tell the rider about the difference"*, in the schema's own words
   * — and both producers deliberately send no other signal for a dropped target (the shard's `subscribe`
   * and the poll emulator's `subscribe` both say so at the emit). The reducer used to drop it on the
   * floor, so on every platform the comparison was unperformable: a rider whose saved pole had stopped
   * resolving was shown *"no buses due"* for a stop nobody was watching. That is the silent filter
   * ADR-008 rules out as firmly as a fake countdown, and it read as a data outage rather than as a stale
   * favourite.
   *
   * Carried **verbatim**, never re-derived. Running `acceptTargets` over the echo would filter the
   * server's answer through the client's own opinion of which ids are legal, and the two could then
   * disagree with nothing to say so — which is the reason the client sends `?targets=` unfiltered in the
   * first place (see the connect URL in `packages/api-client/src/live/socket.ts`). What the server
   * accepted is a statement of fact about the subscription, not a derivation.
   *
   * A `delta`, a `status` and a `pong` all leave it exactly as it was: only a `snapshot` restates the
   * set, which is why a round that *changes* the accepted set has to send one (the shard does).
   */
  targets: readonly WatchTarget[]
  status: LiveStatus
}

/** What `applyLiveFrame` returns: the next session, and the two things the caller must act on. */
export interface LiveApplyResult {
  state: LiveSession
  /**
   * False when the frame was deliberately not acted on — a `pong`, or a `delta` whose `seq` has
   * already been seen. A caller can skip a repaint on `false`; nothing else about it is an error.
   */
  applied: boolean
  /**
   * True when this session can no longer be trusted to be complete and the caller should ask for a
   * fresh snapshot (re-`subscribe`, or reconnect). Reported rather than thrown, because a frame that
   * arrives out of order still carries real data and discarding it would leave the screen further
   * behind than the data we were just handed.
   */
  resyncNeeded: boolean
}

// ── Ordering ────────────────────────────────────────────────────────────────────────────────

/**
 * Code-point string order. **Not `localeCompare`** — that is banned in this package because the host's
 * ICU and the device's locale decide its answer, so it cannot be hand-ported or pinned by a fixture
 * (ADR-063 hit this with the search index's `sortKey`).
 *
 * JavaScript's `<` compares UTF-16 code *units*, which differs from code points only above the BMP.
 * Every id this comparator sees is canonical and the grammar's `idchar` is printable ASCII
 * (`packages/core/src/ids.ts`), so the two coincide — and a Swift `<` on `String.UnicodeScalarView` or
 * a Kotlin `compareTo` agrees. That is why these functions sort *parsed* ids and not arbitrary text.
 */
function compareCodePoints(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** The canonical order for anything identified by a route-at-stop pair: stop first, then route. */
function compareRefs(a: EtaRef, b: EtaRef): number {
  const byStop = compareCodePoints(a.stopId, b.stopId)
  if (byStop !== 0) return byStop
  return compareCodePoints(a.routeId, b.routeId)
}

/**
 * Index readings by their identity, **last occurrence winning**.
 *
 * The key is `formatFavoriteRouteKey`'s `<stopId>|<routeId>` (D3) rather than a fresh spelling, and the
 * reason is not tidiness: `|` is one of the three structural characters the id grammar forbids inside
 * any field, so the concatenation is unambiguous. A hand-rolled `` `${stopId}:${routeId}` `` would not
 * be — route ids contain colons — and it would collide silently, which is the failure `ids.ts` exists
 * to prevent.
 *
 * Last-wins because a server that sends the same pair twice in one frame is telling us something twice
 * and the later statement is the newer one. A `Map` also fixes iteration order at first insertion,
 * which is why every caller sorts afterwards rather than trusting it.
 */
function indexByRef(etas: readonly Eta[]): Map<string, Eta> {
  const index = new Map<string, Eta>()
  for (const eta of etas) index.set(formatFavoriteRouteKey(eta.stopId, eta.routeId), eta)
  return index
}

/** Dedupe by identity and sort canonically — the shape every list in a frame and a session has. */
function canonicalEtas(etas: readonly Eta[]): Eta[] {
  return [...indexByRef(etas).values()].sort(compareRefs)
}

// ── Is this reading news? ───────────────────────────────────────────────────────────────────

/** Element-wise string equality. `arrivals` is an ordered list and its order is meaningful. */
function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((value, i) => value === b[i])
}

/** Localized text, or its absence. Absent and present-but-empty are different readings. */
function sameText(a: Eta['destination'], b: Eta['destination']): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.en === b.en && a['zh-Hant'] === b['zh-Hant'] && a['zh-Hans'] === b['zh-Hans']
}

/**
 * Every field of `Eta` that makes a reading *different*, one comparator each.
 *
 * The mapped type is the point: `{ [K in Exclude<keyof Eta, 'observedAt'>]: … }` means adding a field
 * to `EtaSchema` **stops this file compiling** until somebody decides whether the new field makes a
 * reading new. Without it, a new field would silently be ignored by the delta protocol — the reading
 * would change on the wire and the client would never repaint, which is the kind of defect that is
 * found by a rider and not by a test. (Same trick as `ERROR_CODES`' `satisfies Record<…>` in the
 * contract, and `_BoundsAreExhaustive` in `ids.ts`.) It is a map of functions rather than a list of
 * names so that it is *used* — an exhaustiveness declaration nothing reads is one refactor away from
 * being deleted as dead code.
 *
 * **`observedAt` is excluded, and that exclusion is the delta protocol.** It records when *we* fetched
 * a reading, so it changes on every single poll round. Include it and every round reports every
 * reading as changed: the `delta` frame degenerates into a `snapshot` with extra steps, the screen
 * repaints continuously, and `isStale` — which reads `dataTimestamp`, the operator's clock — would be
 * the only thing in the system still telling the truth about age.
 */
const COMPARED_FIELDS: { [K in Exclude<keyof Eta, 'observedAt'>]: (a: Eta, b: Eta) => boolean } = {
  routeId: (a, b) => a.routeId === b.routeId,
  stopId: (a, b) => a.stopId === b.stopId,
  operator: (a, b) => a.operator === b.operator,
  arrivals: (a, b) => sameStrings(a.arrivals, b.arrivals),
  destination: (a, b) => sameText(a.destination, b.destination),
  fare: (a, b) => a.fare === b.fare,
  remark: (a, b) => sameText(a.remark, b.remark),
  remarkKind: (a, b) => a.remarkKind === b.remarkKind,
  dataTimestamp: (a, b) => a.dataTimestamp === b.dataTimestamp,
}

/**
 * Are these the same reading — i.e. is the second one *not news*?
 *
 * Compares every field of `Eta` except `observedAt`; see `COMPARED_FIELDS` for why that one is out and
 * why the comparison is a typed map rather than a chain of `&&`.
 *
 * @spec live#sameReading
 */
export function sameReading(a: Eta, b: Eta): boolean {
  for (const compare of Object.values(COMPARED_FIELDS)) {
    if (!compare(a, b)) return false
  }
  return true
}

/**
 * What changed between two sets of readings, and what is gone.
 *
 * **One declaration, two runtimes.** The `EtaHub` Durable Object calls this to build the `delta` it
 * sends; the poll emulator in `packages/api-client` calls it to build the *same* frame from two
 * successive HTTP fetches, so the socket engine and the polling engine emit byte-identical frames from
 * identical data. That is what makes WP5-1's scenario matrix a real test rather than two
 * implementations agreeing by luck.
 *
 * `gone` is not an optimisation (D2). Polling replaces the whole payload, so a departed bus disappears
 * for free; a delta protocol without `gone` leaves its last reading on screen for ever, ageing
 * silently — exactly the dishonesty ADR-008 forbids.
 *
 * @spec live#diffEtas
 */
export function diffEtas(
  prev: readonly Eta[],
  next: readonly Eta[],
): { changed: Eta[]; gone: EtaRef[] } {
  const before = indexByRef(prev)
  const after = indexByRef(next)

  const changed: Eta[] = []
  for (const [key, eta] of after) {
    const previous = before.get(key)
    if (previous === undefined || !sameReading(previous, eta)) changed.push(eta)
  }

  const gone: EtaRef[] = []
  for (const [key, eta] of before) {
    if (!after.has(key)) gone.push({ stopId: eta.stopId, routeId: eta.routeId })
  }

  return { changed: changed.sort(compareRefs), gone: gone.sort(compareRefs) }
}

// ── The reducer ─────────────────────────────────────────────────────────────────────────────

/** A snapshot: the server's whole truth replaces ours, whatever `seq` it carries. See `applyLiveFrame`. */
function applySnapshot(frame: SnapshotFrame, state: LiveSession): LiveApplyResult {
  return {
    state: {
      seq: frame.seq,
      etas: canonicalEtas(frame.etas),
      // Verbatim, and unlike `etas` it is not re-canonicalised — see `LiveSession.targets` for why the
      // server's answer must not be filtered through the client's own rules. Both producers already
      // send `acceptTargets(...).accepted`, which is canonical, so the two engines still agree byte for
      // byte (D1) without this line asserting it.
      targets: frame.targets,
      status: state.status,
    },
    applied: true,
    resyncNeeded: false,
  }
}

/** A delta: merge `changed` by identity, drop `gone`, re-canonicalise. See `applyLiveFrame`. */
function applyDelta(frame: DeltaFrame, state: LiveSession): LiveApplyResult {
  const merged = indexByRef(state.etas)
  for (const eta of frame.changed) merged.set(formatFavoriteRouteKey(eta.stopId, eta.routeId), eta)
  for (const ref of frame.gone) merged.delete(formatFavoriteRouteKey(ref.stopId, ref.routeId))
  return {
    state: {
      seq: frame.seq,
      etas: [...merged.values()].sort(compareRefs),
      // A delta describes readings, never membership. Only a `snapshot` restates the accepted set, so a
      // shard that drops a target mid-round sends one instead of a delta — otherwise the echo the rider's
      // screen is comparing against would go on naming a stop nobody polls.
      targets: state.targets,
      status: state.status,
    },
    applied: true,
    // Two reasons the session may now be incomplete, and underneath they are one reason: we are
    // missing a frame. A gap (`seq` beyond the next one) means one was lost in flight. `state.seq === 0`
    // means we have never had a snapshot at all, so we have just merged a *description of a change*
    // into a state we never received — and the arithmetic does not catch that on its own, because a
    // delta at `seq: 1` against `seq: 0` looks exactly like "the next frame". Both halves are needed;
    // the first draft of this line had only the gap test and the corpus row
    // `a-delta-before-any-snapshot-applies-and-asks-for-a-resync` is what found it.
    resyncNeeded: state.seq === 0 || frame.seq !== state.seq + 1,
  }
}

/**
 * Apply one server frame to a session. The whole client-side protocol, as a pure function.
 *
 * The rules, each with corpus rows:
 *
 *  · **`snapshot` replaces `etas` wholesale, and restates the accepted target set** — the one frame that
 *    does. `targets` is kept verbatim so a caller can diff it against what it asked for; see
 *    `LiveSession.targets` for the defect a dropped echo produces. It also sets `seq`, and it applies
 *    *whatever* `seq` it carries — including one at or below the current value, and that asymmetry with `delta` is deliberate: a
 *    snapshot is the recovery path. Refusing an "old" snapshot would make recovery unreachable exactly
 *    when it is needed — a shard that restarted and reset its counter would be ignored for ever.
 *  · **`delta` merges `changed` by identity and removes `gone`**, then sets `seq`.
 *  · **A `delta` at or below the current `seq` is ignored**, and reported as needing a resync rather
 *    than silently dropped. On an ordered transport a counter that repeats or goes backwards is not a
 *    late frame — it is a *different producer* (a reconnect whose frames interleaved, a restarted
 *    shard), and the only cure is a fresh snapshot. This is the one rule this module's brief did not
 *    settle; it is recorded here because "ignored and everything is fine" would wedge the session.
 *  · **A `delta` with a gap, or before any snapshot, is applied anyway** and reports `resyncNeeded`.
 *  · **`status` updates `status` only** — never `etas`, and never the accepted set. A reconnecting client
 *    keeps showing the readings it has, labelled, because a 40-second-old reading with an honest label is
 *    more use at a kerb than an empty screen; and it keeps the echo, because the frame that tells a rider
 *    one favourite was refused is a `status` frame arriving *after* the snapshot that names the survivors.
 *  · **`pong` is not a state change.** It is liveness, and on Cloudflare it is answered by the runtime
 *    without the object waking, so it may not even have been produced by our own code.
 *
 * The result is always canonically ordered — see the module header. That is the property that makes the
 * poll emulator and a socket produce identical listener output, and it is why the reducer re-sorts
 * instead of merging in place.
 *
 * @spec live#applyLiveFrame
 */
export function applyLiveFrame(state: LiveSession, frame: ServerFrame): LiveApplyResult {
  switch (frame.type) {
    case 'snapshot':
      return applySnapshot(frame, state)
    case 'delta':
      if (frame.seq <= state.seq) return { state, applied: false, resyncNeeded: true }
      return applyDelta(frame, state)
    case 'status':
      return {
        state: {
          seq: state.seq,
          etas: state.etas,
          // Kept, and this is the case that matters most for it: the shard reports a rejected favourite
          // as `state: 'live'` with a `retryable: false` error *alongside* the snapshot whose echo says
          // which targets survived. A `status` frame that reset the accepted set would erase the answer
          // one frame after it arrived, leaving the rider's five working stops and no way to name the
          // sixth.
          targets: state.targets,
          status:
            frame.error === undefined
              ? { state: frame.state }
              : { state: frame.state, error: frame.error },
        },
        applied: true,
        resyncNeeded: false,
      }
    case 'pong':
      return { state, applied: false, resyncNeeded: false }
    default: {
      // A frame type this build has never heard of. `core` performs **no runtime validation** — its
      // contract imports are types and erase completely (ADR-052 decision 2) — so an added server frame
      // reaches this switch as an ordinary unmatched string on every already-installed client. Ignoring
      // it is the tolerant behaviour the wire contract promises (`x-unknown-tolerant`); throwing would
      // turn one additive protocol change into a crash on phones we cannot update.
      //
      // The annotation is the other half: `frame` is `never` here today, so **adding a member to
      // `ServerFrameSchema` makes this line a typecheck error** until the new frame is handled on
      // purpose. Compile-time exhaustiveness and runtime tolerance are different requirements and this
      // is what it costs to have both.
      const unhandled: never = frame
      void unhandled
      return { state, applied: false, resyncNeeded: false }
    }
  }
}

// ── Targets ─────────────────────────────────────────────────────────────────────────────────

/**
 * Which of these targets can be watched, and which cannot.
 *
 * **Both transports call this**, which is the point: a favourite whose id no longer parses is dropped
 * *identically* by the poll emulator and by the socket, and the caller receives the rejects so it can
 * say "we are not watching this one" instead of showing a short list and letting the rider work it out.
 * A silently short list is the same class of dishonesty as a fake countdown (ADR-008).
 *
 * Three rejection rules, and the two the brief did not settle are recorded here rather than discovered
 * later:
 *
 *  · An unparseable `stopId` — the ordinary case, a favourite saved under an older id scheme.
 *  · **An empty `routeIds` array**, because it asks for no routes at all: a subscription that cannot
 *    ever produce a reading, which on screen is indistinguishable from a stop with no buses due.
 *    Absent `routeIds` means *all* routes and is the normal case; `[]` is a caller bug, so it is
 *    rejected loudly rather than silently treated as "all".
 *  · **A target with any unparseable `routeId` is rejected whole**, not narrowed to the ids that did
 *    parse. Dropping one route id quietly changes *which buses the rider is watching* — the same
 *    reasoning that makes one bad member invalidate a whole place id in `parsePlaceId`.
 *
 * The accepted set is **canonical**: one entry per `stopId`, sorted, with `routeIds` sorted too. Two
 * targets for the same stop are merged by **union**, never by dropping one — and if either asks for all
 * routes, the merge asks for all routes, since a union with "everything" is everything. Merging rather
 * than dropping matters because a dropped duplicate would silently narrow the subscription while
 * `rejected` stayed empty, so nothing anywhere would say a route had been lost.
 *
 * `rejected` keeps input order: it is a local diagnostic a caller lists back to the rider, and input
 * order is the order they will recognise. Only the accepted set feeds the wire, so only it needs to be
 * canonical.
 *
 * @spec live#acceptTargets
 */
export function acceptTargets(targets: readonly WatchTarget[]): {
  accepted: WatchTarget[]
  rejected: WatchTarget[]
} {
  /** `null` routeIds means "every route at this stop" — the absorbing element of the union. */
  const merged = new Map<string, Set<string> | null>()
  const rejected: WatchTarget[] = []

  for (const target of targets) {
    if (parseStopOrPlaceId(target.stopId) === null) {
      rejected.push(target)
      continue
    }
    const routeIds = target.routeIds
    if (
      routeIds !== undefined &&
      (routeIds.length === 0 || routeIds.some((id) => parseRouteId(id) === null))
    ) {
      rejected.push(target)
      continue
    }
    // Three states, and `undefined` versus `null` is the distinction that makes a single `get` enough:
    // a *stored* value is never `undefined` — only a `Set` or `null` is ever stored — so `undefined`
    // unambiguously means "not seen yet". A `has` followed by a `get` would need a fourth branch for
    // the case the type system cannot rule out but the code cannot reach, and an unreachable branch in
    // this package is a coverage failure by design (`vitest.config.ts` holds the line at 100%).
    const existing = merged.get(target.stopId)
    if (existing === undefined) {
      merged.set(target.stopId, routeIds === undefined ? null : new Set(routeIds))
    } else if (existing === null || routeIds === undefined) {
      merged.set(target.stopId, null)
    } else {
      for (const id of routeIds) existing.add(id)
    }
  }

  const accepted = [...merged.entries()]
    .sort((a, b) => compareCodePoints(a[0], b[0]))
    .map(([stopId, routeIds]) =>
      routeIds === null ? { stopId } : { stopId, routeIds: [...routeIds].sort(compareCodePoints) },
    )

  return { accepted, rejected }
}

// ── Cadence and routing ─────────────────────────────────────────────────────────────────────

/**
 * A finite, strictly positive number, or the fallback.
 *
 * The twin of `resolveClientPolicy`'s `usable()`, and the reasoning is transplanted whole: every number
 * these two rules take is a count or a duration, so zero and negative are not aggressive settings but a
 * misconfiguration, and a mistake should fall back to a value we know works rather than produce a `NaN`
 * nobody can trace to its origin. Not shared with `policy.ts` because neither is exported and a
 * cross-module private helper for a three-clause predicate would buy one line at the cost of a
 * dependency; shared *within* this module because the alternative was two copies of it four functions
 * apart, which is how the copies start disagreeing.
 *
 * The `typeof` clause is not belt-and-braces. Nothing in this package validates (ADR-052 decision 2), so
 * a subscriber count or a backoff read from an environment variable arrives as a string typed as a
 * number, and `'4' * 2` is `8` while `'a' * 2` is `NaN`.
 */
function positiveOr(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return value
}

/** `positiveOr` for a value where **zero is meaningful** — a jitter of 0 is the bottom of its band. */
function finiteOr(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return value
}

/**
 * How long until a shard should poll upstream again — or `null` for "do not set an alarm at all".
 *
 * `null` is the whole economy of this design. A Durable Object with no subscribers and no alarm
 * hibernates, and a hibernated object accrues **no** duration charge; one that keeps an alarm ticking
 * to find out nobody is listening pays for every tick, plus a metered row write per `setAlarm`. So the
 * absence of an alarm is the feature, and it is expressed as a value the caller cannot ignore rather
 * than as a `0` that would read as "immediately".
 *
 * Otherwise the cadence starts at the floor and widens one step per consecutive unchanged round until
 * it reaches the ceiling: 45 → 50 → 55 → 60 s. Both ends are justified at `LIVE_CADENCE_FLOOR_MS` from
 * a measurement, and the ramp exists because a pole that has said nothing for two minutes is very
 * likely to keep saying nothing — while a pole that just changed is worth asking again promptly.
 *
 * A non-positive or unusable `subscribers` is treated as none, and a negative or fractional
 * `unchangedRounds` as zero, on the same reasoning as `resolveClientPolicy`'s `usable()`: these numbers
 * arrive from a live count and a counter, and a nonsense value should fall back to a cadence we know
 * works rather than produce a `NaN` alarm nobody can trace.
 *
 * @spec live#nextLiveCadenceMs
 */
export function nextLiveCadenceMs(input: {
  subscribers?: number
  unchangedRounds?: number
}): number | null {
  // `positiveOr(…, 0)` and then `< 1`, rather than the predicate written out here twice: a fractional
  // subscriber count is as much a misconfiguration as a negative one and both mean "nobody is listening".
  if (positiveOr(input.subscribers, 0) < 1) return null

  const quiet = Math.floor(positiveOr(input.unchangedRounds, 0))
  const step = (LIVE_CADENCE_CEILING_MS - LIVE_CADENCE_FLOOR_MS) / LIVE_CADENCE_RAMP_ROUNDS
  return Math.min(LIVE_CADENCE_CEILING_MS, LIVE_CADENCE_FLOOR_MS + quiet * step)
}

/**
 * How long a client should wait before its `attempt`-th reconnect — the whole schedule, as arithmetic.
 *
 * `Math.min(maxMs, initialMs · factor^(attempt − 1))`, then **half jitter**: the answer is always inside
 * `[capped / 2, capped]`. Every client watching a shard that restarts is disconnected in the same instant,
 * and a fixed delay would bring all of them back simultaneously — precisely the load a restarted shard
 * cannot take. Half rather than full jitter because full jitter can produce a near-zero delay, which is
 * the thundering herd again with extra steps.
 *
 * **Why this is here rather than in the socket that calls it.** See `LIVE_RECONNECT_INITIAL_MS`: the
 * policy was a client-layer secret while the port that declares the socket named iOS and Android as its
 * implementations, so the one artefact a reviewer or a hand-porter could disagree with did not exist. It
 * is pure arithmetic over plain data — the jitter is *injected*, not read — so it is corpus-expressible,
 * and every platform's suite now goes red until the schedule is ported. The timer, the attempt counter and
 * "reset on a frame, not on an open" stay in `createSocketTransport`, which is where they are observable.
 *
 * `jitter` is a number and not a function on purpose: a callback cannot be written in a JSON fixture, and
 * a rule that cannot be stated in the corpus is a rule three platforms will each invent.
 *
 * Nonsense input falls back the same way `nextLiveCadenceMs`' does and for the same reason (`positiveOr`):
 * `attempt` below one, fractional or unusable is the **first** attempt, so a broken counter waits rather
 * than hammering; a `factor` under 1 would *shrink* the delay each time, which is a tight loop against a
 * server that has just refused us, so it is floored at 1. An unusable `jitter` falls back to the top of
 * the band — `capped`, the plain exponential delay the policy would have had without jitter at all, which
 * is the honest answer when the jitter source itself is the thing that is broken.
 *
 * @spec live#liveReconnectDelayMs
 */
export function liveReconnectDelayMs(input: {
  attempt?: number
  /**
   * `0`…`1`. The host's random source in production, injected by the caller; a constant in a test
   * asserting the schedule. (Spelling that source's name here would fail `pnpm boundaries` — its
   * banned-syntax half matches raw source lines with no comment stripper, recorded in the WP5-1 report.)
   */
  jitter?: number
  initialMs?: number
  factor?: number
  maxMs?: number
}): number {
  const initialMs = positiveOr(input.initialMs, LIVE_RECONNECT_INITIAL_MS)
  const maxMs = positiveOr(input.maxMs, LIVE_RECONNECT_MAX_MS)
  const factor = Math.max(1, positiveOr(input.factor, LIVE_RECONNECT_FACTOR))
  // `Math.max(1, …)` after the floor, not before it: `positiveOr` already rules out zero and negatives,
  // but `Math.floor(0.5)` is `0`, and an exponent of −1 would make the first retry *faster* than the
  // initial delay — the one arithmetic slip in this expression that produces a tight loop rather than a
  // wrong-but-safe number.
  const attempt = Math.max(1, Math.floor(positiveOr(input.attempt, 1)))
  // Clamped rather than rejected: a jitter source that overshoots its range is still telling us something
  // in the right direction, and clamping keeps the result inside the band the policy promises.
  const jitter = Math.min(1, Math.max(0, finiteOr(input.jitter, 1)))

  const capped = Math.min(maxMs, initialMs * factor ** (attempt - 1))
  return Math.round(capped / 2 + jitter * (capped / 2))
}

/**
 * Which `EtaHub` shard owns this target set (D4).
 *
 * Sort the accepted stop ids, hash the lowest, take it modulo the shard count. Two clients watching the
 * same places therefore land on the same shard and share one upstream poll — the case that matters,
 * since a hot stop is hot because many people are looking at it. Clients with *partially* overlapping
 * sets can duplicate a poll across shards; that is bounded by `shardCount` and is the price of "one
 * socket per client", which is the UX property the whole design is for.
 *
 * **FNV-1a, and not `crypto`.** The kernel may not touch `crypto` (`layers.json` denies the global) and
 * should not want to: this is a routing decision that three platforms must compute identically, and
 * FNV-1a is twenty lines of arithmetic in any language, whereas a subtle disagreement about a digest's
 * encoding would send a client to the wrong shard with no error anywhere. `Math.imul` is the 32-bit
 * wrapping multiply (`&*` in Swift, `*` on `Int` masked to 32 bits in Kotlin), and `>>> 0` makes the
 * result unsigned — the two places a hand-port goes wrong.
 *
 * The hash is fed a **parsed** id, and that is why it can be byte-portable at all: the id grammar's
 * `idchar` is printable ASCII, so hashing UTF-16 code units here gives the same number as hashing UTF-8
 * bytes in Swift or Kotlin. Hand it arbitrary text and that stops being true.
 *
 * An empty accepted set hashes the empty string, which is deterministic and documented rather than
 * clever — but a connection with nothing to watch should be refused before it gets here; the shard it
 * would land on is not a meaningful answer. A `shardCount` that is not a positive integer falls back to
 * `LIVE_SHARD_COUNT`, because `x % 0` is `NaN`, and a `NaN` shard id becomes the Durable Object name
 * `"live-NaN"` — a real object that silently collects every client.
 *
 * @spec live#liveShardFor
 */
export function liveShardFor(
  targets: readonly WatchTarget[],
  shardCount: number = LIVE_SHARD_COUNT,
): number {
  const count = Number.isInteger(shardCount) && shardCount > 0 ? shardCount : LIVE_SHARD_COUNT
  const { accepted } = acceptTargets(targets)
  const lowest = accepted[0]?.stopId ?? ''

  // FNV-1a, 32-bit: offset basis 0x811c9dc5, prime 0x01000193.
  let hash = 0x811c9dc5
  for (let i = 0; i < lowest.length; i++) {
    hash ^= lowest.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % count
}

/**
 * The socket URL for a given API base URL: `http:`→`ws:`, `https:`→`wss:`, plus the live path.
 *
 * **String manipulation only, no `new URL()`.** Not because `URL` is unavailable, but because this is
 * the rule three platforms would each get subtly wrong in a different way, and the one that matters is
 * forgetting `https:`→`wss:` — which ships every rider's location and favourites in cleartext, works
 * perfectly in dev against `http://localhost:8787`, and shows no symptom. Three lines in three shells
 * cannot be pinned by a fixture; this can, so it is one rule with a corpus and `NSURLComponents`
 * stays out of it.
 *
 * A base with neither scheme is passed through unchanged with the path appended. That is deliberate:
 * the input is a configured environment variable, and rewriting something we do not recognise — or
 * throwing — would replace a visible misconfiguration with an invented URL or a crash at first paint.
 * `ws://` and `wss://` bases therefore also pass through correctly, which is what an explicit
 * `EXPO_PUBLIC_LIVE_URL` / `VITE_LIVE_URL` override supplies (D5).
 *
 * @spec live#liveSocketUrl
 */
export function liveSocketUrl(apiBaseUrl: string): string {
  // Every trailing slash, not just one: `http://host//` would otherwise yield `ws://host//v1/live`,
  // which some routers treat as a different path and which no one would look at twice in an env file.
  const base = apiBaseUrl.replace(/\/+$/, '')
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}${LIVE_PATH}`
  if (base.startsWith('http://')) return `ws://${base.slice('http://'.length)}${LIVE_PATH}`
  return `${base}${LIVE_PATH}`
}

// ── Merging live readings into what a screen holds ───────────────────────────────────────────

/**
 * Replace the ETAs in a `StopDetail` with the live ones, keeping everything else exactly as it was.
 *
 * **The reading list is the complete current set, not a patch.** A row with no matching live reading
 * becomes `null` — never its previous, stale value — which is the same honesty rule `gone` exists for.
 * The corollary is the footgun, so it is stated plainly: pass a `delta`'s `changed` array here and every
 * *other* row on the screen blanks. Pass the session's `etas`, which is what `applyLiveFrame` maintains.
 *
 * Every non-ETA field survives, and that is not incidental. `stop`, `members`, and each row's `route`,
 * `stopId` and `fare` are all read by the Place screen; an earlier sketch of this replaced the whole
 * `StopDetail` with a frame payload and dropped them, which renders as a screen with no name and no map
 * pins. The spread is what keeps ADR-058's persisted query cache usable too: the value written back is
 * the same shape the HTTP fetch produced, so a cold start still replays it.
 *
 * @spec live#applyLiveEtasToStopDetail
 */
export function applyLiveEtasToStopDetail(detail: StopDetail, etas: readonly Eta[]): StopDetail {
  const index = indexByRef(etas)
  return {
    ...detail,
    routes: detail.routes.map((row) => ({
      ...row,
      eta: index.get(formatFavoriteRouteKey(row.stopId, row.route.id)) ?? null,
    })),
  }
}

/**
 * When does this reading's next bus arrive, in epoch milliseconds — `Infinity` for "no arrival".
 *
 * Parsed rather than compared lexically, unlike `inferBusMarkers`, which relies on every arrival
 * carrying the same `+08:00` offset. That shortcut is safe there and would not be safe here: the two
 * timestamps our own layer stamps are `Z`-suffixed UTC while the operators' are `+08:00`, so this
 * module treats an ISO-8601 string as an instant and never as sortable text. `new Date(iso)` is
 * permitted in the kernel — it is the *argument-less* form, the implicit clock read, that is banned.
 */
function soonestArrivalMs(eta: Eta): number {
  const first = eta.arrivals[0]
  if (first === undefined) return Number.POSITIVE_INFINITY
  const at = new Date(first).getTime()
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at
}

/**
 * Replace each nearby stop's readings with the live ones for its poles, keeping every other field.
 *
 * **This is the one list in the module that is not in `(stopId, routeId)` order, and the exception is
 * load-bearing.** `stopCardView` caps a card at `policy.maxRows` by taking the *first* N readings, so
 * the order of this array decides **which buses a rider sees**. `/v1/nearby` serves them soonest-first
 * (its own schema says so), and a canonical id order here would silently turn "the next three buses"
 * into "three routes whose ids sort first" — a change no test would catch and every rider would.
 *
 * So the order is soonest-first, with a total tiebreak on `(stopId, routeId)` and readings that have no
 * arrival at all last. Total, because a comparator that returned 0 for two equal arrival times would
 * leave the result dependent on the platform's sort stability — identical in TypeScript, unspecified in
 * Swift (`sort(by:)` makes no stability guarantee), which is precisely the divergence ADR-060 exists to
 * catch.
 *
 * Readings are matched to a place through `memberStopIds`, because an `Eta.stopId` is always a **member
 * pole** while a `NearbyStop.stop.id` may be a merged `P:` place id (ADR-042). Comparing them directly
 * would leave every merged place — which is most of the interesting ones — with an empty card.
 *
 * @spec live#applyLiveEtasToNearby
 */
export function applyLiveEtasToNearby(
  stops: readonly NearbyStop[],
  etas: readonly Eta[],
): NearbyStop[] {
  const byPole = new Map<string, Eta[]>()
  for (const eta of indexByRef(etas).values()) {
    const pole = byPole.get(eta.stopId)
    if (pole === undefined) byPole.set(eta.stopId, [eta])
    else pole.push(eta)
  }

  return stops.map((stop) => ({
    ...stop,
    etas: memberStopIds(stop.stop.id)
      .flatMap((poleId) => byPole.get(poleId) ?? [])
      .sort((a, b) => {
        const sa = soonestArrivalMs(a)
        const sb = soonestArrivalMs(b)
        if (sa !== sb) return sa < sb ? -1 : 1
        return compareRefs(a, b)
      }),
  }))
}
