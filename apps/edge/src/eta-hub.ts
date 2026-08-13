// `EtaHub` — the sharded Durable Object behind `/v1/live` (WP5-3).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE OBJECT HOLDS NO RULES.
// ────────────────────────────────────────────────────────────────────────────────────────────────
// Every decision with a name is in `packages/core/src/live.ts`, pinned by a 109-row corpus, and is
// called from here: the accepted target set is `acceptTargets`, what changed is `diffEtas`, how long
// until the next poll is `nextLiveCadenceMs`, and which shard owns a target set is `liveShardFor`
// (called in `./live.ts`, before this object exists). That is not tidiness. `diffEtas` runs *here* and
// in the client's poll emulator, so the socket engine and the polling engine compute the same frames
// from the same data — which is the only reason WP5-1's scenario matrix is a test rather than two
// implementations agreeing by luck. A rule copied into this file would be a rule that could disagree
// with the phone's copy about whether a bus had departed.
//
// What is left here is genuinely a shard's own business: sockets, storage, an alarm, and the caps.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// WHY SHARDED, AND WHAT ONE SHARD IS
// ────────────────────────────────────────────────────────────────────────────────────────────────
// Not one object per stop. `docs/03`'s figure says `DurableObject("stop:<id>")`, and that shape pulls
// against the property this design exists for: **one socket per client**. A rider watching six places
// would need six sockets, six upgrades and six reconnects. So a shard serves whatever its subscribers
// ask for, and the shard is chosen from the target set (D4) so that clients with the *same* interest
// land on the same object and share one upstream poll — which is the case that matters, because a stop
// is hot precisely when many people are looking at it. Clients with partially overlapping sets can
// duplicate a poll across shards; that is bounded by `LIVE_SHARD_COUNT` and is the price of one socket.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// WHY HIBERNATION, AND WHY PER-CONNECTION STATE IS IN THE ATTACHMENT
// ────────────────────────────────────────────────────────────────────────────────────────────────
// `ctx.acceptWebSocket(server)` and the `webSocket*` handler methods, never `server.accept()` plus
// listeners. The standard API is one of the enumerated conditions that *blocks* hibernation, and
// Cloudflare is explicit that it "will incur duration charges for the entire time the WebSocket is
// connected", whereas "Billable Duration (GB-s) charges do not accrue during hibernation" — and further,
// not even before the runtime has got round to hibernating an eligible object. At the 45–60 s cadence
// this shard polls at, and a 10 s hibernation threshold, an idle shard is asleep for 35–50 s of every
// cycle. That is the whole economy of the design.
//
// The consequence is the thing to get right: **hibernation discards in-memory state.** A `Map` of
// socket → subscription would be empty on the next wake and every subscriber would silently receive
// frames for the wrong targets — or none. So the subscription lives in the socket's own attachment
// (`serializeAttachment`), which the runtime keeps for as long as the socket is healthy, and the last
// known readings live in SQLite. Nothing in this class is a field.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT GOES ON THE WIRE, AND WHEN NOTHING DOES
// ────────────────────────────────────────────────────────────────────────────────────────────────
//  · A new subscription (from the connect URL, or a later `subscribe` frame) gets a `snapshot` — the
//    accepted target set echoed back, plus every reading this shard already holds for it — **but only
//    when the shard actually holds those targets.** For a target this shard has never polled, an
//    immediate snapshot would be `etas: []`, and that is not "no buses due", it is "we have not asked
//    yet": delivered, it blanks the arrivals the screen just painted from its own HTTP fetch until the
//    first round lands (WP6-8b — the same blanking shape ADR-073/087 fixed twice before, arriving from
//    the connect path). So a subscription with any never-polled target defers its snapshot to the end
//    of the pulled-forward first round, exactly as the poll emulator's first snapshot waits for a round
//    that answered (`poll.ts`, "a failed first round is not an empty world").
//  · Each alarm round sends a `delta`, and **sends nothing at all when nothing changed.** No empty
//    delta, no heartbeat. Incoming WebSocket messages bill at 20:1 and outgoing ones are free, so the
//    cost of a needless frame is not the byte but the repaint: `applyLiveEtasToStopDetail` rebuilds
//    every row it is handed, and staleness is already honest from each reading's own `dataTimestamp`.
//  · A round that *changed the accepted set* — because a target failed permanently — sends a `snapshot`
//    instead of that delta, so the echo a client compares against what it asked for stays true after a
//    round and not only after a frame. And when nothing at all is left, `closed` + a permanent error:
//    the terminal pair, which is what the poll emulator sends at the identical condition.
//  · A per-target upstream failure is a `status` frame carrying the taxonomy (`code`, `retryable`) —
//    never a throw, never a silent drop, and never `gone`. A target we could not *ask* about has not
//    departed; reporting it as gone would say the bus had left because our own fetch failed.
//
// Two of those are policies the client's poll emulator also implements, and **nothing binds the two
// implementations** — `packages/api-client/src/live/poll.ts` says so at its own header. The follow-up is
// to drive the scenario matrix against this object; until then they agree by review.

import { DurableObject } from 'cloudflare:workers'
import { ClientFrameSchema, LIVE_PING_MESSAGE, LIVE_PONG_MESSAGE } from '@nextbus/contract'
import {
  acceptTargets,
  diffEtas,
  type Eta,
  type EtaFailure,
  LIVE_CADENCE_RAMP_ROUNDS,
  memberStopIds,
  nextLiveCadenceMs,
  nextRouteRoundMs,
  retainFailedPoles,
  routeIdFromWatchName,
  type ServerFrame,
  sameFailures,
  unionFailures,
  type WatchTarget,
  type WireError,
} from '@nextbus/core'
import { getDataset } from './dataset'
import type { Env } from './env'
import { fail, wireErrorFor, wireErrorOf } from './errors'
import { parseLiveTargets } from './live'
import { stopEtas } from './stop-route'

// ── The caps ────────────────────────────────────────────────────────────────────────────────────
//
// Nothing in this Worker had a limit before ADR-055 gave `/v1/nearby`'s `radius` one, and that limit
// exists because an unclamped query parameter was a remote amplification: `radius=50000` fanned out to
// ~8,000 concurrent KV reads from four characters (`index.ts`). A `subscribe` frame is the same shape
// of hazard with a longer lever — it names an unbounded list of stops, and every one of them costs a
// place read plus a coalesced upstream call **on every round, for as long as the socket is open.**
//
// So there are five caps, each bounding a different quantity, and each with a stated arithmetic. None is
// tuned against *traffic*, because there is no deployment to measure (WP0-5): they are derived from the
// platform's own published limits and from the shape of the real dataset, and the numbers are the part a
// reviewer should be able to disagree with. The shard cap's arithmetic was first derived from the *test
// fixture's* shape instead, and it was wrong by an order of magnitude — the correction, and the
// measurement behind it, is in its own docblock.

/**
 * Targets one connection may watch.
 *
 * Twelve, because the largest *legitimate* subscription is a Favourites screen and twelve saved places
 * is already a long list; `/v1/nearby` serves six. Excess targets are **rejected, not truncated
 * silently**: they are absent from the `snapshot`'s accepted echo and named in a `status` frame, which
 * is the same treatment a malformed id gets, through the same path — one rejection mechanism, so a
 * client that reads the echo learns about both without knowing the difference.
 */
export const LIVE_MAX_TARGETS_PER_CONNECTION = 12

/**
 * Distinct targets one shard will poll in one round — the cap that actually bounds the work.
 *
 * Forty-eight, and **the arithmetic below is measured over the shipped dataset rather than estimated from
 * the fixture** — the first version of it was not, and it was wrong by an order of magnitude.
 *
 * A round issues one `stopEtas` per distinct target, each of which reads a place document (a colo-cached
 * KV point read) and then fans out to `min(distinct CTB (pole, routeNo), LIVE_CTB_BUDGET) + non-CTB poles`
 * upstream calls, deduplicated across the whole round by `coalesce` (ADR-057). **CTB is the term that
 * decides the number**, because it has no per-stop board (ADR-021) so its call key is per *route*, not per
 * pole — the thing "average 2 poles" left out entirely. Over `apps/edge/.dataset/d598893de6add2e4` (10,118
 * places): 113 places have 24 or more distinct CTB (pole, routeNo) pairs, 347 have 12 or more, the
 * heaviest place costs 32 calls, and **the 48 heaviest total 1,342 calls at the read path's default budget
 * of 24** — not the ~100–150 this docblock used to claim. Cloudflare allows **6 simultaneous outgoing
 * connections per invocation**, so at ~300 ms a call that is ~224 batches ≈ **67 s**: past the 45 s
 * cadence floor, which means a shard at its own cap would fetch continuously and never become
 * hibernation-eligible. Four riders with twelve Central-class places each is exactly 48 — the load this
 * cap was chosen to *permit*.
 *
 * **Two corrections to the model above, from checking it against Cloudflare's docs (2026-08-10). Neither
 * moves a cap; both make the numbers upper bounds rather than estimates.**
 *  · The six is *"connections simultaneously waiting for response **headers**"*, and since 2026-04-09 a slot
 *    is freed when headers arrive rather than when the body finishes being read. For ETA JSON the two are
 *    nearly the same, so 67 s and 39 s stand as ceilings — but they are ceilings now, not forecasts.
 *  · The limit counts **`fetch()` calls in flight, not sockets.** Worth stating because the opposite is
 *    tempting and was briefly believed here: `rt.data.gov.hk` speaks HTTP/2, and 41 requests to it travel
 *    down **one** TCP connection (measured with `curl`). That makes the transport cheap and does *not* raise
 *    the concurrency — six in flight is six in flight however few pipes they share.
 *  Also documented and **not** available as an escape hatch: whether the six applies per Durable Object
 *  instance is stated nowhere in Cloudflare's docs, so sharding a poll across objects to get more in flight
 *  is unverified. It is settleable only on deployed Cloudflare, since local dev does not enforce the limit.
 *
 * At `LIVE_CTB_BUDGET = 12` the same 48 places cost **785 calls** ≈ 131 batches ≈ **39 s**, inside the
 * floor, with the heaviest single place at 20 calls and the subrequest budget (10,000 on Paid) an order of
 * magnitude clear. 39 s is not a comfortable margin and is stated rather than rounded: if the cap or the
 * cadence moves, this is the number that has to be recomputed, and
 * `test/eta-hub-caps.test.ts` is what holds the budget itself in place.
 *
 * **Excess targets are dropped and named, never refused as a whole.** The first draft refused the
 * *upgrade* when a connection's targets would push the union past this, on the argument that bluntness
 * is honest before a socket exists. Two things were wrong with it. It guarded one of the two doors — a
 * `subscribe` frame is the other, and it is the normal one (route narrowing, and `socket.ts` sending a
 * changed target set on the open connection), so the real bound was `LIVE_MAX_SOCKETS_PER_SHARD ×
 * LIVE_MAX_TARGETS_PER_CONNECTION` = 768. And the refusal was itself a lock-out: once any five sockets
 * had pushed a shard past 48, every subsequent *legitimate* upgrade to it got a 500 that a browser
 * cannot read and that `socket.ts` reconnects on for ever. So the cap is applied where the
 * per-connection cap already is, through the one rejection mechanism `subscribe()` has: the excess is
 * absent from the snapshot's accepted echo and named in a `status` frame. It carries `internal`
 * (`retryable: true`), not `bad_request` — a full shard is our fault, not the rider's, and a background
 * client must not prune a favourite whose stop is perfectly fine.
 */
