// The live protocol: every frame that crosses the `/v1/live` socket, declared once. See the three
// rules at the top of `primitives.ts` — they hold here too.
//
// **Why the socket gets its own module and not a row in `WIRE_ENDPOINTS`.** That registry exists so an
// endpoint cannot be documented without also being exercised: both the OpenAPI emit and
// `apps/edge/test/wire-conformance.test.ts` iterate it, and the test asserts a real `Response` body
// against the declared schema (`wire/responses.ts:1-8`). A socket has no `Response` body to conform —
// its payloads are frames on an already-upgraded connection — so forcing `/v1/live` into the registry
// would add a row the conformance test cannot check while making the OpenAPI document claim a GET
// endpoint that returns `101`. That is precisely the shape of failure the registry was built to
// prevent, so the socket declares itself here and `LIVE_CHANNEL` (bottom of this file) is what the
// AsyncAPI assembly reads instead.
//
// **What these frames deliberately do not carry.** Two omissions, both load-bearing:
//
//  0. **They *did* deliberately not carry `failed`, and that changed in WP5-14 (ADR-081).** ADR-073 left the
//     failure set off the frames because the shard applies the retention itself, so a client could learn
//     from the retained readings plus `retrying` — and ADR-077 recorded the cost in one sentence: *"the fix
//     is frames that carry `failed`, which is a wire change to make when a screen renders per-kerb
//     failure."* WP5-7 made Nearby a live adopter, and its card renders exactly that, so the reader now
//     exists. What that costs is stated at the field: a frame restates the **complete** set, an absent
//     field means empty, and a round whose failure set moved is therefore *news* even when no reading did —
//     otherwise a recovered kerb's marker would outlive the recovery by a cadence.
//  1. **No engine or transport label.** WP5-1's acceptance is byte-identical listener output from the
//     poll emulator and a socket fake. A `transport: 'poll' | 'socket'` field would make the two
//     differ *by construction* — the criterion could not be met by any implementation, and the one
//     property the wave exists to prove would be untestable. Which engine is driving is the
//     controller's business (`packages/api-client`), not the protocol's, and a client that needs to
//     know is a client that has grown a behaviour difference we would rather see fail a test.
//  2. **No `observed` list and no restamping.** A frame never re-stamps `Eta.observedAt` or
//     `Eta.dataTimestamp`. Staleness is judged from `dataTimestamp` — the *operator's* clock (see
//     `isStale` in `@nextbus/core`) — so re-observing a pole and getting the identical operator
//     reading back is genuinely not news, and a protocol that reported it as an update would make
//     every poll round a full repaint and the delta half of this design pointless. It would also turn
//     a replayed offline reading into a fresh-looking one, which is the ADR-008 violation this whole
//     design is arranged to avoid (ADR-058).

import { z } from 'zod'
import { EtaFailureSchema, WireErrorSchema } from './errors'
import { EtaSchema } from './eta'
import type { WireParam } from './responses'

/**
 * The socket's path, relative to the API origin.
 *
 * One declaration, three readers: the Worker's router, the AsyncAPI channel `address` below, and
 * `liveSocketUrl` in `@nextbus/core`, which derives `wss://…/v1/live` from the configured API URL
 * (D5 — no new environment variable). The kernel cannot import this value at runtime (ADR-052
 * decision 2 makes `core → contract` type-only), so it restates the literal and pins it with
 * `typeof LIVE_PATH`; a typecheck error is what happens if the two ever disagree. See the note at
 * that constant.
 */
export const LIVE_PATH = '/v1/live'

/**
 * The keepalive pair, as the exact bytes that go on the wire.
 *
 * These are strings rather than `JSON.stringify(PingFrame)` at the call site because **Cloudflare's
 * hibernation auto-response matches a request string byte-for-byte**:
 * `state.setWebSocketAutoResponse(new WebSocketRequestResponsePair(request, response))` replies
 * without waking the Durable Object only when the incoming message equals `request` exactly. One
 * different byte — a space after the colon, keys in the other order — and every keepalive wakes the
 * object instead, which is the difference between a hibernated shard costing nothing and one billed
 * for wall-clock duration around the clock. So both sides read the same constant, and
 * `buildAsyncApiDocument()` asserts that these two strings really are the JSON encoding of
 * `PingFrameSchema` / `PongFrameSchema` rather than trusting that they look like it.
 */
