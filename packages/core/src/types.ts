// Canonical data model. See docs/02-data-sources.md. Operators use incompatible IDs upstream;
// everything here is normalized so the apps see one shape.
//
// **These types are no longer declared here.** They are `z.infer` of the Zod schemas in
// `@nextbus/contract`, which are the single declaration of every shape that crosses the network
// (ADR-052). Rename a field in a schema and the error lands *here*, in the consumers, at typecheck
// time — there is no second copy to forget to update, and no generated file to re-run.
//
// Note that every import in this file is `import type`. That is not stylistic:
//
//   · `import type` is erased entirely, so this module compiles to `export {};` and **zod never
//     enters a client's runtime graph**. `packages/core` is the layer we intend to hand-port to
//     Swift and Kotlin, and it keeps a runtime dependency list of exactly nothing.
//   · The flip side, stated so nobody is surprised by it: the app therefore performs **no runtime
//     validation** of wire payloads. Unknown enum members reach a `switch` as ordinary strings.
//     That is why unknown-enum tolerance is enforced at native codegen (WP3-3) and by the edge
//     conformance test — nothing in the TS build can fail to remind us.
//
// `scripts/check-type-only-contract.mjs` gates both properties in CI. If you add a value import to
// this file, that check will fail, and it is right.

import type {
  BoundSchema,
  ClientFrameSchema,
  ClientPolicySchema,
  DeltaFrameSchema,
  ErrorCodeSchema,
  ErrorResponseSchema,
  EtaRefSchema,
  EtaSchema,
  FreqBandSchema,
  FreqPatternSchema,
  I18nTextSchema,
  LatLngSchema,
  LiveStateSchema,
  LocaleSchema,
  NearbyStopSchema,
  OperatorIdSchema,
  OperatorSchema,
  PingFrameSchema,
  PlaceSchema,
  PongFrameSchema,
  RemarkKindSchema,
  RouteDetailSchema,
  RouteRefSchema,
  RouteSchema,
  RouteServiceInfoSchema,
  RouteServiceSummarySchema,
  RouteStopSchema,
  RouteSummarySchema,
  ServerFrameSchema,
  ServiceDayTypeSchema,
  SnapshotFrameSchema,
  StatusFrameSchema,
  StopDetailSchema,
  StopSchema,
  SubscribeFrameSchema,
  WatchTargetSchema,
  WireErrorSchema,
} from '@nextbus/contract'
import type { z } from 'zod'

/** Supported UI + data locales. Traditional Chinese is the primary HK form. */
export type Locale = z.infer<typeof LocaleSchema>

/** Localized text; every name from the operators carries these variants. */
export type I18nText = z.infer<typeof I18nTextSchema>

/** Operators in scope. v1 = KMB/LWB + Citybus + Green Minibus (GMB); rail/NLB/MTR-Bus
 *  tracked in the backlog. */
export type OperatorId = z.infer<typeof OperatorIdSchema>

/** Direction of travel. */
export type Bound = z.infer<typeof BoundSchema>

/** A geographic coordinate (WGS84). */
export type LatLng = z.infer<typeof LatLngSchema>

export type Operator = z.infer<typeof OperatorSchema>

/** A canonical bus stop, with the per-operator source IDs it was merged from. */
export type Stop = z.infer<typeof StopSchema>

/** A physical-location grouping of stops (e.g. KMB + CTB stops at the same kerb). */
export type Place = z.infer<typeof PlaceSchema>

/**
 * Static service facts for a route direction, **full** tier — includes `patterns`. All optional;
 * this is the **Static** honesty tier (never styled as live). Fares are HK$ kept as the upstream
 * string to avoid float drift, and are *sectional* — riders boarding later pay less — so
 * `fareFull` is the fare from the origin; the per-boarding-stop fare rides on the stop/ETA records.
 */
export type RouteServiceInfo = z.infer<typeof RouteServiceInfoSchema>

/** Static service facts at the **summary** tier — no frequency profiles. What a stop response
 *  carries (ADR-065): the field is absent from the type, so absence can't be misread as a fact
 *  about the route. */
export type RouteServiceSummary = z.infer<typeof RouteServiceSummarySchema>

/** Which days a frequency pattern runs. `other` = an uncommon mix (e.g. Mon–Sat); the UI
 *  falls back to the exact `days` mask for those. */
export type ServiceDayType = z.infer<typeof ServiceDayTypeSchema>

/** One frequency band within a day: buses roughly every `headwayMin` minutes between `start`
 *  and `end` (local 24h "HH:mm"; past-midnight bands wrap, e.g. "25:35" → "01:35"). */
export type FreqBand = z.infer<typeof FreqBandSchema>

/**
 * A day-type's frequency profile — the bands the badge's coarse min–max is derived from, plus the
 * first/last departure (ADR-044). The **Static** honesty tier — a coarse timetable summary.
 */
export type FreqPattern = z.infer<typeof FreqPatternSchema>

/** A route at full service fidelity — what `/v1/route/:id` returns. */
export type Route = z.infer<typeof RouteSchema>