export const LIVE_MAX_TARGETS_PER_SHARD = 48

/**
 * Poles one **route watch** will poll — the cap that replaces both of the above when this object is a route
 * rather than a shard (proposals/05).
 *
 * Sixty-four, and it is guarding the *dataset* rather than the clock. The two caps above exist because a
 * place round is expensive per target: Citybus has no per-stop board, so a place costs one upstream call per
 * `(pole, routeNo)` pair and the heaviest in the shipped dataset costs 32 on its own. **A route watch is the
 * opposite shape** — many poles, exactly one route each — so its round is numerous and cheap. Measured
 * 2026-08-10 against the live upstream: real Citybus routes run 13 to 41 poles (788, 1, 5B, 91, 962, E22),
 * and the whole of E22 is 41 calls in **~0.5 s** at the runtime's six-in-flight limit, against a 45 s cadence
 * floor. At this cap a round is ~0.8 s, still under 2% of the cadence.
 *
 * So the number is not chosen from a time budget; it is chosen so that a pathological dataset row — a
 * mis-clustered route with three hundred stops — cannot turn one rider's screen into three hundred upstream
 * calls. Excess poles are **dropped and named** in a `status` frame, which is the treatment this file already
 * argues for over refusing a whole connection.
 *
 * Why it replaces `LIVE_MAX_TARGETS_PER_SHARD` too: a route watch is a whole object, so its "shard union"
 * *is* its route. Leaving the 48 in place would truncate a 64-pole route at 48 for no reason connected to
 * either cap's argument.
 */
export const LIVE_ROUTE_MAX_POLES = 64

/**
 * CTB routes one round will ask about, per place.
 *
 * Twelve — the number `/v1/nearby` already passes (`NEARBY_CTB_BUDGET`) and for the same reason. CTB has
 * no per-stop board (ADR-021), so its upstream call key is per **(pole, route)** while a KMB or GMB pole
 * costs one call whatever it serves; the fan-out of a round is therefore dominated by CTB and by nothing
 * else. `stopEtas`/`stopArrivals` default to 24, which is right for a single HTTP request that happens
 * once, and wrong for something that repeats every 45 s for as long as a socket is open — see the
 * measurement in `LIVE_MAX_TARGETS_PER_SHARD` above.
 *
 * Routes past the budget are still counted and still shown on the Place screen from static data. What is
 * bounded is the live fan-out, and the honest cost is that a rider watching a 30-route interchange may not
 * see live minutes for every one of them — which is the same trade `/v1/nearby` already makes, on the same
 * places.
 */
export const LIVE_CTB_BUDGET = 12

/**
 * Sockets one shard will hold.
 *
 * Sixty-four, which with `LIVE_SHARD_COUNT = 8` is 512 concurrent live clients before any refusal — the
 * number WP0-5 has to revisit, and the knob is the kernel's shard count rather than this constant. The
 * runtime's own ceiling is 32,768 per object, so this is not a platform limit being restated; it is a
 * bound on how much fan-out one round can do (64 sockets × a `delta` each is trivial, but 64 × 12
 * targets is what `LIVE_MAX_TARGETS_PER_SHARD` above then has to absorb).
 *
 * **The honest cost of this cap, stated because it is a real trade:** a cap is itself a lock-out vector.
 * 64 sockets from one script would refuse the 65th rider watching those stops. It is set far above any
 * plausible legitimate concurrency for a single shard and far below the runtime's, so the exposure is
 * narrow — but the thing that actually stops that attack is Cloudflare rate limiting at the zone, which
 * needs the custom domain WP0-5 has not created. Nothing in this repo protects the endpoint today.
 */
export const LIVE_MAX_SOCKETS_PER_SHARD = 64

/**
 * Bytes a client frame may carry.
 *
 * The binding constraint is the attachment: a serialized attachment may be at most **16,384 bytes**,
 * and a `subscribe` frame's targets go straight into it. 8,192 leaves the session comfortably inside
 * half of that after canonicalisation (which only ever shrinks the set — `acceptTargets` deduplicates
 * and merges) plus the two scalar fields. A legal frame is nowhere near it: twelve place ids with
 * route narrowing is ~1–2 kB. So this bounds the adversarial case — a frame with 100,000 route ids,
 * which would burn parse CPU and then fail to serialize — and it does so before `JSON.parse` runs.
 */
export const LIVE_MAX_CLIENT_FRAME_BYTES = 8_192

/** Where the consecutive-quiet-round counter lives. See `unchangedRounds`. */
const UNCHANGED_ROUNDS_KEY = 'unchangedRounds'

/** Where a **route watch's** publish clock lives. See `publishClock`. */
const PUBLISH_CLOCK_KEY = 'routePublishClock'

/** Where the completed-round count lives. See `roundsCompleted`. Exported for the tests that wait on it. */
export const ROUNDS_COMPLETED_KEY = 'roundsCompleted'

/**
 * Every `ctx.storage.kv` key this object owns — exported so a test's reset cannot drift from it.
 *
 * Four suites reset a shard between cases by deleting `'unchangedRounds'` **as a hard-coded string**, and
 * a fifth key added here would have leaked into all four silently: a case would inherit the previous
 * one's cadence state and pass or fail for a reason nothing names. Exporting the list is the smallest fix
 * that cannot go stale, and it is why this is a `const` array rather than three loose constants.
 * `roundsCompleted` is in it because a *test* reset is not a teardown — see `forgetReadings`, which
 * deliberately keeps the count.
 */
export const LIVE_HUB_KV_KEYS = [
  UNCHANGED_ROUNDS_KEY,
  PUBLISH_CLOCK_KEY,
  ROUNDS_COMPLETED_KEY,
] as const

/**
 * What the last round learnt about **when the operator published**, which is what a route watch's
 * cadence is a function of (ADR-116 decision 5, proposals/05).
 *
 * Two fields rather than one because `nextRouteRoundMs` decides *"did it advance"* itself rather than
 * being told — so it needs the round before's answer as well as this round's, and `reschedule()` runs
 * from four places (a round, a subscribe, a close, an error) with no round results in hand. Persisted
 * for the same reason `unchangedRounds` is: hibernation discards memory, and a route object that forgot
 * the publish clock on every wake would fall back to a blind tick for ever.
 */
interface PublishClock {
  publishedAt?: string
  previousPublishedAt?: string
}

// ── Per-connection state ────────────────────────────────────────────────────────────────────────

/**
 * Everything this shard knows about one socket. **Structured-cloned into the socket's attachment**, so
 * it survives hibernation; it is deliberately not a field on the class, because a field would be gone
 * on the next wake and the shard would poll for a subscription it could no longer describe.
 *
 * Small by construction: `targets` is capped at `LIVE_MAX_TARGETS_PER_CONNECTION` and the frame that
 * produced it at `LIVE_MAX_CLIENT_FRAME_BYTES`, both far inside the platform's 16,384-byte attachment
 * limit. Note that later mutations of the object are *not* captured — the runtime snapshots at the
 * `serializeAttachment` call — so every change here is followed by another one.
 */
interface Session {
  /** The accepted set, canonical: one entry per stop, sorted, `routeIds` sorted. `acceptTargets`' output. */
  targets: WatchTarget[]
  /** The wire's monotonic counter for this connection. Starts at 1 with the first `snapshot`. */
  seq: number
  /**
   * Whether this connection has already been told it is `live`.
   *
   * A `status` frame is a **transition, not a heartbeat**: `live` goes out once, and again after a
   * recovery, and never in between. A frame per round saying "still fine" would repaint every screen
   * every cadence, which is the cost the delta protocol exists to avoid — but *some* announcement is
   * required, or a screen labelled "reconnecting" keeps that label for ever while data flows in behind
   * it. The client's poll emulator holds the identical flag for the identical reason.
   */
  announcedLive: boolean
  /**
   * The failure set this connection was last *told* about (WP5-14, ADR-081).
   *
   * Per socket rather than per shard, because each connection watches its own subset of the shard's poll
   * union and hears only about its own kerbs. And held here rather than recomputed, because the question
   * it answers is "is this round news?" — `sameFailures(session.failed, mine)` — and the previous *frame*
   * is the only thing that can answer it. Without it, a round whose failure set moved but whose readings
   * did not would stay silent, and a recovered kerb's marker would outlive the recovery by a whole
   * cadence; the poll emulator holds the identical field for the identical reason (`sentFailed`).
   *
   * A few tens of bytes on an attachment that already carries the target list, so the 2 KB budget is not
   * in play. `sessionOf` tolerates its absence, which is what lets a socket opened by the previous deploy
   * keep working.
   *
   * **Stored without messages** (`compactFailures`, WP6-8b). `sameFailures` compares `stopId`, `code`
   * and `retryable` and never the message, so nothing behavioural can tell; what it buys is a bound. A
   * route watch holds up to 64 targets, and a total upstream outage is one `EtaFailure` per pole — with
   * upstream-authored messages (a `ZodError`'s serialized issue list runs to kilobytes) that pushed a
   * worst-case session past the platform's hard 16,384-byte attachment cap, and `serializeAttachment`
   * throwing mid-round is how one session's bookkeeping cost every other subscriber its frames. The only
   * reader that re-emits these entries is `subscribe()`'s carried-forward echo, which now carries an
   * empty message — the code and the kerb, which is what a card renders, survive.
   */
  failed: readonly EtaFailure[]
  /**
   * This connection is owed a `snapshot` that `subscribe()` deliberately did not send (WP6-8b).
   *
   * Set when the accepted set names any target this shard has never polled: an immediate snapshot for
   * it would be `etas: []`, which on screen is "no buses due" — delivered one paint after the rider's
   * own HTTP fetch drew real minutes, it blanks them (the ADR-073/087 blanking shape, from the connect
   * path). So the snapshot waits for the pulled-forward first round, exactly as the poll emulator's
   * first snapshot waits for a round that answered. Cleared by `sendRound` when that snapshot goes out;
   * until then the connection gets no `delta` either, because a delta describes a change to a state the
   * client was never given.
   */
  snapshotPending: boolean
}