export const LIVE_PING_MESSAGE = '{"type":"ping"}'
/** The auto-response half of the pair. See `LIVE_PING_MESSAGE`. */
export const LIVE_PONG_MESSAGE = '{"type":"pong"}'

/**
 * One thing a client wants live readings for: a stop, optionally narrowed to some of its routes.
 *
 * Moved here from a hand-written interface in `packages/core/src/datasource.ts` because it now
 * crosses the wire — it is what a `subscribe` frame carries and what `?targets=` names — and this
 * repo keeps exactly one declaration per wire shape (ADR-052). `@nextbus/core` re-exports
 * `z.infer` of it from `src/types.ts` like every other wire type, so the seam's signature is
 * unchanged; `EtaListener` and `Subscription` stay hand-written in `datasource.ts`, because they are
 * function types and a function is not a shape a schema can describe.
 *
 * `routeIds` absent means *every route at the stop*. It is deliberately not the same thing as an
 * empty array: an empty array asks for no routes at all, which is a subscription that cannot ever
 * produce a reading, and `acceptTargets` in `@nextbus/core` rejects it rather than quietly showing an
 * empty screen.
 */
export const WatchTargetSchema = z
  .object({
    stopId: z
      .string()
      .describe(
        'Canonical stop id ("KMB:1234") or merged place id ("P:<a>+<b>"). Validated with the same parser the HTTP endpoints use, so a malformed favourite is dropped identically on every transport.',
      ),
    routeIds: z
      .array(z.string())
      .optional()
      .describe(
        'Canonical route ids to narrow the stop to. **Absent means every route at the stop**; an empty array is not a legal narrowing (it asks for nothing) and is rejected rather than honoured.',
      ),
  })
  .meta({ id: 'WatchTarget' })

/**
 * The identity of one live reading: the route-at-stop tuple, and nothing else.
 *
 * This is the same pair `formatFavoriteRouteKey` encodes as `<stopId>|<routeId>` (D3), which is not a
 * coincidence worth hiding — a Widget watching a saved favourite maps 1:1 onto a live target, so the
 * two grammars must not drift. It exists as its own schema because a `delta` has to be able to say
 * *gone*: polling replaces the whole payload, so a departed bus disappears for free, whereas a delta
 * protocol without this list strands the last reading for a route on screen for ever — the silent
 * staleness ADR-008 forbids (D2).
 */
export const EtaRefSchema = z
  .object({
    stopId: z.string(),
    routeId: z.string(),
  })
  .meta({ id: 'EtaRef' })

/**
 * What the client's live connection is doing, as the client should describe it to a rider.
 *
 * `connecting` covers the first attempt, `retrying` a reconnect after a failure — two states rather
 * than one because they read differently: the first is "wait a moment", the second is "we are not
 * getting data and we know it". `closed` is deliberate teardown, not failure.
 *
 * `x-unknown-tolerant` because this vocabulary will grow — a `degraded` state for "connected but the
 * shard cannot reach upstream" is the obvious next member — and a generated native decoder must not
 * throw on a state it has never heard of (ADR-052 decision 4).
 */
export const LiveStateSchema = z
  .enum(['connecting', 'live', 'retrying', 'closed'])
  .meta({ id: 'LiveState', 'x-unknown-tolerant': true })

// ── Client → server ──────────────────────────────────────────────────────────────────────────

/**
 * The complete set of targets this connection wants. **It replaces; it does not add.**
 *
 * Stated as a replacement because the alternative — `subscribe`/`unsubscribe` deltas over a set — is
 * a shared-state protocol whose two ends drift silently: a dropped `unsubscribe` leaves a shard
 * polling a stop nobody is looking at, and nothing in either end's state says so. A full
 * re-declaration is idempotent, is what a reconnect has to send anyway, and makes the server's
 * accepted set checkable against the client's intent in one comparison. The cost is the frame is
 * bigger; a set of a dozen canonical ids is a few hundred bytes and incoming frames are the 1/20
 * meter, so it is not a cost worth a drift surface.
 */
