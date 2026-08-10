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
import type {
  ETAS_BATCH_MAX_IDS as WireBatchMaxIds,
  LIVE_PATH as WireLivePath,
} from '@nextbus/contract'
import { dedupeEtas, etaBoardingKey } from './eta'
import { formatFavoriteRouteKey, memberStopIds, parseRouteId, parseStopOrPlaceId } from './ids'
import type {
  DeltaFrame,
  Eta,
  EtaFailure,
  EtaRef,
  LiveState,
  NearbyStop,
  RouteDetail,
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
 * How many ids one `/v1/etas?ids=…` request may name — **restated from the contract and pinned to it by
 * the type system**, exactly as `LIVE_PATH` is above and for the same reason.
 *
 * Exported, unlike `LIVE_PATH`, because a *client* has to chunk at it: the poll emulator splits a
 * subscription into batches of this size, and `packages/api-client` depends on `@nextbus/core` and
 * `@nextbus/ports` only — adding a contract dependency to reach one integer would be a package edge
 * bought for nothing, and hard-coding `12` there would be the second declaration this idiom exists to
 * prevent. `typeof WireBatchMaxIds` is the literal type `12`, so changing the contract's constant makes
 * **this line a typecheck error**.
 *
 * The number's own justification — why twelve, and why exceeding it is a `400` rather than a truncation
 * — is at the contract's declaration, which is where a native porter reads it.
 */
export const ETAS_BATCH_MAX_IDS: typeof WireBatchMaxIds = 12

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
 * The upstream's own publish period, and the two numbers that align a route round to it (proposals/05).
 *
 * **Measured 2026-08-10, and it is not the 45 s the CDN advertises.** `cache-control: max-age=45` on
 * `rt.data.gov.hk` is CloudFront's TTL; the *data* behind it moves on a ~60 s cycle. The two drift, so about
 * one CDN refresh in four returns an identical `data_timestamp` — observed directly: a refetch at 21:28:10
 * returned the 21:27:12 publish it already had, three seconds before 21:28:13 was written.
 *
 * The clock worth following is in the payload. `data_timestamp` is **per route**, shared by every pole on it,
 * and lands on a fixed second of the minute — six (stop, route) pairs sampled together gave every E22 stop
 * `:12–:13` and every route-91 stop `:09–:10`, ~60 s apart, with E22 still on `:13` twenty-five minutes
 * earlier. So a watcher of one route can learn its route's phase from its own responses, which is what
 * `nextRouteRoundMs` does.
 *
 * The margin is small and deliberately not zero: the phases above carry ~1 s of jitter, and asking *before*
 * the publish lands is the one outcome guaranteed to waste the round.
 */
export const LIVE_ROUTE_PUBLISH_PERIOD_MS = 60_000
/** How long after the expected publish to ask — see `LIVE_ROUTE_PUBLISH_PERIOD_MS`. */
export const LIVE_ROUTE_PUBLISH_MARGIN_MS = 3_000
/**
 * How soon to retry a round that learned nothing.
 *
 * **Alignment improves the odds and cannot guarantee**, because the CDN entry is shared with every other
 * consumer of the API: whoever's request created it set its phase, not us, so a still-valid copy can be older
 * than the newest publish (measured worst case in the same sample: 78 s). When `data_timestamp` has not
 * advanced we know the round taught us nothing, and one short retry is cheaper than waiting out a full period
 * — 15 s, because the entry that misled us expires within 45 s of its own creation and a third of that is a
 * reasonable first look.
 *
 * A deliberate non-decision: there is **no quiet-route ramp** here, unlike `nextLiveCadenceMs`. A route with
 * nothing on it returns no `data_timestamp` at all and simply ticks at the period. Adding a ramp would have to
 * interact with this retry arm, and the case for its shape should come from measuring how often the
 * not-advanced arm actually fires — which cannot be known until this runs.
 */
export const LIVE_ROUTE_RETRY_MS = 15_000
/**
 * The CDN's advertised TTL — and the **one** thing `45 − age` is the right answer for.
 *
 * Following it as a *cadence* is the mistake `LIVE_ROUTE_PUBLISH_PERIOD_MS` documents. But when a round has
 * been handed a copy older than the newest publish, the question is no longer "when does the data change" —
 * it is "when does *this entry* turn over", and that is exactly what the `age` header answers. So a
 * not-advanced round with a known age waits `(ttl − age)` rather than guessing `LIVE_ROUTE_RETRY_MS`.
 */
export const LIVE_ROUTE_CDN_TTL_MS = 45_000
/**
 * Never ask more often than this, whatever the arithmetic says.
 *
 * Ten seconds, and deliberately **not** the same number as `LIVE_ROUTE_RETRY_MS`: they do different jobs, and
 * a floor that equals a chosen delay is a floor nobody can tell is working. This one exists to stop any
 * arithmetic mistake — a skewed clock, a bad TTL, a future timestamp — becoming a tight loop against somebody
 * else's free API. It binds when a round finishes *after* the publish it was aiming at, where asking soon is
 * the correct answer anyway.
 */
export const LIVE_ROUTE_MIN_GAP_MS = 10_000
/** …and never wait longer than this, so a skewed or absurd timestamp cannot park a watch indefinitely. */
export const LIVE_ROUTE_MAX_GAP_MS = 90_000

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
  failed: [],
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
  /**
   * The boarding points this round could not be asked about (WP5-14, ADR-081).
   *
   * **Replaced wholesale by every data frame, and an absent field on one means empty.** A frame carries
   * the complete current set rather than a patch, because the alternative needs an optional field to
   * distinguish "unchanged" from "none" and it cannot: absent would have to mean both. Clearing is the
   * direction that loses information rather than inventing it, which is the same choice ADR-077 made for
   * the merge helpers' argument — and it is why a producer whose failure set *moved* must send a frame
   * even when no reading changed. Without that, a recovered kerb's marker outlives the recovery by a
   * whole cadence, which the row's acceptance rules out.
   *
   * `status` frames leave it alone: the connection's state and the upstream's are different facts, and a
   * reconnect must not erase what we know about the kerbs.
   *
   * Pole ids only, so it pairs directly with the `stopId` of a reading. A whole *target* that could not
   * be answered arrives as a `status` frame — and, if permanent, as a re-echoed snapshot — because
   * `EtaFailure.stopId` is a boarding point and a target may be a merged place (ADR-073 decision 2).
   */
  failed: readonly EtaFailure[]
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

/**
 * This round's readings, with the ones we could not ask about kept rather than dropped.
 *
 * **The rule is *"a failed round is not a departure"*, and this is the layer it was missing at**
 * (ADR-073). Both engines already held it per *target*: if a whole `/v1/etas/:id` call failed, the poll
 * emulator kept that target's previous readings and the shard did the same, so nothing landed in
 * `gone`. Underneath a target is a *place*, and underneath a place are its boarding poles — and there
 * the edge's coalescing cache resolved a rejected upstream board to an empty list, so the call
 * *succeeded* carrying nothing. `diffEtas` then did exactly what it is supposed to do with readings
 * that are no longer there: it reported every one of them departed. A rider watching a stop through a
 * KMB outage saw the buses vanish one by one, on both engines, with the connection reading `live`.
 *
 * So the wire names the poles it could not read (`EtaReport.failed`) and this function is what a
 * stateful consumer does with that: a previous reading whose pole is in `failed` **and which this
 * round did not replace** survives into the result. Everything else is this round's truth, including
 * an absence — a pole that *did* answer and no longer lists a route has genuinely lost that bus, and
 * `gone` is the honest frame for it.
 *
 * Three consequences worth stating rather than discovering:
 *
 *  · **`next` always wins.** A pole can fail partway — Citybus is one upstream call per (pole, route),
 *    so one route can refuse while its neighbours answer — and a retained reading must never displace
 *    a fresh one. The retention is a *union*, not a merge, and `next` is indexed first.
 *  · **A retained reading is not refreshed, and that is the point.** Its `dataTimestamp` stays where
 *    it was, so `isStale` ages it by the operator's clock exactly as ADR-008 requires and the screen
 *    labels it. A pole that refuses for ever therefore keeps showing an ageing, labelled reading rather
 *    than blanking — which is the same thing the per-target rule has always done for a target that
 *    keeps failing, deliberately, and consistency between the two is what makes one rule.
 *  · **It cannot resurrect.** Only readings present in `prev` survive; a pole that failed on the very
 *    first round contributes nothing, because there is nothing to keep.
 *
 * `failedStopIds` is a list of *pole* ids and is compared by equality, not parsed: a place id would
 * simply match no reading, which is the safe direction, and the caller that has the list took it off
 * the wire where it is already canonical.
 *
 * @spec live#retainFailedPoles
 */
export function retainFailedPoles(
  prev: readonly Eta[],
  next: readonly Eta[],
  failedStopIds: readonly string[],
): Eta[] {
  if (failedStopIds.length === 0) return canonicalEtas(next)
  const failed = new Set(failedStopIds)
  const merged = indexByRef(next)
  for (const eta of prev) {
    if (!failed.has(eta.stopId)) continue
    const key = formatFavoriteRouteKey(eta.stopId, eta.routeId)
    if (!merged.has(key)) merged.set(key, eta)
  }
  return [...merged.values()].sort(compareRefs)
}

/**
 * Keep only the readings for these routes — the `routes=` narrowing, as a rule rather than as two
 * filters.
 *
 * **Why this is in the kernel and not left as the three lines it replaces.** `/v1/etas/:id?routes=` was
 * a `Set` and a `.filter` inside `stopEtas`, which was fine while the edge was the only narrower. WP5-7
 * makes the batch endpoint carry no per-id narrowing at all — there is no safe delimiter for a nested
 * list, since `,` is a legal `idchar` (`ids.ts`) — so a target that asks for three routes is narrowed by
 * the **client** after the batch answers, while the `EtaHub` shard goes on narrowing server-side by
 * passing `routeIds` into the same producer. Two narrowings, one rule: written twice they would
 * eventually disagree about a route id that no longer parses or about the empty list, and the two
 * engines' listener output is precisely what ADR-074's corpus asserts is identical.
 *
 * Two decisions, both of which the three lines made implicitly and neither of which was written down:
 *
 *  · **An empty or absent list narrows nothing.** "I named no routes" is *not* "I want no readings" —
 *    the caller that means the latter unsubscribes. `acceptTargets` rejects a `routeIds: []` target
 *    outright for the same reason, so this branch is reachable only from the HTTP query parameter,
 *    where `?routes=` with nothing after it is a caller mistake and serving the whole board is the
 *    harmless direction.
 *  · **It narrows readings and never failures.** A caller narrowing to three routes is saying which
 *    arrivals it wants, not which outages it is willing to hear about — and a KMB board is one call for
 *    every route at the pole, so "did this pole answer" has no per-route truth to filter by (ADR-073
 *    decision 8). That is why this function takes and returns `Eta[]` rather than an `EtaReport`: the
 *    shape it must not touch is not in its signature.
 *
 * Order is preserved, not canonicalised. This is a filter, and its caller has already decided the
 * order — `stopArrivals` serves soonest-first and the poll emulator's per-target list feeds
 * `retainFailedPoles`, which canonicalises. Re-sorting here would silently overwrite the one ordering
 * in this system that is a rider-facing decision (see `applyLiveEtasToNearby`).
 *
 * @spec live#narrowEtasToRoutes
 */
export function narrowEtasToRoutes(
  etas: readonly Eta[],
  routeIds: readonly string[] | undefined,
): Eta[] {
  if (routeIds === undefined || routeIds.length === 0) return [...etas]
  const wanted = new Set(routeIds)
  return etas.filter((eta) => wanted.has(eta.routeId))
}

/**
 * Are these two failure sets the same — i.e. is the second one *not news*?
 *
 * **This is the predicate that makes a frame's `failed` cheap enough to carry** (WP5-14, ADR-081). The
 * protocol's second rule is that an unchanged round sends nothing at all, and the failure set moves
 * independently of the readings: a pole can start refusing, or recover, while every reading a subscriber
 * holds stays byte-identical. Without this predicate a producer has two bad options — send a data frame
 * every round so the set is never stale (the repaint the delta protocol exists to avoid), or send one
 * only when a reading changed, in which case a recovered kerb's marker outlives the recovery by a whole
 * cadence, which the row's acceptance rules out. With it, "the failure set moved" is simply part of *is
 * this round news*, and both engines ask it the same way.
 *
 * **`message` is deliberately not compared; `stopId`, `code` and `retryable` are.** The message is prose
 * for a human and embeds whatever the upstream said, so a wording that varied between two rounds
 * describing one outage would make every round news and undo the point of the predicate. The three
 * compared fields are the three a caller *branches* on: which kerb, what kind of failure, and whether to
 * keep asking. Same reasoning as `COMPARED_FIELDS` excluding `observedAt`, and the same risk if it is got
 * wrong.
 *
 * Both lists are expected in canonical `stopId` order — every producer of one sorts (`unionFailures`
 * below, and the wire's own ordering rule) — so this compares element-wise rather than building a set,
 * which keeps it a total function of the data rather than of insertion order.
 *
 * @spec live#sameFailures
 */
export function sameFailures(a: readonly EtaFailure[], b: readonly EtaFailure[]): boolean {
  if (a.length !== b.length) return false
  return a.every((entry, i) => {
    const other = b[i]
    return (
      other !== undefined &&
      entry.stopId === other.stopId &&
      entry.error.code === other.error.code &&
      entry.error.retryable === other.error.retryable
    )
  })
}

/**
 * One round's failure set, from the per-target lists it came back with: **deduplicated by pole and
 * canonically ordered**.
 *
 * A round is N targets and each answers with its own `failed`, so a frame needs the union — and the union
 * has to be built the same way on both engines or the two produce different bytes for identical upstream
 * behaviour, which is the one property ADR-074's corpus exists to assert. Hence a kernel rule rather than
 * a `flatMap().sort()` written twice.
 *
 * **Deduplicated because two targets can share a pole, and that is reachable rather than theoretical:** a
 * rider can watch a merged place *and* one of its own member poles at once — a Nearby card is keyed on the
 * place and a favourite on the kerb (ADR-062) — and the batch endpoint answers about both. First occurrence
 * wins, which is a choice rather than an accident: the lists arrive in accepted-target order, so "first" is
 * the earliest target that reported the pole, and both engines walk their targets in that same order.
 *
 * Sorted by `stopId` in code-point order like every other list in this module (see the header), and
 * `sameFailures` above relies on that, so the two rules are only correct together.
 *
 * @spec live#unionFailures
 */
export function unionFailures(lists: ReadonlyArray<readonly EtaFailure[]>): EtaFailure[] {
  const byPole = new Map<string, EtaFailure>()
  for (const list of lists) {
    for (const entry of list) {
      if (!byPole.has(entry.stopId)) byPole.set(entry.stopId, entry)
    }
  }
  return [...byPole.values()].sort((a, b) => compareCodePoints(a.stopId, b.stopId))
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
      // **Replaced from the frame, and an absent field means empty** (ADR-081). A snapshot is the
      // server's whole truth, so anything it does not name is not failing — the same direction the merge
      // helpers take for an absent argument (ADR-077 decision 1), and for the same reason: clearing
      // loses information, keeping would invent it.
      failed: frame.failed ?? [],
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
      // **A delta restates the failure set in full, unlike everything else about it** (ADR-081). It is
      // the one field on this frame that is not a patch, and the asymmetry is forced: an optional field
      // cannot distinguish "unchanged" from "none", so one of the two has to be the meaning and only
      // "none" fails safe. The producers' side of the bargain is that a round whose failure set moved is
      // *news* even when no reading did — otherwise this line would clear a marker that is still true.
      failed: frame.failed ?? [],
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
          // Kept for the same reason, and it is a different fact from this frame's: `state` describes the
          // **connection**, `failed` describes the **upstream**. A reconnect must not erase what we know
          // about which kerbs were refusing, and a `retrying` that cleared the per-kerb marker would be
          // strictly less honest than the frame it arrived on.
          failed: state.failed,
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

/**
 * A stable string identifying *which subscription this is* — one declaration, because two renderers
 * each hold a hook that has to decide when to resubscribe.
 *
 * **This exists because of a request storm, not for tidiness.** A live hook subscribes inside an effect
 * whose dependency list has to name the target set. A `WatchTarget[]` is a fresh array on every render;
 * the subscription's own delivered readings re-render the screen; so an array dependency makes a
 * subscription resubscribe *on its own output* — and `subscribe` fires a round immediately, so the loop
 * is unbounded and each turn of it is an HTTP request. Measured as the first thing that goes wrong when
 * `applyLiveEtasToNearby`'s result is written back to a query cache.
 *
 * A string dependency fixes it, and the string has to be built by a rule both renderers share: if one
 * keyed on the set and the other on the ordered list they would resubscribe at different moments for
 * the same rider action, which is drift on the spec rather than on the pixels (ADR-075).
 *
 * **The key is over the *accepted* set**, not over what was handed in, and that is what makes it useful:
 * `watch()` canonicalises with `acceptTargets` anyway, so two orderings of one set — which is exactly
 * what a Nearby list produces as a rider walks a few metres — are the *same subscription* and must not
 * cost a reconnect. A duplicate id and an unwatchable one fall out for free. An **empty string
 * therefore means "nothing here can be watched"**, which is the condition a hook needs before it opens
 * anything at all.
 *
 * `|` is the only separator, because it is the one structural character that appears in **no** stop or
 * route id: `:` is inside both and `+` separates the members of a place id, so either would collide —
 * `{P:KMB:A+KMB:B}` and `{P:KMB:A, routes:[KMB:B]}` are different subscriptions that a `+` would spell
 * identically. Each target contributes its id, then an **arity field** (`*` for all routes, otherwise
 * the count), then its route ids; the arity is what keeps each target self-delimiting under one
 * separator, so no two distinct accepted sets can produce one key. Opaque: nothing parses it back.
 *
 * @spec live#liveTargetsKey
 */
export function liveTargetsKey(targets: readonly WatchTarget[]): string {
  const fields: string[] = []
  for (const target of acceptTargets(targets).accepted) {
    fields.push(target.stopId, target.routeIds === undefined ? '*' : String(target.routeIds.length))
    if (target.routeIds !== undefined) fields.push(...target.routeIds)
  }
  return fields.join('|')
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

/**
 * Which `EtaHub` object owns a **route** watch — its name, not a shard index (proposals/05).
 *
 * A place watch is spread over `LIVE_SHARD_COUNT` shards by `liveShardFor`, which hashes the lowest target
 * id so that two clients watching the same places share a poll. A route watch does not need the hash: the
 * route id **is** the identity, so every rider on Citybus 962 lands on `route-CTB:962:outbound:1` and one
 * round serves all of them. That is the property this whole feature is for, and naming rather than hashing is
 * what makes it exact rather than probable.
 *
 * Its own namespace, and not a raised `LIVE_MAX_TARGETS_PER_CONNECTION`, for three reasons — the first two
 * about *bounding* and the third one discovered later:
 *  · a route's ~40 poles would otherwise union with strangers' Favourites sets on one of eight shards, and
 *    `LIVE_MAX_SHARD_TARGETS`' arithmetic is already at 87% of its cadence;
 *  · a route round is cheap *per pole* and numerous, where a place round is the opposite, so one cap cannot
 *    describe both;
 *  · they run on **different clocks** — see `nextRouteRoundMs`.
 *
 * **`undefined` for an id that is not a route id**, and that is the whole of the validation here. The reason
 * is written out on `liveShardFor`: a `NaN` shard index once produced the Durable Object name `live-NaN`, *"a
 * real object that silently collects every client"*. `route-` plus arbitrary text is the same hazard with a
 * friendlier face — a route id arrives from a query string, so the caller must be able to answer 400 rather
 * than mint an object for `route-<script>`. Returning a name for garbage would make that impossible.
 *
 * @spec live#routeWatchName
 */
export function routeWatchName(routeId: string): string | undefined {
  return parseRouteId(routeId) === null ? undefined : `${LIVE_ROUTE_NAME_PREFIX}${routeId}`
}

/** The `EtaHub` name prefix for a route watch. Distinct from the shards' `live-` by construction. */
export const LIVE_ROUTE_NAME_PREFIX = 'route-'

/**
 * The route a watch object is for, read back out of its own name — `routeWatchName`'s inverse.
 *
 * **Why the object asks its own name instead of being told.** A route watch differs from a place shard in
 * three ways (its per-connection cap, its round budget and the fact that its readings are narrowed to one
 * route), and all three follow from *which route it is*. The alternative is plumbing a flag through the
 * upgrade URL and the socket session, which is a second declaration of something the object's identity
 * already states — and one that could disagree with it. `DurableObjectId.name` is populated for any object
 * reached by name, which `getByName` always is.
 *
 * Untagged, and deliberately: it is the exact inverse of a tagged rule rather than a rule of its own, so
 * what pins it is a **round-trip property** over `routeWatchName`'s own corpus rows instead of a second
 * group asserting the same strings backwards.
 */
export function routeIdFromWatchName(name: string | undefined | null): string | undefined {
  if (name === undefined || name === null || !name.startsWith(LIVE_ROUTE_NAME_PREFIX))
    return undefined
  const routeId = name.slice(LIVE_ROUTE_NAME_PREFIX.length)
  // Validated on the way back too. A name is storage-shaped input by the time an object reads it, and the
  // hazard `routeWatchName` guards against on the way in does not stop being one on the way out.
  return parseRouteId(routeId) === null ? undefined : routeId
}

/**
 * When a route watch should ask again — aligned to **the route's own publish clock** (proposals/05).
 *
 * The upstream advertises `max-age=45`, and following that number is the mistake this function exists to
 * avoid: 45 s is CloudFront's TTL, while the data behind it moves on a ~60 s cycle at a per-route second of
 * the minute (`LIVE_ROUTE_PUBLISH_PERIOD_MS` carries the measurement). Poll on the CDN's clock and roughly one
 * round in four re-reads a publish it already had. Poll on the *data's* clock and every round lands just after
 * a new one — **fewer calls and fresher answers**, which is the rare direction for that trade.
 *
 * Four arms, and each is a different thing to know:
 *  1. **No publish timestamp** — an out-of-service route returns no rows at all, so there is no phase to
 *     align to. Tick at the period; there is nothing cleverer to do and pretending otherwise would invent a
 *     schedule from absent data.
 *  2. **It did not advance, and we know how old the copy was** — the round was handed a shared CDN entry
 *     older than the newest publish. Here, and only here, `ttl − age` is the right signal: the question is
 *     not when the *data* changes but when *this entry* turns over, which the `age` header answers exactly.
 *  3. **It did not advance and the age is unknown** — the same situation with the measurement missing, so
 *     `LIVE_ROUTE_RETRY_MS` is the blind guess. Kept separate from arm 2 rather than folded into it, because
 *     a guess and a measurement should not read the same in a schedule.
 *  4. **It advanced** — aim at `published + period + margin`. If that is already past, the floor handles it:
 *     a slow round does not earn a negative delay, and a skewed clock does not earn an hour.
 *
 * `now` is a number and the timestamps are ISO strings **because that is how they arrive**: `now` from a
 * clock, `data_timestamp` from the wire, `age` from a response header. An unparseable timestamp is treated as
 * absent rather than as zero, which is the difference between arm 1 and a 90 s clamp on garbage.
 *
 * @spec live#nextRouteRoundMs
 */
export function nextRouteRoundMs(input: {
  /** The newest `data_timestamp` this round saw, across every pole of the route. */
  publishedAt?: string
  /** …and the newest the round before it saw, so this function decides "advanced" rather than its caller. */
  previousPublishedAt?: string
  /** The `age` header on the response that misled us, in **seconds**, when the round has one to offer. */
  cacheAgeSec?: number
  now: number
}): number {
  const published = epochOrUndefined(input.publishedAt)
  if (published === undefined) return LIVE_ROUTE_PUBLISH_PERIOD_MS

  const previous = epochOrUndefined(input.previousPublishedAt)
  if (previous !== undefined && published <= previous) {
    const age = input.cacheAgeSec
    if (age === undefined || !Number.isFinite(age) || age < 0) return LIVE_ROUTE_RETRY_MS
    // The margin again, for the same reason as arm 4: asking at the exact instant of turnover is the one
    // timing guaranteed to be too early.
    return clamp(
      LIVE_ROUTE_CDN_TTL_MS - age * 1000 + LIVE_ROUTE_PUBLISH_MARGIN_MS,
      LIVE_ROUTE_MIN_GAP_MS,
      LIVE_ROUTE_MAX_GAP_MS,
    )
  }

  const target = published + LIVE_ROUTE_PUBLISH_PERIOD_MS + LIVE_ROUTE_PUBLISH_MARGIN_MS
  return clamp(target - input.now, LIVE_ROUTE_MIN_GAP_MS, LIVE_ROUTE_MAX_GAP_MS)
}

/** An ISO timestamp as epoch ms, or `undefined` when it is absent or unreadable — never `NaN`. */
function epochOrUndefined(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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
 * ## Exact variant first, then the rider line **at that row's own pole** (WP5-9)
 *
 * A row names one service-type variant and a board publishes whichever variant is running, and those
 * disagree in the wild: 2 of 2124 readings measured across 156 real places on 2026-07-31 named a
 * variant that no row at their own pole lists. Matching on the exact `(pole, routeId)` pair alone
 * therefore drops a real arrival — at Hiram's Highway, opposite Marina Cove, `269D`-shaped exactly:
 * upstream published `GMB:1A:outbound:2002355` at `GMB:20009421` while the static data lists that
 * variant at `GMB:20001114`. The row at the kerb the bus was coming to said nothing.
 *
 * So a row with no exact reading takes the soonest reading for **its own line at its own pole**, and
 * the index for that is built by `dedupeEtas` — the same normalisation the wire applies — keyed by
 * `etaBoardingKey`, the same key the wire keys on. Not a second rule: the *same* rule, which is what
 * makes it safe. The pole is never crossed, so `row.eta.stopId === row.stopId` still holds for every
 * row (`apps/edge/test/eta-stop-id.test.ts` asserts it), and a rider is never shown a bus at a kerb it
 * is not coming to.
 *
 * The edge's `/v1/stop/:id` calls this too rather than indexing its own rows, so the payload a screen
 * fetches and the frames it then subscribes to agree by construction. They did not: the edge attached
 * readings by route id alone, which crossed poles, and one cadence later this function blanked what it
 * had shown.
 *
 * @spec live#applyLiveEtasToStopDetail
 */
export function applyLiveEtasToStopDetail(
  detail: StopDetail,
  etas: readonly Eta[],
  failed?: readonly EtaFailure[],
): StopDetail {
  const exact = indexByRef(etas)
  const byBoardingLine = new Map<string, Eta>()
  for (const eta of dedupeEtas([...etas])) byBoardingLine.set(etaBoardingKey(eta), eta)
  // **`failed` is destructured OUT of the spread, not overwritten in it** — and the difference is the
  // whole bug. `...detail` copies the document's own `failed`, so a conditional that only *adds* the
  // argument's version would leave the stale list standing on exactly the call that has no failures to
  // report: the live merge. Removing it first makes the absent-argument case clear the field, which is
  // the direction that fails safe.
  const { failed: _stale, ...rest } = detail
  return {
    ...rest,
    // **Replaced from the argument, never spread through** (ADR-077). `failed` describes the round the
    // readings came from, so carrying the document's own copy forward would let an outage's list outlive
    // the outage: a screen that fetched once over HTTP and then subscribed would keep saying "we could
    // not reach this kerb" for as long as it stayed open. Absent argument means "I have no failure
    // information", which is the honest state of a live consumer — the frames carry none, deliberately
    // (ADR-073), so a subscription's `status: retrying` becomes the authority the moment it takes over.
    // An optional parameter therefore fails safe: a caller that forgets clears the field rather than
    // preserving a lie.
    ...(failed !== undefined && failed.length > 0 ? { failed: sortFailures(failed) } : {}),
    routes: detail.routes.map((row) => ({
      ...row,
      eta:
        exact.get(formatFavoriteRouteKey(row.stopId, row.route.id)) ??
        byBoardingLine.get(
          etaBoardingKey({
            operator: row.route.operator,
            routeId: row.route.id,
            stopId: row.stopId,
          }),
        ) ??
        null,
    })),
  }
}

/**
 * Replace the per-stop ETAs on a `RouteDetail` with the live ones — the **third** merge rule, and the one
 * that gives a Citybus or GMB route times at all (ADR-116, proposals/05).
 *
 * ## What it is for
 *
 * Those operators publish no bulk route-eta feed (ADR-021), so `/v1/route/:id` serves `eta: null` on every
 * stop and says why in `liveArrivals: 'perStopOnly'` (ADR-114). Their **per-pole** boards answer fine, so a
 * `/v1/live?route=` subscription asks every pole of the route and pushes what it finds. This is what turns
 * those readings back into the payload the screen derives from, so `routeDetailView` needs to know nothing
 * about where a reading came from.
 *
 * ## The key is the pole, exactly, and there is no fallback
 *
 * `row.stop.id === eta.stopId`. Both are canonical — the socket's targets are resolved as
 * `doc.stops.map(s => s.id)` and every reading is stamped with the pole it was read at — and the two
 * fallbacks its siblings need are wrong here rather than merely unnecessary:
 *
 *  · **No "the only reading for this route wins".** `routeStopBoard` may do that (ADR-115) because it is
 *    answering about *one* pole a rider tapped, and an alias table can return that pole's reading under a
 *    neighbouring id. A route frame covers all 41 poles at once, so "exactly one answered" is an outage,
 *    not an identification — and attaching that one reading to all 41 rows would put a bus at 40 kerbs it
 *    is not coming to.
 *  · **No service-type-variant fallback.** `applyLiveEtasToStopDetail` needs one because a board publishes
 *    whichever variant is running; here the narrowing to one exact route id has already happened
 *    server-side (`acceptForConnection`, `narrowEtasToRoutes`), so a reading naming another variant never
 *    arrives. Writing the branch anyway would be unreachable code, which this package's 100 % branch
 *    threshold would refuse and rightly.
 *
 * A row with no matching reading becomes `null`, never its previous value — the same honesty rule its
 * siblings state, with the same footgun: pass the session's `etas`, never a `delta`'s `changed`, or every
 * row the delta did not mention blanks.
 *
 * ## Two fields besides the readings, and both are load-bearing
 *
 * **`liveArrivals` is cleared when anything answered.** It is the sentence a rider reads — *"Live times
 * unavailable"* — and leaving it standing over rows that now show minutes would make the screen contradict
 * itself. Cleared rather than set to a fourth enum member because absence *is* `'answered'`
 * (`routeDetailView` totalises it), so the merged payload is exactly what a route with a working bulk feed
 * would have served. It is left **untouched** when nothing answered at all: a subscription that has
 * connected and heard nothing has not made the route's times available, and saying otherwise would replace
 * one dishonesty with a worse one.
 *
 * **`failed` is replaced from the argument and cleared without one**, the rule its siblings learnt the hard
 * way (ADR-077/081). Here it is what makes a per-row *"we could not ask"* possible at all: the route
 * document has no per-pole failure vocabulary because the server fetches a route in one call, but a live
 * round asks each pole separately, so one kerb refusing while the others answer is a real state — and a row
 * that shows nothing for that reason must not read as a row with no bus due.
 *
 * @spec live#applyLiveEtasToRouteDetail
 */
export function applyLiveEtasToRouteDetail(
  detail: RouteDetail,
  etas: readonly Eta[],
  failed?: readonly EtaFailure[],
): RouteDetail {
  const byPole = new Map<string, Eta>()
  for (const eta of etas) {
    if (eta.routeId !== detail.route.id) continue
    // First wins, and the order is the frame's — which is canonical `(stopId, routeId)` (D1), so "first"
    // is deterministic across both engines. Two readings for one (pole, route) is not something either
    // producer emits; if it ever became one, taking the first is stable rather than arbitrary.
    if (!byPole.has(eta.stopId)) byPole.set(eta.stopId, eta)
  }

  // **Both fields are destructured OUT of the spread, not conditionally overwritten in it**, and the
  // difference is not stylistic: `...detail` copies them, so a conditional that only *adds* a replacement
  // leaves the original standing on exactly the calls that have nothing to say — which for `failed` is the
  // stale-outage bug ADR-077 fixed in the siblings, and for `liveArrivals` would be a screen showing
  // minutes under a line that says it has none.
  const { failed: _stale, liveArrivals, ...rest } = detail
  return {
    ...rest,
    ...(failed !== undefined && failed.length > 0 ? { failed: sortFailures(failed) } : {}),
    ...(byPole.size > 0 || liveArrivals === undefined ? {} : { liveArrivals }),
    stops: detail.stops.map((stop) => ({ ...stop, eta: byPole.get(stop.stop.id) ?? null })),
  }
}

/** Canonical `stopId` order, so two producers of one failure set serialize identically (D1). */
function sortFailures(failed: readonly EtaFailure[]): EtaFailure[] {
  return [...failed].sort((a, b) => compareCodePoints(a.stopId, b.stopId))
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
 * Readings are matched to a place through `memberStopIds`, because an `Eta.stopId` is always a **pole**
 * while a `NearbyStop.stop.id` may be a merged `P:` place id (ADR-042). Comparing them directly would
 * leave every merged place — which is most of the interesting ones — with an empty card. A pole, note,
 * and not necessarily a *member*: a reading off a pole the build folded onto another (WP5-11) carries
 * its own id, and `memberStopIds` yields every clustered pole precisely so it still lands here.
 *
 * @spec live#applyLiveEtasToNearby
 */
export function applyLiveEtasToNearby(
  stops: readonly NearbyStop[],
  etas: readonly Eta[],
  failed?: readonly EtaFailure[],
): NearbyStop[] {
  const byPole = new Map<string, Eta[]>()
  for (const eta of indexByRef(etas).values()) {
    const pole = byPole.get(eta.stopId)
    if (pole === undefined) byPole.set(eta.stopId, [eta])
    else pole.push(eta)
  }
  // Failures are attributed to a card exactly as readings are — through `memberStopIds`, because an
  // `EtaFailure.stopId` is a **pole** while a `NearbyStop.stop.id` may be a merged `P:` place id
  // (ADR-042). Comparing them directly would leave every merged place — which is most of the
  // interesting ones — looking healthy while its kerbs were refusing.
  const failedByPole = new Map<string, EtaFailure>()
  for (const entry of failed ?? []) failedByPole.set(entry.stopId, entry)

  return stops.map((stop) => {
    const poles = memberStopIds(stop.stop.id)
    // Replaced, never spread through — see `applyLiveEtasToStopDetail` for why an absent argument must
    // clear the field rather than preserve the document's own copy.
    const mine = sortFailures(poles.flatMap((poleId) => failedByPole.get(poleId) ?? []))
    // Destructured out for the same reason as above: the card's own `failed` must not survive a merge
    // that was handed none.
    const { failed: _stale, ...rest } = stop
    return {
      ...rest,
      ...(mine.length > 0 ? { failed: mine } : {}),
      etas: poles
        .flatMap((poleId) => byPole.get(poleId) ?? [])
        .sort((a, b) => {
          const sa = soonestArrivalMs(a)
          const sb = soonestArrivalMs(b)
          if (sa !== sb) return sa < sb ? -1 : 1
          return compareRefs(a, b)
        }),
    }
  })
}