/**
 * The attachment, read back and checked rather than trusted.
 *
 * `deserializeAttachment()` is typed `any` and returns `null` for a socket that never had one, so this
 * is the boundary where an untyped value becomes a `Session`. Validating it is not defensive
 * decoration: an attachment written by a *previous* build of this class would deserialize into a shape
 * this code does not expect, and the failure would land inside a round — one bad socket taking down
 * every other subscriber's frames. (In practice a deploy terminates every WebSocket, so that window is
 * narrow; "narrow" is not "closed", and the cost of checking three fields is nothing.)
 */
function sessionOf(ws: WebSocket): Session | null {
  const raw: unknown = ws.deserializeAttachment()
  if (raw === null || typeof raw !== 'object') return null
  const candidate = raw as Partial<Session>
  if (!Array.isArray(candidate.targets)) return null
  if (typeof candidate.seq !== 'number' || typeof candidate.announcedLive !== 'boolean') return null
  return {
    targets: candidate.targets,
    seq: candidate.seq,
    announcedLive: candidate.announcedLive,
    // **Tolerated when absent rather than required**, unlike the three fields above: a socket that was
    // opened before this field existed is a live rider mid-journey, and refusing its attachment would
    // drop the connection on the deploy that added a field it does not miss. Empty is the safe default —
    // the next round that finds a refusing kerb reports it as news, which is one frame the client did not
    // strictly need and no wrong information.
    failed: Array.isArray(candidate.failed) ? candidate.failed : [],
    // Tolerated when absent for the same deploy-boundary reason. `false` is the safe default: a session
    // written by a build that always sent the connect snapshot has nothing pending by definition.
    snapshotPending: candidate.snapshotPending === true,
  }
}

/**
 * A failure set as the attachment stores it: `stopId`, `code`, `retryable` — no message.
 *
 * See `Session.failed` for why. Applied at the two places a session is built, never on the wire: the
 * frames of the round that discovered a failure carry the full (already `boundedMessage`-capped) text.
 */
function compactFailures(failed: readonly EtaFailure[]): EtaFailure[] {
  return failed.map((entry) => ({
    stopId: entry.stopId,
    error: { code: entry.error.code, retryable: entry.error.retryable, message: '' },
  }))
}

/**
 * Is a round's outcome different from the session it started with — i.e. is there anything to write?
 *
 * A module-level pure function rather than three clauses inside `sendRound`, because a predicate inside a
 * Durable Object method is unreachable from a test: `serializeAttachment` cannot be spied on from the
 * workerd harness, so the only way to *see* the answer is to ask for it.
 *
 * @param previous the session the round was computed against
 * @param next what the round concluded
 */
export function sessionChanged(previous: Session, next: Session): boolean {
  return (
    next.seq !== previous.seq ||
    next.announcedLive !== previous.announcedLive ||
    // **Length, not identity.** `next.targets` is `previous.targets.filter(…)`, and
    // `Array.prototype.filter` always allocates — `[1,2,3].filter(() => true) !== [1,2,3]`, and so is the
    // empty case — so a reference comparison here is a tautology: it made the whole guard dead, the
    // `seq`/`announcedLive` clauses unreachable, and the comment above the write ("re-serialized because
    // something changed") describe something the code did not do. It is a subsequence of the same array,
    // so equal length is equal membership; nothing weaker would be sound and nothing stronger is needed.
    next.targets.length !== previous.targets.length ||
    // The failure set is the one part of a session that can move on a round where nothing else does — that
    // is the whole reason it is stored — so a guard that did not ask would drop exactly the write that
    // matters and the next round would report the same outage as news all over again.
    !sameFailures(previous.failed, next.failed) ||
    // A deferred snapshot going out is a state change even on a round whose seq the snapshot itself
    // bumped (so the seq clause already fires today) — compared anyway, because the two moving together
    // is a property of the current code and not of the shape.
    next.snapshotPending !== previous.snapshotPending
  )
}

// ── Readings ────────────────────────────────────────────────────────────────────────────────────

/**
 * The readings one connection's targets name, out of a round's poll.
 *
 * **This is a projection, not a rule.** The stored list for a stop is whatever the *union* of every
 * subscriber's narrowings asked for — `acceptTargets` merges two requests for the same stop by union,
 * and "all routes" absorbs — so a connection that narrowed to three routes must not be handed the
 * whole board. The filter is the identical one `stopEtas` applies for `/v1/etas/:id?routes=`; it
 * decides nothing, and the only thing it could get wrong is showing a rider a route they did not ask
 * about.
 *
 * The alternative — calling `stopEtas` once per *connection* target instead of once per union target —
 * would need no projection at all, and was rejected because it multiplies the place-document reads by
 * the number of subscribers watching a stop, which is precisely the number that is large when a stop
 * is worth watching.
 */
/**
 * The newest `dataTimestamp` a round heard, or `undefined` if nothing answered — a route watch's phase.
 *
 * **Newest and not oldest, over the whole route rather than per pole.** Every pole of one route is
 * answered from the same upstream route feed, so in the healthy case all 41 readings carry the *same*
 * `dataTimestamp` and the choice is moot; it stops being moot when the CDN serves some poles from an
 * older cache entry than others, and then the newest is the one that tells us the publish has landed.
 * Taking the oldest would hold the whole route back to its stalest edge and re-ask on a phase the
 * operator has already left.
 *
 * Compared as instants (`Date.parse`), never lexically: `dataTimestamp` carries the upstream's `+08:00`
 * offset and `EtaSchema` says so in as many words. An unparseable one is skipped rather than allowed to
 * win as `NaN`.
 */
function newestPublish(results: readonly RoundResult[]): string | undefined {
  let newest: string | undefined
  let newestMs = Number.NEGATIVE_INFINITY
  for (const result of results) {
    if (!('etas' in result)) continue
    for (const eta of result.etas) {
      const ms = Date.parse(eta.dataTimestamp)
      if (!Number.isFinite(ms) || ms <= newestMs) continue
      newestMs = ms
      newest = eta.dataTimestamp
    }
  }
  return newest
}

function readingsFor(
  targets: readonly WatchTarget[],
  stored: ReadonlyMap<string, readonly Eta[]>,
): Eta[] {
  const out: Eta[] = []
  for (const target of targets) {
    const list = stored.get(target.stopId) ?? []
    if (target.routeIds === undefined) {
      out.push(...list)
      continue
    }
    const wanted = new Set(target.routeIds)
    for (const eta of list) if (wanted.has(eta.routeId)) out.push(eta)
  }
  return out
}

/**
 * Deduplicated and in canonical `(stopId, routeId)` order — what every frame's reading list must be.
 *
 * Expressed as "the diff against nothing" because the kernel does not export its `canonicalEtas`, and
 * restating the comparator here would be a second declaration of the one ordering D1 exists to make
 * single: two transports, two orders, same data, and the byte-identity criterion unreachable by any
 * implementation. `diffEtas([], next).changed` is that function, reached through its published door.
 * (A `canonicalEtas` export in `packages/core` would say this more plainly; it is a follow-up rather
 * than a change to a package this brief does not own.)
 */
const canonicalEtas = (etas: readonly Eta[]): Eta[] => diffEtas([], etas).changed

/**
 * One target's answer for one round.
 *
 * Three outcomes, not two, since ADR-073. A target can now answer *partially*: `stopEtas` resolves with
 * the readings it got plus `failed`, the boarding points whose upstream board refused. That is a
 * different thing from `error`, which means the target itself could not be read at all — an unparseable
 * id, a place that has left the dataset, a KV read that threw — and only that kind can drop a target
 * from a subscription. A pole failure is advisory: it suppresses `gone` and it reports `retrying`.
 */
type RoundResult =
  | { target: WatchTarget; etas: Eta[]; failed: readonly EtaFailure[] }
  | { target: WatchTarget; error: WireError }

/**
 * `Z`-suffixed UTC, which is what every frame's `at` is declared to be.
 *
 * Not the `+08:00` the contract's blanket conventions bullet describes: `at` is stamped by our own
 * layer with `Date#toISOString()`, exactly as `Eta.observedAt` is, and `SnapshotFrame.at`'s own
 * description says so and warns against comparing it lexically against `Eta.dataTimestamp`.
 */
const frameAt = (now: number): string => new Date(now).toISOString()

// ── The object ──────────────────────────────────────────────────────────────────────────────────