export const SubscribeFrameSchema = z
  .object({
    type: z.literal('subscribe'),
    targets: z
      .array(WatchTargetSchema)
      .describe(
        'The complete target set for this connection, replacing whatever it declared before. An empty array is a legal frame — it means "stop sending me readings" without closing the socket.',
      ),
  })
  .meta({ id: 'SubscribeFrame' })

/**
 * Client keepalive. Answered by `PongFrame` **without waking a hibernated Durable Object**, provided
 * the bytes match `LIVE_PING_MESSAGE` exactly. Incoming protocol pings are not billed at all and
 * auto-responses accrue no duration, so this is the one thing a client may send freely.
 */
export const PingFrameSchema = z.object({ type: z.literal('ping') }).meta({ id: 'PingFrame' })

// ── Server → client ──────────────────────────────────────────────────────────────────────────

/** The keepalive answer. See `PingFrameSchema`. */
export const PongFrameSchema = z.object({ type: z.literal('pong') }).meta({ id: 'PongFrame' })

/**
 * The whole current truth for this connection: what the server accepted, and every reading it holds.
 *
 * **`targets` echoes the *accepted* set, and that echo is the point.** A client asks for six places;
 * one id no longer parses, or its shard refuses it. Without the echo the client sees five stops'
 * readings and cannot tell a dropped target from a stop with no buses due — a silent filter, which
 * ADR-008 rules out as firmly as a fake countdown. With it, the client can say "we are not watching
 * this one" in the same breath as it draws the other five. `acceptTargets` in `@nextbus/core` is the
 * one rule that decides the set, so both transports drop the same malformed favourite.
 */
export const SnapshotFrameSchema = z
  .object({
    type: z.literal('snapshot'),
    seq: z
      .number()
      .int()
      .describe(
        'Monotonic frame counter for this connection, starting at 1. A client compares it with the last frame it applied to notice a gap; `0` is never sent — it is the client-side "nothing applied yet" sentinel.',
      ),
    at: z
      .string()
      .describe(
        'When the server assembled this frame. ISO-8601, **`Z`-suffixed UTC** — not the `+08:00` the conventions list describes, because this is stamped by our own layer with `Date#toISOString()` exactly as `Eta.observedAt` is. Parse it as an instant; never compare it lexically against a `+08:00` timestamp such as `Eta.dataTimestamp`.',
      ),
    targets: z
      .array(WatchTargetSchema)
      .describe(
        'The target set the server **accepted** — not the set that was asked for. Compare it with what you sent and tell the rider about the difference.',
      ),
    etas: z
      .array(EtaSchema)
      .describe(
        'Every reading the server currently holds for the accepted targets, in canonical (stopId, routeId) code-point order. A route with no reading right now is simply absent, exactly as in `/v1/etas/{id}`.',
      ),
    failed: z
      .array(EtaFailureSchema)
      .optional()
      .describe(
        'Boarding points whose upstream board did not answer this round, ordered by `stopId` in code-point order — the complete current set, **restated in full on every data frame that carries it**, never a patch. **Absent means there are none**, so a client clears what it was holding: an absent optional cannot say both "unchanged" and "empty", and clearing is the direction that loses information rather than inventing it (ADR-077 decision 1, ADR-081). A reading missing from the readings for a pole named here has NOT departed — we could not ask — and `retainFailedPoles` in `@nextbus/core` is what a stateful client does about that. Pole ids only: a whole *target* that could not be answered is a `status` frame, and a permanent one is a re-echoed snapshot, because `EtaFailure.stopId` is a boarding point and a target may be a merged place (ADR-073 decision 2).',
      ),
  })
  .meta({ id: 'SnapshotFrame' })