/** A route as it appears in a stop response: same fields, summary service tier (ADR-065). */
export type RouteSummary = z.infer<typeof RouteSummarySchema>

/** One stop in a route's ordered sequence. */
export type RouteStop = z.infer<typeof RouteStopSchema>

/** A normalized estimated-arrival reading. ETAs are approximations — see eta.ts. */
export type Eta = z.infer<typeof EtaSchema>

/** The coarse class of an operator ETA remark. Served as `Eta.remarkKind` (ADR-053) and still
 *  derivable offline with `classifyRemark`. Treat it as open — the vocabulary will grow. */
export type RemarkKind = z.infer<typeof RemarkKindSchema>

/** A lightweight pointer to another route direction — just enough to label a toggle and
 *  load it (`getRoute(id)`); the full detail comes from that call. ADR-046. */
export type RouteRef = z.infer<typeof RouteRefSchema>

/** Route + its ordered stops — returned by DataSource.getRoute. Each stop carries the route's own
 *  next arrival *there* (`eta`), so a route view can show per-stop times and infer bus positions
 *  (ADR-030). `eta` is null where no live reading is available. */
export type RouteDetail = z.infer<typeof RouteDetailSchema>

/** A stop (or merged same-kerb place) + the routes that serve it, each with its current ETA. For a
 *  multi-pole place, `stopId` on each route is the canonical id of the *member pole* it departs
 *  from (ADR-042), and `members` carries each pole's id/name/location. */
export type StopDetail = z.infer<typeof StopDetailSchema>

/** A nearby stop (or merged place) with distance + its soonest arrivals. */
export type NearbyStop = z.infer<typeof NearbyStopSchema>

/** Why a request failed, in the vocabulary every failure is classified into (ADR-064). Treat it as
 *  open — the server may mint a member this build has never heard of, which is what `retryable`
 *  on the envelope is for. */
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

/** A failure as a body: the code to branch on, prose for a human, and whether to try again. One
 *  declaration for both transports — the HTTP envelope extends it, and `StatusFrame.error` is it. */
export type WireError = z.infer<typeof WireErrorSchema>

/** The envelope every non-2xx JSON response carries. `retryable` is the one field a background
 *  client needs: `false` means prune the request, not retry it. */
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>

/** A policy document **as it arrives**: every field optional, because a partial policy is a legal
 *  policy (ADR-053) and a cold start has none at all. Resolve it with `resolveClientPolicy` before
 *  reading a field — this type is the wire, not something a screen should branch on. */
export type ClientPolicy = z.infer<typeof ClientPolicySchema>

// ── The live protocol (WP5-1) ────────────────────────────────────────────────────────────────
//
// Frames are wire shapes like any other, so they are `z.infer` of the contract's declarations rather
// than hand-written interfaces here. `WatchTarget` in particular *was* hand-written — in
// `datasource.ts`, from the days when `watch()` was a polling shim whose targets never left the
// process. It crosses the wire now, so it moved to `packages/contract/src/wire/live.ts` and arrives
// here like everything else. `EtaListener` and `Subscription` stay in `datasource.ts`: they are
// function types, and a function is not a shape a schema can describe.

/** One thing a client wants live readings for. `routeIds` absent means every route at the stop. */
export type WatchTarget = z.infer<typeof WatchTargetSchema>

/** The identity of one live reading — the same `(stopId, routeId)` tuple a favourite key encodes. */
export type EtaRef = z.infer<typeof EtaRefSchema>

/** What a live connection is doing. Treat it as open; the vocabulary will grow. */
export type LiveState = z.infer<typeof LiveStateSchema>

/** Client → server: the complete target set for this connection. It replaces; it does not add. */
export type SubscribeFrame = z.infer<typeof SubscribeFrameSchema>

/** Client → server keepalive, answered without waking a hibernated shard. */
export type PingFrame = z.infer<typeof PingFrameSchema>

/** The keepalive answer. */
export type PongFrame = z.infer<typeof PongFrameSchema>

/** Server → client: the accepted target set and every reading held for it. */
export type SnapshotFrame = z.infer<typeof SnapshotFrameSchema>

/** Server → client: what changed, and what is gone. */
export type DeltaFrame = z.infer<typeof DeltaFrameSchema>

/** Server → client: the connection state, and the failure behind it. */
export type StatusFrame = z.infer<typeof StatusFrameSchema>

/** Anything a client may send. */
export type ClientFrame = z.infer<typeof ClientFrameSchema>

/** Anything the server may send — what `applyLiveFrame` reduces. */
export type ServerFrame = z.infer<typeof ServerFrameSchema>

/**
 * A policy with every field present — what `resolveClientPolicy` returns and what UI reads.
 *
 * `Required<ClientPolicy>` rather than a second hand-written interface, so adding a knob to the
 * schema cannot leave a resolved type that silently lacks it: `resolveClientPolicy` stops
 * typechecking until it fills the new field, which is the reminder we want at exactly that moment.
 */
export type ResolvedClientPolicy = Required<ClientPolicy>