export class EtaHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Runs on **every** wake from hibernation, before the event that woke us — so it has to be cheap,
    // and it must not set an alarm (an unconditional `setAlarm` in a constructor pushes the alarm out
    // for ever and the handler never runs, which is a documented footgun). One idempotent DDL
    // statement. A throw in here terminates and resets the object, so nothing conditional belongs
    // either.
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        // One row per watched target: the id a subscriber named (a pole or a `P:` place), and the last
        // list `stopEtas` returned for it, JSON-encoded.
        //
        // **No timestamp column, on purpose.** Nothing here would read it. Each `Eta` already carries
        // `observedAt` (when we fetched it) and `dataTimestamp` (the operator's own clock, which is
        // what `isStale` judges age from — ADR-008), so a third clock in this table would be a field
        // with no behavioural reader, which is the exact defect Brief 1 found in `observedAt`'s own
        // documentation. Size: ≤ 48 rows (`LIVE_MAX_TARGETS_PER_SHARD`) × a busy interchange's ~5 kB
        // of JSON ≈ 240 kB, against a 2 MB row limit and 10 GB per object.
        `CREATE TABLE IF NOT EXISTS readings (
           target TEXT PRIMARY KEY,
           etas   TEXT NOT NULL
         )`,
      )
    })

    // The free keepalive. A message matching this string **byte for byte** is answered by the runtime
    // without waking a hibernated object and without accruing wall-clock duration; one different byte
    // — a space after a colon, keys in the other order — and every keepalive wakes the shard, which is
    // the difference between an idle connection costing nothing and one billed around the clock. Both
    // ends read the same constant, and `buildAsyncApiDocument()` refuses to emit the published document
    // unless that constant really is the JSON encoding of `PingFrameSchema`.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(LIVE_PING_MESSAGE, LIVE_PONG_MESSAGE),
    )
  }

  /**
   * The upgrade. Returns the 101 with the *client* half of the pair; the server half stays here.
   *
   * `./live.ts` has already checked the method, the header, the origin and that the target list parses
   * to something watchable — everything decidable from the request alone, so an invalid request is
   * never billed against this object. The one check below is the one that needs this shard's own state,
   * plus a cheap re-check of the upgrade header so that reaching this object by any other route is a 400
   * rather than an exception.
   *
   * **No target check here.** There used to be one — the shard union against
   * `LIVE_MAX_TARGETS_PER_SHARD` — and it was both incomplete and harmful: incomplete because a
   * `subscribe` frame reaches the same state without passing through here, and harmful because it turned
   * a full shard into a lock-out for the riders who had done nothing wrong. The cap now lives in
   * `subscribe()`, which every subscription goes through, this one included.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') === null) {
      return fail('bad_request', 'EtaHub serves WebSocket upgrades only')
    }

    const open = this.liveSockets()
    // `internal` is the least wrong member of a taxonomy that has no word for "at capacity": it is
    // retryable (a socket will close and there will be room), and its `retryable: true` is justified in
    // the contract by exactly the right argument — a fault on our side is no evidence that the rider's
    // saved stop is gone, so a Widget must not prune a favourite over it. It is also honest about whose
    // fault a full shard is: ours, for having too few shards or too low a cap. `ERROR_CODES`' own
    // comment names `rate_limited` as the obvious next member; that is the follow-up.
    if (open.length >= LIVE_MAX_SOCKETS_PER_SHARD) {
      return fail('internal', `shard is at capacity (${LIVE_MAX_SOCKETS_PER_SHARD} connections)`)
    }

    const asked = parseLiveTargets(new URL(request.url).searchParams.get('targets') ?? '')

    // Destructured by key, not `Object.values()`: `WebSocketPair` is typed with named numeric
    // properties rather than an index signature, so under `noUncheckedIndexedAccess` the array form
    // widens to `WebSocket | undefined` and `acceptWebSocket` stops compiling.
    const { 0: client, 1: server } = new WebSocketPair()
    // **`acceptWebSocket`, never `server.accept()`.** The standard API blocks hibernation, and events
    // then arrive at listeners instead of the handler methods — so `addEventListener` here would
    // receive nothing.
    this.ctx.acceptWebSocket(server)

    // The connect URL is a complete subscription, not just a shard key, so a client that has nothing
    // more to say — a native client, a `curl`-driven probe — gets a `snapshot` immediately rather than
    // silence. A later `subscribe` frame *replaces* it, which is that frame's own documented semantics,
    // and is how per-stop route narrowing (which the URL cannot express) arrives.
    await this.subscribe(server, asked)

    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * One client frame.
   *
   * Not called for control frames, and not called for a keepalive that matches the auto-response pair —
   * those are answered by the runtime without waking us. So in the ordinary case this handler sees
   * exactly one message per connection: the `subscribe` frame.
   */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Our frames are JSON text. A binary message did not come from our client, and stringifying it
    // into `JSON.parse` would produce noise rather than an error. (Note the runtime hands hibernatable
    // handlers binary data as `ArrayBuffer` regardless of `websocket_standard_binary_type`.)
    if (typeof message !== 'string') return

    if (message.length > LIVE_MAX_CLIENT_FRAME_BYTES) {
      this.send(ws, this.status('live', wireErrorFor('bad_request', 'frame too large')))
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      console.warn('[eta-hub] client sent something that is not JSON')
      return
    }

    // **Validated against the contract, and an invalid frame is ignored rather than answered.** The
    // schema is the one declaration of what a client may send, so using it here means an added client
    // frame cannot be half-implemented. Ignoring a frame that fails is the same tolerant choice the
    // kernel's reducer makes for an unknown *server* frame and the socket transport makes for
    // unparseable text: we cannot tell a newer client's legal frame from an older client's bug, and
    // answering with a taxonomy error would turn one additive protocol change into a broken connection
    // on clients we cannot update. It is logged, because a client bug should be visible somewhere.
    const frame = ClientFrameSchema.safeParse(parsed)
    if (!frame.success) {
      console.warn('[eta-hub] client frame does not satisfy ClientFrameSchema — ignored')
      return
    }

    switch (frame.data.type) {
      case 'subscribe':
        await this.subscribe(ws, frame.data.targets)
        return
      case 'ping':
        // Reached only when the auto-response did **not** match, i.e. when the client's keepalive bytes
        // differ from `LIVE_PING_MESSAGE` — which is the drift that would otherwise wake this object on
        // every keepalive, silently and expensively. Answering here keeps such a client working; the
        // cost of the drift is the wake, and it is now the only symptom.
        this.send(ws, { type: 'pong' })
        return
      default: {
        // Tolerant at runtime, exhaustive at compile time — the pairing the kernel's reducer and the
        // poll transport both use. `frame.data` is `never` here today, so adding a member to
        // `ClientFrameSchema` makes this line a typecheck error until this shard decides what to do
        // with it, while an unknown frame from a newer caller is ignored rather than thrown.
        const unhandled: never = frame.data
        void unhandled
        return
      }
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    // No `ws.close()` here. `compatibility_date = 2026-05-01` is past 2026-04-07, so
    // `web_socket_auto_reply_to_close` is on by default: the runtime has already sent the reciprocal
    // Close frame and moved `readyState` to CLOSED before this runs, and a close call is ignored.
    //
    // `excluding` is load-bearing rather than belt-and-braces: `getWebSockets()` can still return a
    // socket that is CLOSING, so counting subscribers without removing this one would leave a shard
    // with no listeners holding an alarm — the one thing this design must not do, since an alarm is a
    // billed request plus a metered row write per tick and a hibernated object with no alarm is free.
    await this.reschedule({ excluding: ws })
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.warn(`[eta-hub] socket error: ${(error as Error)?.message ?? String(error)}`)
    await this.reschedule({ excluding: ws })
  }

  /**
   * One poll round for every target this shard's subscribers watch between them.
   *
   * Wrapped in a `try`/`finally` because of how alarms retry: an uncaught throw is retried with
   * exponential backoff **up to six times and then never again**, so an upstream outage lasting a few
   * minutes could exhaust the budget and silently stop this shard's cadence for the life of the object.
   * Catching and rescheduling ourselves is Cloudflare's own recommendation. Delivery is at-least-once,
   * so the round is idempotent: it recomputes everything from storage and the attachments.
   */
  override async alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> {
    try {
      await this.round()
    } catch (err) {
      console.error(
        `[eta-hub] round failed (retry ${alarmInfo?.retryCount ?? 0}): ${
          (err as Error)?.stack ?? String(err)
        }`,
      )
    } finally {
      // Also the path that *stops* the cadence: with no subscribers left `reschedule` deletes the alarm
      // and forgets the readings.
      await this.reschedule()
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Sockets that can still be sent to.
   *
   * Filtered on `readyState`, not merely on membership: `getWebSockets()` can include a socket that is
   * CLOSING (a shorter window with `web_socket_auto_reply_to_close`, but not a closed one), and a
   * subscriber that cannot receive a frame must not keep an alarm alive or contribute targets to a poll.
   *
   * **Excluding CLOSING/CLOSED rather than requiring OPEN, and the difference is not pedantry.** A
   * socket that `ctx.acceptWebSocket` has just accepted is not yet OPEN — the handshake completes when
   * the 101 reaches the client, which is after this `fetch` returns. Requiring OPEN therefore counted
   * **zero** subscribers during the very upgrade that created one, so `nextLiveCadenceMs` answered "no
   * alarm at all", the first round never happened, and `forgetReadings()` wiped the shard on every
   * connect. Every round-based test in `test/eta-hub.test.ts` failed on it, which is the only reason it
   * was found: the snapshot still went out, so a suite that checked the handshake alone would have been
   * green.
   */
  private liveSockets(excluding?: WebSocket): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter(
        (ws) =>
          ws !== excluding &&
          ws.readyState !== WebSocket.CLOSING &&
          ws.readyState !== WebSocket.CLOSED,
      )
  }

  /** Every target these sockets are subscribed to, unmerged — `acceptTargets` does the merging. */
  private subscribedTargets(sockets: readonly WebSocket[]): WatchTarget[] {
    return sockets.flatMap((ws) => sessionOf(ws)?.targets ?? [])
  }

  /**
   * One connection's accepted set, and everything it asked for that it is not getting.
   *
   * Two rejection reasons, one mechanism. `acceptTargets` decides the first (an id that does not parse,
   * an empty `routeIds`, a route id that does not parse) and it is the kernel's rule so both transports
   * drop the same malformed favourite. The second is this shard's per-connection cap, applied *after*
   * canonicalisation so that "twelve" counts merged stops rather than however many times a client
   * happened to name one. Truncating in canonical order also means the cap cannot move a client between
   * shards: `liveShardFor` hashes the lowest accepted id, and the lowest is never the one dropped.
   */
  private acceptForConnection(asked: readonly WatchTarget[]): {
    kept: WatchTarget[]
    dropped: WatchTarget[]
  } {
    const route = this.watchedRoute
    // **A route watch narrows every target to its own route, and the object's name is where that comes
    // from.** Without it a 40-pole Citybus route would poll every line at every one of those poles — the
    // place-shard shape, at route scale — where what a rider is watching is one route. Narrowing here rather
    // than in the upgrade URL is not a shortcut: `?targets=` is comma-separated stop ids and cannot express
    // `routeIds`, so the alternative is a second parameter saying what the object's name already says.
    const targets =
      route === undefined ? asked : asked.map((t) => ({ stopId: t.stopId, routeIds: [route] }))
    const { accepted, rejected } = acceptTargets(targets)
    const cap = route === undefined ? LIVE_MAX_TARGETS_PER_CONNECTION : LIVE_ROUTE_MAX_POLES
    return {
      kept: accepted.slice(0, cap),
      dropped: [...rejected, ...accepted.slice(cap)],
    }
  }

  /**
   * The route this object watches, or `undefined` when it is one of the eight place shards.
   *
   * Read from `DurableObjectId.name` rather than from a flag on the connection: three things differ for a
   * route watch — the per-connection cap, the union cap and the narrowing above — and all three follow from
   * *which route it is*, which the object's own identity already states. See `routeIdFromWatchName`.
   */
  private get watchedRoute(): string | undefined {
    return routeIdFromWatchName(this.ctx.id.name)
  }

  /**
   * How much of one connection's accepted set this shard has room for, and what is left over.
   *
   * **The shard cap has to be applied here, not at the upgrade.** `LIVE_MAX_TARGETS_PER_SHARD` used to be
   * checked in `fetch()` alone, and `subscribe()` is the *other* door into the same state — the one §8.1
   * designates for route narrowing and the one `socket.ts` uses when a rider's target set changes on an
   * open connection. So the checked bound and the real bound were 48 and 768.
   *
   * Counted the kernel's way, which is the only way it can be counted correctly: the shard polls the
   * *union* of every subscriber's targets, and `acceptTargets` is what merges two requests for the same
   * stop (a narrowed set and "all routes" collapse to one entry). Adding one target at a time and
   * re-merging is therefore not wasteful — a target that names a stop somebody already watches costs the
   * shard nothing and must not be refused. `ws` is excluded from `others` because a re-subscription
   * *replaces* what this connection watches; counting its own previous set would refuse it its own room.
   *
   * Greedy in canonical order, so `fits[0] === kept[0]`: `liveShardFor` hashes the lowest accepted id, so
   * dropping from the tail is what keeps a capped connection on the shard it was routed to.
   */
  private fitInShard(
    ws: WebSocket,
    kept: readonly WatchTarget[],
  ): { fits: WatchTarget[]; excess: WatchTarget[] } {
    const others = acceptTargets(
      this.subscribedTargets(this.liveSockets().filter((other) => other !== ws)),
    ).accepted
    // A route watch's union cap is its own — see `LIVE_ROUTE_MAX_POLES`. The 48 above bounds a shard whose
    // union is *whatever its subscribers happen to share*; a route object's union is one route, so bounding
    // it at 48 would truncate a long route for a reason belonging to a different shape of object.
    const unionCap =
      this.watchedRoute === undefined ? LIVE_MAX_TARGETS_PER_SHARD : LIVE_ROUTE_MAX_POLES
    const fits: WatchTarget[] = []
    for (const target of kept) {
      const union = acceptTargets([...others, ...fits, target]).accepted
      if (union.length > unionCap) break
      fits.push(target)
    }
    return { fits, excess: kept.slice(fits.length) }
  }

  /**
   * Declare (or re-declare) what one socket watches: store the session, send a `snapshot`, then say how
   * much of what was asked for is actually being watched.
   *
   * **The data frame goes out before the status frames**, and the order is load-bearing rather than
   * tidy. A `status` frame changes only the status, so statuses-first would make the first update of
   * every subscription `{ etas: [], state: 'live' }` — and `applyLiveEtasToStopDetail` maps a row with
   * no live reading to `null` on purpose, so every arrival on the screen would blank and refill one
   * frame later, on every mount. Data first, then how much of it to trust. The client's poll emulator
   * orders them the same way.
   */
  private async subscribe(ws: WebSocket, asked: readonly WatchTarget[]): Promise<void> {
    const previous = sessionOf(ws)
    const { kept, dropped } = this.acceptForConnection(asked)
    const { fits, excess } = this.fitInShard(ws, kept)

    // Monotonic across a re-subscription rather than reset to 1, which is what `SnapshotFrame.seq`'s
    // own description asks for ("monotonic frame counter for this connection"). The kernel tolerates
    // either — `applyLiveFrame` applies whatever `seq` a snapshot carries, deliberately, because the
    // snapshot is the recovery path — and the client's poll emulator does reset. Recorded as a
    // divergence the scenario matrix does not cover, not as an accident.
    const seq = (previous?.seq ?? 0) + 1
    // **The failure set is carried forward for the targets that survived, exactly as the readings are.**
    //
    // A `subscribe` is answered from what the shard has *stored* — readings from the last round — so it has
    // nothing fresher to say about the kerbs either. Sending `failed: []` here would therefore be the
    // opposite of honest: it would pair stored readings with a claim that nothing is refusing, and a card
    // that had been saying "we could not ask" would go quiet for a whole cadence before saying it again.
    // Observed on a real socket before this line existed, which is why it is here rather than reasoned
    // about: a `subscribe` answered `snapshot etas=6` with no failures one round after a delta that named
    // three refusing kerbs.
    //
    // Filtered through `memberStopIds` because a stored entry names a **pole** while a target may be a
    // merged place (ADR-042) — the question is "did this subscription keep the target this kerb belongs
    // to", and comparing ids directly would answer it wrongly for every merged place. A target the caller
    // has just dropped takes its kerbs with it.
    //
    // **What this does not recover, stated rather than left to be found:** a *reconnect* is a new
    // WebSocket with no attachment, so its first snapshot carries no failures whatever the shard knows.
    // The stored readings are equally invisible to that socket, so the two are at least consistent, and
    // the next round tells it everything within one cadence.
    const keptPoles = new Set(fits.flatMap((target) => memberStopIds(target.stopId)))
    const carried = (previous?.failed ?? []).filter((entry) => keptPoles.has(entry.stopId))

    const stored = this.storedReadings()
    // **A snapshot goes out now only when this shard can actually answer it** (WP6-8b). "Can answer"
    // is per target and binary: a target with a `readings` row has been polled — even an empty row is
    // real knowledge ("polled, nothing due") — while a target with none has never been asked about, and
    // a snapshot naming it would present "we have not asked yet" as "no buses due". Delivered, that
    // blanks the arrivals the screen just painted from its own HTTP fetch until the first round lands:
    // the ADR-073/087 blanking shape, reached from the connect path, and the one divergence from the
    // poll emulator the scenario matrix could not see (its first snapshot has always waited for a round
    // that answered). An empty accepted set is vacuously known — its snapshot *is* the echo saying
    // "nothing you named is being watched", and no round is coming to carry it.
    const known = fits.every((target) => stored.has(target.stopId))
    const session: Session = {
      targets: fits,
      seq,
      // Deferred data means a deferred `live` too — the data-before-status order, kept by postponement
      // rather than reordering. `sendRound` announces it right after the snapshot it owes.
      announcedLive: known,
      failed: compactFailures(carried),
      snapshotPending: !known,
    }
    ws.serializeAttachment(session)

    const at = frameAt(Date.now())
    if (known) {
      this.send(ws, {
        type: 'snapshot',
        seq,
        at,
        // The echo is the mechanism, not a courtesy: without it a client that asked for six places and
        // got five readings cannot tell a dropped target from a stop with no buses due, which is the same
        // class of dishonesty as a fake countdown (ADR-008). `SnapshotFrame.targets` says to compare it
        // with what was sent and tell the rider about the difference.
        targets: fits,
        etas: canonicalEtas(readingsFor(fits, stored)),
        // Omitted when empty, like every list in this protocol.
        ...(carried.length > 0 ? { failed: carried } : {}),
      })
    }

    // Two reasons a target is not being watched, and they are **not** the same error. A malformed or
    // over-cap-for-this-connection target is the caller's to fix (`bad_request`, `retryable: false`, so a
    // background client prunes rather than retries on the rider's battery). A target the *shard* had no
    // room for is ours (`internal`, `retryable: true`) — the stop is fine, and telling a Widget to prune
    // a favourite because our shard was busy would be exactly the wrong instruction. `internal` is the
    // least wrong member of a taxonomy with no word for "at capacity", and it is the one the refused
    // upgrade used for this same condition; `ERROR_CODES`' own comment names `rate_limited` as the
    // obvious next member. Both go out through the one door, so a client that reads `status` learns about
    // either without knowing the difference.
    //
    // `state` describes the *connection*, `error` the thing the message names — the distinction that lets
    // a rider be told one favourite is dead while the other five keep updating.
    const refusals: WireError[] = []
    if (dropped.length > 0) {
      refusals.push(
        wireErrorFor('bad_request', `not watching: ${dropped.map((t) => t.stopId).join(', ')}`),
      )
    }
    if (excess.length > 0) {
      refusals.push(
        wireErrorFor(
          'internal',
          `shard is at capacity (${this.watchedRoute === undefined ? LIVE_MAX_TARGETS_PER_SHARD : LIVE_ROUTE_MAX_POLES} targets), not watching: ${excess
            .map((t) => t.stopId)
            .join(', ')}`,
        ),
      )
    }

    if (refusals.length > 0) {
      const state = fits.length === 0 ? 'closed' : 'live'
      for (const error of refusals) this.send(ws, this.status(state, error))
    } else if (fits.length === 0) {
      // A legal, empty `subscribe`: "stop sending me readings" without closing the socket. It gets the
      // snapshot too, because an empty echo with no error is how a client tells this apart from "every
      // target you named was rejected". No error, so the transport stays connected and may re-subscribe.
      this.send(ws, this.status('closed'))
    } else if (known) {
      // Something has to move the client's session out of `connecting`, or a screen sits under a
      // "connecting" label while the snapshot's readings are already drawn behind it. When the snapshot
      // was deferred there is nothing drawn behind the label yet, so `connecting` stays the honest word
      // and the transition follows the deferred snapshot out of `sendRound`, in the data-first order.
      this.send(ws, this.status('live'))
    }

    // A first poll, not an "again": `nextLiveCadenceMs` owns the steady-state cadence and is not being
    // second-guessed here. Without this a subscriber that named a stop this shard has never polled would
    // see an empty snapshot and then nothing for up to 45 s. The upstream cost of pulling the alarm
    // forward is bounded by `coalesce`'s 30 s window, so a client reconnecting in a loop cannot amplify
    // it into upstream traffic.
    await this.reschedule({
      pollNow: fits.some((target) => !stored.has(target.stopId)),
    })
  }

  /** A `status` frame, with the two-branch shape the schema's optional `error` means. */
  private status(state: 'live' | 'retrying' | 'closed', error?: WireError): ServerFrame {
    const at = frameAt(Date.now())
    // Two literals rather than one with `error` always present: an *absent* key is what `.optional()`
    // means, and a present-but-`undefined` one is a different value both to `'error' in frame` and to a
    // strict structural comparison — which is exactly what the conformance assertion does to these
    // frames. Same reasoning as the poll emulator's `status()` and the kernel reducer's own two branches.
    return error === undefined
      ? { type: 'status', at, state }
      : { type: 'status', at, state, error }
  }

  /**
   * The poll, the diff, and one `delta` per socket that has news.
   *
   * The invariant that makes the deltas correct across hibernation, restarts and reconnections is worth
   * stating once: **the stored readings are exactly what every subscriber has already been told.** A
   * `snapshot` is the stored readings projected onto that connection's targets; a `delta` is
   * `diffEtas(projection(stored), projection(polled))`; and `stored` is then replaced by `polled`. So a
   * shard woken from hibernation with no memory at all computes the same delta the resident object
   * would have, and a new subscriber's first snapshot is drawn from the same document.
   */
  private async round(): Promise<void> {
    const sockets = this.liveSockets()
    if (sockets.length === 0) return

    const entries: Array<{ ws: WebSocket; session: Session }> = []
    for (const ws of sockets) {
      const session = sessionOf(ws)
      if (session !== null) entries.push({ ws, session })
    }
    if (entries.length === 0) return

    const before = this.storedReadings()
    // The shard's poll set: every subscriber's targets merged by the kernel's own union semantics — if
    // one connection narrows a stop to three routes and another asks for all of them, the shard asks
    // for all of them, and `readingsFor` gives each connection only what it asked for. Bounded by
    // `LIVE_MAX_TARGETS_PER_SHARD`, enforced in `subscribe()` — the one path every subscription takes,
    // including the upgrade's. Counted here the same way `fitInShard` counts it, which is why the two
    // agree: `acceptTargets` over every subscriber's targets.
    const union = acceptTargets(entries.flatMap((entry) => entry.session.targets)).accepted

    const dataset = await getDataset(this.env)
    const results = await Promise.all(
      union.map(async (target): Promise<RoundResult> => {
        try {
          // The **existing** read path, not a second one: `stopEtas` already resolves a place id
          // through the dataset, fans out per member pole and coalesces every upstream call per pole on
          // a 30 s TTL (ADR-057, WP0-4). What that buys *here* is within-round sharing — two targets of
          // this round that overlap at a pole are one upstream call — plus one set of rules for what a
          // reading and a failure mean. What it does **not** buy is sharing with the HTTP path: the
          // coalescer is per-isolate module state, and this Durable Object is its own isolate (see
          // `eta-cache.ts`), so a stop served over both the socket and `/v1/etas` is fetched by each.
          // The cost model in `LIVE_MAX_TARGETS_PER_SHARD` already prices the round standalone, so no
          // cap moves — but a future argument must not assume cross-path dedup that is not there.
          //
          // …with **this object's own CTB budget**, not the read path's default. That default is sized
          // for one HTTP request; a round repeats at the cadence, and at 24 the 48 heaviest real places
          // cost 1,342 calls a round (see `LIVE_MAX_TARGETS_PER_SHARD`).
          const report = await stopEtas(dataset, target.stopId, target.routeIds, LIVE_CTB_BUDGET)
          return { target, etas: report.etas, failed: report.failed ?? [] }
        } catch (err) {
          return { target, error: wireErrorOf(err) }
        }
      }),
    )

    const failures = new Map<string, WireError>()
    /** Per target, the boarding points inside it that refused — ordered as the wire ordered them. */
    const poleFailures = new Map<string, readonly EtaFailure[]>()
    const after = new Map<string, readonly Eta[]>()
    for (const result of results) {
      if ('etas' in result) {
        // **A failed round is not a departure, one level below where this object used to enforce it**
        // (ADR-073). `stopEtas` can answer partially: a place is N boarding points and an upstream
        // board call is per point, so one kerb can refuse while the others answer. Until the wire
        // could say so, that arrived here as a perfectly ordinary successful list with readings
        // missing from it, and `diffEtas` reported the missing ones `gone` — the same dishonesty the
        // target-level branch below exists to prevent, reached by a route this object could not see.
        // `retainFailedPoles` is the kernel's rule and the poll emulator applies the identical call.
        after.set(
          result.target.stopId,
          result.failed.length === 0
            ? result.etas
            : retainFailedPoles(
                before.get(result.target.stopId) ?? [],
                result.etas,
                result.failed.map((f) => f.stopId),
              ),
        )
        if (result.failed.length > 0) poleFailures.set(result.target.stopId, result.failed)
        continue
      }
      failures.set(result.target.stopId, result.error)
      if (result.error.retryable) {
        // **A failed round is not a departure.** The previous readings stay, so nothing appears in
        // `gone`: reporting them would tell the rider the bus had left when all that happened is that
        // we could not ask. The `status` frame below is what says so honestly.
        after.set(result.target.stopId, before.get(result.target.stopId) ?? [])
      }
      // …and a `retryable: false` failure leaves the target absent from `after` entirely, because it has
      // left the subscription. Its readings are not reported as `gone`: `sendRound` sends the *corrected
      // snapshot* for that case, so a set that changed under the client is re-echoed rather than
      // described by a delta whose accepted set is stale (see `sendRound`).
    }

    // Whether *this shard* heard anything new, which is what the cadence ramp is a function of — a
    // property of the shard rather than of any one socket, so it is computed from the poll and not from
    // whether a frame happened to go out.
    const shardDiff = diffEtas(readingsFor(union, before), readingsFor(union, after))
    const quiet = shardDiff.changed.length === 0 && shardDiff.gone.length === 0

    for (const { ws, session } of entries) {
      // Guarded per socket, like `send` one level down: `sendRound` also serializes an attachment, and
      // a throw anywhere in one connection's bookkeeping must not cost the *other* subscribers their
      // frames — nor skip the storage writes below, which are what the next round's diffs are computed
      // against.
      try {
        this.sendRound(ws, session, before, after, failures, poleFailures)
      } catch (err) {
        console.error(`[eta-hub] sendRound failed: ${(err as Error)?.stack ?? String(err)}`)
      }
    }

    this.writeReadings(before, after)
    this.writeUnchangedRounds(quiet ? this.unchangedRounds() + 1 : 0)
    // **From the results — what this round *heard* — and not from `after`, which is what the screen is
    // still showing.** The two agree today, and the honest reason to write it this way anyway is coupling
    // rather than a bug: `after` holds two kinds of carried-forward reading (`retainFailedPoles`' survivors
    // and a retryable target failure's previous list), so it can only ever contain this round's readings or
    // *older* ones — and `writePublishClock`'s "nothing answered" fallback stores the previous value, which
    // is exactly what an older reading would have produced. An injected defect that drew the clock from
    // `after` therefore passed every case in `live-route-watch.test.ts`, which is recorded here because it
    // is the sort of claim a comment is tempted to make and a test cannot support. What the results-based
    // read buys is that a future change to *why* a reading is retained cannot silently become a change to
    // the publish clock: retention exists to keep a rider's times on screen, and the clock exists to decide
    // when to ask again.
    if (this.watchedRoute !== undefined) this.writePublishClock(newestPublish(results))
    this.ctx.storage.kv.put(ROUNDS_COMPLETED_KEY, this.roundsCompleted() + 1)
  }

  /**
   * One socket's share of a round: its delta, its failures, and its `live` transition.
   *
   * `session` is the snapshot `round()` took **before** its awaits, and a round is not atomic: a KV read
   * and an upstream `fetch` are subrequests, not `ctx.storage` operations, so the input gate stays open
   * and a `subscribe` frame can be handled inside that window — which is the *normal* timing, because a
   * new subscription pulls the alarm forward to now. So the first thing this does is check whether the
   * connection still has the subscription this round was computed for.
   */
  private sendRound(
    ws: WebSocket,
    session: Session,
    before: ReadonlyMap<string, readonly Eta[]>,
    after: ReadonlyMap<string, readonly Eta[]>,
    failures: ReadonlyMap<string, WireError>,
    poleFailures: ReadonlyMap<string, readonly EtaFailure[]>,
  ): void {
    const current = sessionOf(ws)
    // **It re-declared itself during this round's awaits, so its own snapshot is authoritative.** Both
    // things this round has for it were computed against a target set it no longer has: the delta, and
    // the attachment write at the end — which used to revert the re-declaration outright, since
    // `serializeAttachment` writes whatever it is given. On a quiet round no frame went out at all, so
    // nothing set the kernel's `resyncNeeded` and the newly added stop was silently unsubscribed while
    // the accepted-set echo said it was being watched; on a changed round the delta went out carrying the
    // same `seq` as the fresh snapshot and `applyLiveFrame` dropped it as already seen. `seq` increases
    // strictly on every `subscribe()`, so comparing it is a precise detector rather than a heuristic.
    if (current === null || current.seq !== session.seq) return

    // A target dropped for good leaves this connection's subscription, so the shard stops polling it on
    // the next round as well. `before` is projected through the *old* target list and `after` through
    // the new one, which is what puts the departed target's readings in `gone`.
    const kept = session.targets.filter((target) => {
      const failure = failures.get(target.stopId)
      return failure === undefined || failure.retryable
    })

    const { changed, gone } = diffEtas(
      readingsFor(session.targets, before),
      readingsFor(kept, after),
    )

    // Every failure this connection should hear about, in accepted-target order and — within a target
    // — in the order the wire listed its poles. One flat list rather than two, because the client
    // receives one `status` frame per entry and the poll emulator builds the identical sequence from
    // the identical `EtaReport`; two lists emitted in two loops would order them differently the
    // moment a round had both kinds, and that difference is exactly what the scenario corpus asserts
    // against. A target either failed outright or answered (possibly partially) — never both.
    const mine = session.targets.flatMap((target): WireError[] => {
      const whole = failures.get(target.stopId)
      if (whole !== undefined) return [whole]
      return (poleFailures.get(target.stopId) ?? []).map((f) => f.error)
    })
    // **Only a *target*-level failure can be permanent here**, and that is a rule rather than an
    // observation about today's codes. `retryable: false` is the wire's instruction to prune, and a
    // refusing board says nothing about whether the rider's stop exists — so a pole failure must never
    // remove a target from a subscription, whatever code it happens to carry. `kept` above filters on
    // `failures` alone for the same reason.
    const permanent = session.targets
      .map((target) => failures.get(target.stopId))
      .filter((error): error is WireError => error !== undefined && !error.retryable)

    /**
     * This connection's own failure set for the frame (WP5-14, ADR-081) — the kernel's union over the
     * targets it is watching, so the poll emulator building the same thing from the same `EtaReport`s
     * produces the identical bytes (D1).
     *
     * **Pole failures only, and over `kept` rather than `session.targets`.** `EtaFailure.stopId` is a
     * boarding point while a target may be a merged place, so a whole-target failure has no pole to name
     * and stays a `status` frame (ADR-073 decision 2). And a target that has just been dropped for good is
     * not something this connection is watching any more, so naming its kerbs would mark a card the client
     * is about to stop drawing.
     */
    const mineFailed = unionFailures(kept.map((target) => poleFailures.get(target.stopId) ?? []))
    /**
     * **A failure set that moved is news, even when no reading did.**
     *
     * The delta branch below used to fire on `changed || gone` alone, which is silent for exactly the
     * round an outage produces: a kerb stops answering, `retainFailedPoles` keeps its previous readings, so
     * nothing changed and nothing is gone. The card then could not say "we could not ask" until some other
     * bus happened to move — and on recovery the marker would outlive the recovery by a cadence, which the
     * row's acceptance rules out. `sameFailures` is the kernel's predicate, so this shard and the emulator
     * agree about what counts as a change, down to ignoring a reworded error message.
     */
    const failuresAreNews = !sameFailures(session.failed, mineFailed)
    /** Omitted when empty, on the wire and here — the convention every list in this protocol follows. */
    const failedField = mineFailed.length > 0 ? { failed: mineFailed } : {}

    let seq = session.seq
    let snapshotPending = session.snapshotPending
    /**
     * Did this round answer for anything this connection watches? A target in `failures` did not — a
     * retryable failure only carried the previous readings forward, and "we could not ask" is not an
     * answer — while a target with pole failures did, partially. The deferred first snapshot waits for
     * this the same way the poll emulator's waits for `answered || dropped`: a round that told us
     * nothing must not produce `snapshot { etas: [] }`, the frame for "no buses due" (WP6-8b).
     */
    const answered = session.targets.some((target) => !failures.has(target.stopId))
    if (permanent.length > 0 || (snapshotPending && answered)) {
      snapshotPending = false
      // **A round that changes the accepted set re-echoes it, and a `snapshot` is the only frame that
      // can.** A target that failed `retryable: false` has left this subscription for good, so the
      // `targets` the client is holding — from its own `subscribe` — now names a stop nobody is polling,
      // and `SnapshotFrame.targets`' rule ("compare it with what you sent and tell the rider about the
      // difference") had nothing true to compare against after a round. Sent *instead of* the delta
      // rather than after it: the two would describe the same state and the cost of a needless frame is
      // the repaint, not the byte (see the module header). The snapshot is also the protocol's own
      // authority frame — `applyLiveFrame` replaces the session's readings with it, whatever `seq` it
      // carries — which is exactly right when the set it describes has changed underneath.
      seq += 1
      this.send(ws, {
        type: 'snapshot',
        seq,
        at: frameAt(Date.now()),
        targets: kept,
        etas: canonicalEtas(readingsFor(kept, after)),
        ...failedField,
      })
    } else if (!snapshotPending && (changed.length > 0 || gone.length > 0 || failuresAreNews)) {
      seq += 1
      // A delta with two empty lists and a `failed` is a legal frame and a new one: it is how a round that
      // only learned "this kerb has started refusing" — or "has stopped" — reaches a screen. The module
      // header's "an unchanged round sends nothing" still holds; what counts as unchanged has widened.
      // `!snapshotPending`, because a connection still owed its first snapshot has no state a delta could
      // describe a change to: the round that will clear the flag sends the snapshot branch above instead.
      this.send(ws, { type: 'delta', seq, at: frameAt(Date.now()), changed, gone, ...failedField })
    }
    // else: nothing changed for this subscriber, so nothing is sent at all. See the module header.

    if (kept.length === 0 && permanent.length > 0) {
      // **Nothing left to watch, and asking again cannot change that.** `reschedule` is about to delete
      // the alarm and forget the readings — this subscription is *dead* — so `retrying` would leave a
      // screen labelled "we are still trying" that never updates again: `socket.ts` is terminal only on
      // `closed` **and** a permanent error, and a `status` frame never sets the kernel's `resyncNeeded`,
      // so the client neither stops nor recovers. `closed` + a permanent error is the terminal pair, it
      // is what `subscribe()` already sends for this same state, and it is what the poll emulator emits
      // at the identical condition (`watching.length === 0`). Parity here is not tidiness: the two
      // engines are supposed to be indistinguishable to a listener.
      this.send(ws, this.status('closed', permanent[0]))
    } else {
      // `retrying` even for a permanent per-target failure, deliberately: it matches the poll emulator's
      // choice rather than being more honest than it, and changing it must change both engines
      // (BRIEF-3 §8 decision 7). The snapshot above is what carries the correction.
      for (const error of mine) this.send(ws, this.status('retrying', error))
    }
    // Announced only once the client holds data — a deferred snapshot defers the `live` transition with
    // it (data-first, by postponement). Until the snapshot exists, `announcedLive` stays false so the
    // round that finally sends it also sends the transition, in order.
    const announcedLive = mine.length === 0 && !snapshotPending
    if (announcedLive && !session.announcedLive) this.send(ws, this.status('live'))

    const next: Session = {
      targets: kept,
      seq,
      announcedLive,
      failed: compactFailures(mineFailed),
      snapshotPending,
    }
    if (sessionChanged(session, next)) {
      // Re-serialized because a mutation of the object the attachment was built from is *not* captured;
      // the runtime snapshots at the call.
      ws.serializeAttachment(next)
    }
  }

  /** One frame, guarded. */
  private send(ws: WebSocket, frame: ServerFrame): void {
    try {
      ws.send(JSON.stringify(frame))
    } catch (err) {
      // A socket can close between `getWebSockets()` and here, and `send` on a closed socket throws.
      // Unguarded, one departed subscriber would abort the whole round — every *other* subscriber loses
      // its delta, and the alarm burns one of its six retries on a failure that will recur.
      console.warn(`[eta-hub] send failed: ${(err as Error)?.message ?? String(err)}`)
    }
  }

  // ── Storage ───────────────────────────────────────────────────────────────────────────────────

  /**
   * The last known readings, per target.
   *
   * `ctx.storage.sql`, not the KV API. Both exist on a SQLite-backed object, but the KV API is
   * implemented over a hidden table and cannot be queried — fine for a scalar (see `unchangedRounds`
   * below, which uses it for exactly that), wrong for "the readings for these forty-eight ids".
   */
  private storedReadings(): Map<string, readonly Eta[]> {
    const rows = this.ctx.storage.sql
      .exec<{ target: string; etas: string }>('SELECT target, etas FROM readings')
      .toArray()
    const out = new Map<string, readonly Eta[]>()
    for (const row of rows) out.set(row.target, JSON.parse(row.etas) as Eta[])
    return out
  }

  /**
   * Persist this round's readings — **only the rows that moved.**
   *
   * Rewriting all 48 rows every round would be ~96 metered row writes per shard per round, which at a
   * 45 s cadence across 8 shards is on the order of 45 M rows a month: right up against the 50 M
   * included allowance, for data that mostly did not change. Writing only differences means a quiet
   * shard's round writes **zero** rows, and the only guaranteed per-round write is the `setAlarm` the
   * cadence needs.
   *
   * No `await` between the statements, deliberately: `sql.exec` is synchronous and a run of writes with
   * nothing yielding between them coalesces into one atomic commit. A single `await` in this loop would
   * split the round's readings across several transactions, so a shard interrupted mid-write could
   * persist a state that is half of two rounds — and every subsequent delta would be computed against
   * it.
   */
  private writeReadings(
    before: ReadonlyMap<string, readonly Eta[]>,
    after: ReadonlyMap<string, readonly Eta[]>,
  ): void {
    const sql = this.ctx.storage.sql
    for (const [target, etas] of after) {
      const encoded = JSON.stringify(etas)
      if (before.has(target) && JSON.stringify(before.get(target)) === encoded) continue
      sql.exec(
        'INSERT INTO readings (target, etas) VALUES (?, ?) ON CONFLICT(target) DO UPDATE SET etas = excluded.etas',
        target,
        encoded,
      )
    }
    // A target nobody watches any more is deleted rather than left behind, so a rider who re-subscribes
    // to it gets an honest empty snapshot instead of a reading from whenever it was last watched — and
    // so the document stays inside the bound the schema comment states.
    for (const target of before.keys()) {
      if (!after.has(target)) sql.exec('DELETE FROM readings WHERE target = ?', target)
    }
  }

  /**
   * Consecutive rounds in which nothing changed — the input `nextLiveCadenceMs` widens the cadence on.
   *
   * Persisted because hibernation discards memory, and a shard that restarted its ramp at the 45 s floor
   * on every wake would poll faster than the data changes for ever, which is the cost this ramp exists
   * to avoid. In `ctx.storage.kv` rather than the readings table because it is one scalar and this is
   * what the synchronous KV API is good for.
   */
  private unchangedRounds(): number {
    const stored = this.ctx.storage.kv.get<number>(UNCHANGED_ROUNDS_KEY)
    return typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : 0
  }

  /**
   * …clamped at the ramp length, which is what makes a fully quiet shard write nothing at all.
   *
   * `nextLiveCadenceMs` already clamps the cadence at the ceiling after `LIVE_CADENCE_RAMP_ROUNDS`, so
   * every value beyond it is the same cadence; storing the clamped number means the counter stops
   * moving once the shard is quiet, and a write that would not change anything is skipped.
   */
  private writeUnchangedRounds(rounds: number): void {
    const clamped = Math.min(rounds, LIVE_CADENCE_RAMP_ROUNDS)
    if (clamped === this.unchangedRounds()) return
    this.ctx.storage.kv.put(UNCHANGED_ROUNDS_KEY, clamped)
  }

  /**
   * Rounds this object has finished, ever — **the only thing outside it that can tell whether a round
   * happened.**
   *
   * Not needed by any product behaviour, and that is stated up front because a counter nothing reads is
   * usually dead weight. This one is read by tests, and it exists because the alternative was measured
   * and is worse: `live-rounds.test.ts` had no way to await round 0 (the connect round is armed at
   * `Date.now()` and fired by the runtime, so `runDurableObjectAlarm` returns `false` — it was tried, for
   * all 21 scenarios), and waited on *quiet* instead. Widening that quiet window to be safe took the file
   * from 8 s to 27 s; leaving it narrow is a flake that reads as a product failure. A monotonic count is
   * what a test can wait for deterministically, at no time cost. `docs/07-backlog.md` filed exactly this.
   *
   * Monotonic and never reset — including by `forgetReadings()`, deliberately. A torn-down object that
   * came back with the counter at zero would let a waiter see round 0 twice; the readings are state, this
   * is history.
   */
  private roundsCompleted(): number {
    const stored = this.ctx.storage.kv.get<number>(ROUNDS_COMPLETED_KEY)
    return typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : 0
  }

  /**
   * What the last round learnt about the operator's publish clock, guarded on the way out.
   *
   * Guarded rather than trusted for the same reason `routeIdFromWatchName` validates a name it minted:
   * this is storage-shaped input by the time it is read, and `nextRouteRoundMs` treats an unparseable
   * timestamp as *absent* — which is the safe arm (a blind 60 s tick), but only if what reaches it is
   * either a string or nothing at all rather than, say, a number that `Date.parse` would read as a year.
   */
  private publishClock(): PublishClock {
    const stored = this.ctx.storage.kv.get<PublishClock>(PUBLISH_CLOCK_KEY)
    if (stored === undefined || stored === null || typeof stored !== 'object') return {}
    const at = typeof stored.publishedAt === 'string' ? stored.publishedAt : undefined
    const previous =
      typeof stored.previousPublishedAt === 'string' ? stored.previousPublishedAt : undefined
    return {
      ...(at === undefined ? {} : { publishedAt: at }),
      ...(previous === undefined ? {} : { previousPublishedAt: previous }),
    }
  }

  /**
   * Advance the publish clock from what this round actually saw.
   *
   * **One rule, and its four behaviours are the whole cadence.** `seen` is the newest `dataTimestamp`
   * across every board that answered this round, or `undefined` if none did:
   *
   * | this round | stored | `nextRouteRoundMs` takes | why that is right |
   * |---|---|---|---|
   * | a newer publish | `{at: new, previous: old}` | arm 4 — aligned to `new + 60 s + margin` | we know the phase |
   * | the same publish | `{at: old, previous: old}` | arm 2 — retry in 15 s | the CDN served us bytes we already had |
   * | nothing answered | `{at: old, previous: old}` | arm 2 — retry in 15 s | an outage is worth re-asking sooner than a tick |
   * | nothing, ever | `{}` | arm 1 — tick at 60 s | no phase to align to |
   *
   * The middle two collapsing to one arm is not a coincidence being exploited: *"we learnt nothing about
   * the clock"* is the same fact whether the bytes were stale or absent, and 15 s is `nextRouteRoundMs`'s
   * answer to it either way.
   *
   * **Only a route watch writes this.** A place shard's cadence is `nextLiveCadenceMs` and always will
   * be — its targets are whatever its subscribers happen to share, so there is no single publish clock to
   * align to — and a per-round KV write on all eight shards to store something nothing reads is a real
   * cost (`LIVE_MAX_TARGETS_PER_SHARD`'s docblock counts row writes for exactly this reason).
   */
  private writePublishClock(seen: string | undefined): void {
    const previous = this.publishClock().publishedAt
    const next: PublishClock = {
      ...((seen ?? previous) ? { publishedAt: seen ?? previous } : {}),
      ...(previous === undefined ? {} : { previousPublishedAt: previous }),
    }
    if (next.publishedAt === undefined && next.previousPublishedAt === undefined) return
    this.ctx.storage.kv.put(PUBLISH_CLOCK_KEY, next)
  }

  // ── The alarm ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Set, pull forward, or cancel the poll alarm.
   *
   * **No subscribers means no alarm at all**, and that is the feature rather than an optimisation: a
   * Durable Object with no alarm and only hibernatable sockets hibernates and accrues no duration
   * charge, while one that keeps a timer ticking to discover that nobody is listening pays for every
   * tick *and* a metered row write per `setAlarm`. The kernel expresses it as `null` rather than `0`
   * precisely so a caller cannot read it as "immediately".
   *
   * An existing alarm is never pushed *later*. `setAlarm` replaces unconditionally, so recomputing the
   * cadence on every socket close would keep sliding the next round away from a subscriber who has been
   * waiting for it.
   */
  private async reschedule(opts: { excluding?: WebSocket; pollNow?: boolean } = {}): Promise<void> {
    // **A socket that watches nothing is not a subscriber**, which is what `nextLiveCadenceMs`' first
    // parameter means. An empty `subscribe` frame is legal ("stop sending me readings" without closing
    // the socket) and so is one whose every target was rejected, and in both cases the connection is
    // open while there is nothing at all to poll — so keeping an alarm alive would be billing a wakeup,
    // and a metered `setAlarm` row, to say nothing. The poll emulator stops its timer at exactly the
    // same condition (`watching.length === 0`), for the same reason.
    const subscribers = this.liveSockets(opts.excluding).filter(
      (ws) => (sessionOf(ws)?.targets.length ?? 0) > 0,
    ).length
    // **The kernel decides *whether* to poll; for a route watch it does not decide *when*.** Two rules,
    // and the order matters: `nextLiveCadenceMs`'s `null` is the teardown decision (no subscribers → no
    // alarm, forget the readings) and it is the *same* decision for both shapes of object, so it is asked
    // first and never bypassed. `nextRouteRoundMs` never returns `null` — it answers a cadence, not a
    // question about whether to have one — so putting it first would mean restating the teardown rule in
    // this file, where it could drift from the kernel's.
    //
    // Why a route watch needs its own clock at all: the upstream publishes per route on a ~60 s cycle at a
    // fixed second of the minute (measured — E22 on :12–:13, route 91 on :09–:10) and the CDN in front of
    // it holds 45 s. Those two numbers are coprime enough that a blind 45 s poll learns nothing on about
    // one refresh in four, and pays full price for it. A place shard has no such clock to align to: its
    // targets are whatever its subscribers happen to share, published by up to four operators.
    const teardown = nextLiveCadenceMs({ subscribers, unchangedRounds: this.unchangedRounds() })

    if (teardown === null) {
      await this.ctx.storage.deleteAlarm()
      this.forgetReadings()
      return
    }

    const delay =
      this.watchedRoute === undefined
        ? teardown
        : nextRouteRoundMs({ ...this.publishClock(), now: Date.now() })

    const at = opts.pollNow ? Date.now() : Date.now() + delay
    // Inside `alarm()` this reads `null` unless `setAlarm` has already been called since the handler
    // started — documented, and exactly what is wanted: the end of a round always installs the next one.
    const existing = await this.ctx.storage.getAlarm()
    if (existing !== null && existing <= at) return
    await this.ctx.storage.setAlarm(at)
  }

  /**
   * Drop everything a shard with no subscribers is holding.
   *
   * Explicit deletes rather than `storage.deleteAll()`: the readings and the counter are all this object
   * owns, and whether `deleteAll()` also cancels a pending alarm is not something I established. The
   * residue is an empty SQLite table (~12 kB of internal metadata, which does count as billable
   * storage) per shard that has ever been used — 8 shards, so a rounding error, and stated rather than
   * left to be discovered.
   */
  private forgetReadings(): void {
    this.ctx.storage.sql.exec('DELETE FROM readings')
    this.ctx.storage.kv.delete(UNCHANGED_ROUNDS_KEY)
    // The publish clock goes with them, and it has to: it describes readings that are being dropped. A
    // surviving `publishedAt` would meet the next watch's first round as its own `previousPublishedAt`,
    // and "the publish did not advance" is exactly what that round cannot know yet. `roundsCompleted`
    // deliberately does **not** go — see its docblock; it is history, not state.
    this.ctx.storage.kv.delete(PUBLISH_CLOCK_KEY)
  }
}