/**
 * What changed since the previous frame — and, just as importantly, what is gone.
 *
 * `gone` is not an optimisation. Polling replaces the whole payload, so a bus that has departed
 * vanishes for free; a delta stream without `gone` leaves that route's last reading on screen for
 * ever, ageing silently. The client-side reducer honours it (`applyLiveFrame` in `@nextbus/core`),
 * and the corpus pins that it does (D2).
 *
 * A `delta` presumes the receiver already applied the snapshot at `seq - 1`. It does **not** presume
 * the receiver *checks* that — the reducer applies what a gappy delta carries and reports
 * `resyncNeeded` rather than throwing, because dropping the frame as well as the gap would leave the
 * screen further behind than the data we were just handed.
 */
export const DeltaFrameSchema = z
  .object({
    type: z.literal('delta'),
    seq: z
      .number()
      .int()
      .describe(
        'Monotonic frame counter for this connection. A receiver expecting `seq` and given `seq + 2` has missed a frame: apply this one, then ask for a fresh snapshot.',
      ),
    at: z
      .string()
      .describe(
        'When the server assembled this frame. ISO-8601 `Z`-suffixed UTC — see SnapshotFrame.',
      ),
    changed: z
      .array(EtaSchema)
      .describe(
        'Readings that are new or whose content differs from the last one sent, in canonical (stopId, routeId) order. "Differs" excludes `observedAt`: a re-observation that yields the identical operator reading is not a change, and reporting it would make every round a full repaint.',
      ),
    gone: z
      .array(EtaRefSchema)
      .describe(
        'Readings the server no longer has — the bus departed, or the target was dropped. Remove them; do not leave the last value on screen.',
      ),
    failed: z
      .array(EtaFailureSchema)
      .optional()
      .describe(
        'Boarding points whose upstream board did not answer this round, ordered by `stopId` in code-point order — the complete current set, **restated in full on every data frame that carries it**, never a patch. **Absent means there are none**, so a client clears what it was holding: an absent optional cannot say both "unchanged" and "empty", and clearing is the direction that loses information rather than inventing it (ADR-077 decision 1, ADR-081). A reading missing from the readings for a pole named here has NOT departed — we could not ask — and `retainFailedPoles` in `@nextbus/core` is what a stateful client does about that. Pole ids only: a whole *target* that could not be answered is a `status` frame, and a permanent one is a re-echoed snapshot, because `EtaFailure.stopId` is a boarding point and a target may be a merged place (ADR-073 decision 2).',
      ),
  })
  .meta({ id: 'DeltaFrame' })

/**
 * The connection's own state, and the failure that put it there.
 *
 * Separate from the data frames so a client can say "we are retrying" without discarding the
 * readings it is already showing — the honest thing to do, since a 40-second-old reading with a
 * "reconnecting" label is more use to a rider at a kerb than an empty screen.
 */
export const StatusFrameSchema = z
  .object({
    type: z.literal('status'),
    at: z
      .string()
      .describe(
        'When the server assembled this frame. ISO-8601 `Z`-suffixed UTC — see SnapshotFrame.',
      ),
    state: LiveStateSchema,
    error: WireErrorSchema.optional().describe(
      'Present when `state` reflects a failure. Branch on `code`; let `retryable` decide whether to try again or to stop asking. Absent on an ordinary transition.',
    ),
  })
  .meta({ id: 'StatusFrame' })

// ── The two unions ───────────────────────────────────────────────────────────────────────────
//
// `z.discriminatedUnion` emits `oneOf` + `$ref`s, which is what AsyncAPI's channel `messages` map
// needs. It does **not** emit AsyncAPI's own `discriminator` field, and nothing in the AsyncAPI
// toolchain checks the spec's "every message MUST be valid against one, and only one, of the message
// objects" MUST — so `buildAsyncApiDocument()` checks it for us: every frame schema must require
// `type` and pin it to a `const`, and the consts must be pairwise distinct. That matters more here
// than it looks, because `WIRE_JSON_SCHEMA_OPTIONS` strips `additionalProperties: false` for forward
// compatibility (see `json-schema.ts`), which leaves two open frame objects trivially
// co-satisfiable: without a pinned `type`, an open `{"type":"delta","seq":9}` also validates against
// an open Snapshot whose other keys are optional.

