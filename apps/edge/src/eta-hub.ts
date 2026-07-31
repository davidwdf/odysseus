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
//    accepted target set echoed back, plus every reading this shard already holds for it.
//  · Each alarm round sends a `delta`, and **sends nothing at all when nothing changed.** No empty
//    delta, no heartbeat. Incoming WebSocket messages bill at 20:1 and outgoing ones are free, so the
//    cost of a needless frame is not the byte but the repaint: `applyLiveEtasToStopDetail` rebuilds
//    every row it is handed, and staleness is already honest from each reading's own `dataTimestamp`.
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
  LIVE_CADENCE_RAMP_ROUNDS,
  nextLiveCadenceMs,
  type ServerFrame,
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
// So there are three caps, each bounding a different quantity, and each with a stated arithmetic. They
// are not tuned against a measurement, because there is no deployment to measure (WP0-5); they are
// derived from the platform's own published limits and from the fixture's shape, and the numbers are
// the part a reviewer should be able to disagree with.

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
 * Forty-eight. The arithmetic: a round issues one `stopEtas` per distinct target, each of which reads a
 * place document (a colo-cached KV point read) and fans out to one upstream call per member pole,
 * deduplicated across the whole round by `coalesce` (ADR-057). The fixture's places average 2 poles and
 * a real Hong Kong interchange runs to 3–4, so 48 targets is ~100–150 upstream calls; Cloudflare allows
 * **6 simultaneous outgoing connections per invocation**, so those queue in ~20 rounds of ~300 ms ≈ 6 s
 * — comfortably inside both the 45 s cadence floor and an alarm's 15-minute wall clock, with the
 * subrequest budget (10,000 on Paid) an order of magnitude clear.
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
  return { targets: candidate.targets, seq: candidate.seq, announcedLive: candidate.announcedLive }
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

/** One target's answer for one round: readings, or the failure that came instead. */
type RoundResult = { target: WatchTarget; etas: Eta[] } | { target: WatchTarget; error: WireError }

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
    const { accepted, rejected } = acceptTargets(asked)
    return {
      kept: accepted.slice(0, LIVE_MAX_TARGETS_PER_CONNECTION),
      dropped: [...rejected, ...accepted.slice(LIVE_MAX_TARGETS_PER_CONNECTION)],
    }
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
    const fits: WatchTarget[] = []
    for (const target of kept) {
      const union = acceptTargets([...others, ...fits, target]).accepted
      if (union.length > LIVE_MAX_TARGETS_PER_SHARD) break
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
    const session: Session = { targets: fits, seq, announcedLive: true }
    ws.serializeAttachment(session)

    const stored = this.storedReadings()
    const at = frameAt(Date.now())
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
    })

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
          `shard is at capacity (${LIVE_MAX_TARGETS_PER_SHARD} targets), not watching: ${excess
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
    } else {
      // Something has to move the client's session out of `connecting`, or a screen sits under a
      // "connecting" label while the snapshot's readings are already drawn behind it.
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
          // a 30 s TTL (ADR-057, WP0-4). A shard with its own fetcher would double the upstream rate
          // for every stop that is also being served over HTTP.
          return { target, etas: await stopEtas(dataset, target.stopId, target.routeIds) }
        } catch (err) {
          return { target, error: wireErrorOf(err) }
        }
      }),
    )

    const failures = new Map<string, WireError>()
    const after = new Map<string, readonly Eta[]>()
    for (const result of results) {
      if ('etas' in result) {
        after.set(result.target.stopId, result.etas)
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
      this.sendRound(ws, session, before, after, failures)
    }

    this.writeReadings(before, after)
    this.writeUnchangedRounds(quiet ? this.unchangedRounds() + 1 : 0)
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

    const mine = session.targets
      .map((target) => failures.get(target.stopId))
      .filter((error): error is WireError => error !== undefined)
    const permanent = mine.filter((error) => !error.retryable)

    let seq = session.seq
    if (permanent.length > 0) {
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
      })
    } else if (changed.length > 0 || gone.length > 0) {
      seq += 1
      this.send(ws, { type: 'delta', seq, at: frameAt(Date.now()), changed, gone })
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
    const announcedLive = mine.length === 0
    if (announcedLive && !session.announcedLive) this.send(ws, this.status('live'))

    if (
      seq !== session.seq ||
      announcedLive !== session.announcedLive ||
      kept !== session.targets
    ) {
      // Re-serialized because a mutation of the object the attachment was built from is *not* captured;
      // the runtime snapshots at the call.
      ws.serializeAttachment({ targets: kept, seq, announcedLive } satisfies Session)
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
    const delay = nextLiveCadenceMs({ subscribers, unchangedRounds: this.unchangedRounds() })

    if (delay === null) {
      await this.ctx.storage.deleteAlarm()
      this.forgetReadings()
      return
    }

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
  }
}