/** Everything a client may send. */
export const ClientFrameSchema = z
  .discriminatedUnion('type', [SubscribeFrameSchema, PingFrameSchema])
  .meta({ id: 'ClientFrame' })

/** Everything the server may send. */
export const ServerFrameSchema = z
  .discriminatedUnion('type', [
    SnapshotFrameSchema,
    DeltaFrameSchema,
    StatusFrameSchema,
    PongFrameSchema,
  ])
  .meta({ id: 'ServerFrame' })

// ── The channel ──────────────────────────────────────────────────────────────────────────────

/** One frame as the AsyncAPI document lists it: a message name, its payload schema, and why it exists. */
export interface LiveMessage {
  /** The `components.messages` key and the message `name`. Must match `^[\w\d\.\-_]+$`. */
  name: string
  summary: string
  /** The payload schema. Must carry `.meta({ id })` — the assembly refuses to inline a frame body. */
  payload: z.ZodType
}

/**
 * The socket channel, in the same declarative shape `WIRE_ENDPOINTS` uses for JSON endpoints —
 * `buildAsyncApiDocument()` iterates it exactly as `buildOpenApiDocument()` iterates that registry.
 *
 * `query` reuses `WireParam`, the parameter shape the OpenAPI paths already use, so "a request
 * parameter" is declared once for both documents. AsyncAPI forbids query parameters in a channel
 * `address` ("Query parameters and fragments SHALL NOT be used, instead use bindings") so these are
 * emitted into `bindings.ws.query` instead — the reason this list exists separately from the address.
 */
export interface LiveChannel {
  address: string
  title: string
  summary: string
  /** Frames the client sends to the Worker — `action: receive` from the Worker's point of view. */
  clientFrames: readonly LiveMessage[]
  /** Frames the Worker sends to the client — `action: send`. */
  serverFrames: readonly LiveMessage[]
  /** The connect URL's query parameters, all `in: 'query'`. */
  query: readonly WireParam[]
}

export const LIVE_CHANNEL = {
  address: LIVE_PATH,
  title: 'Live ETA stream',
  summary:
    'One socket per client. The client declares its targets in the connect URL and again in a `subscribe` frame; the Worker routes it to a shard, and the shard pushes a `snapshot` then `delta`s on an adaptive alarm cadence (~45–60 s, which is the measured upstream refresh interval — a faster cadence buys no newer data).',
  clientFrames: [
    {
      name: 'Subscribe',
      summary: 'Declare the complete target set for this connection.',
      payload: SubscribeFrameSchema,
    },
    {
      name: 'Ping',
      summary: 'Keepalive. Auto-answered without waking the shard.',
      payload: PingFrameSchema,
    },
  ],
  serverFrames: [
    {
      name: 'Snapshot',
      summary:
        'The accepted target set, every reading held for it, and the kerbs that would not answer.',
      payload: SnapshotFrameSchema,
    },
    {
      name: 'Delta',
      summary:
        'Readings that changed, readings that are gone, and the kerbs that would not answer.',
      payload: DeltaFrameSchema,
    },
    {
      name: 'Status',
      summary: 'The connection state, and the failure behind it.',
      payload: StatusFrameSchema,
    },
    { name: 'Pong', summary: 'The keepalive answer.', payload: PongFrameSchema },
  ],
  query: [
    {
      name: 'targets',
      in: 'query',
      required: true,
      type: 'string',
      description:
        'Comma-separated canonical stop or place ids. **Percent-encode the value** — place ids contain "+", which a query string decodes as a space, so an unencoded `P:KMB:a+KMB:b` arrives as a malformed id and is dropped; this is the same requirement `/v1/stop/{id}` states for the same reason. The **server** derives the shard from this list (sorted ids → FNV-1a over the lowest → `% shardCount`, `liveShardFor` in `@nextbus/core`), so a client with a stale shard count cannot silently land on a different shard — it does not compute one. The `subscribe` frame re-declares the same set, with optional per-stop route narrowing this parameter cannot express.',
    },
  ],
} as const satisfies LiveChannel
