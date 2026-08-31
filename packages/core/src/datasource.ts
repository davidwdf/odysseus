import type { SearchIndex } from './search'
import type {
  ClientPolicy,
  Eta,
  EtaBatch,
  EtaFailure,
  EtaReport,
  LatLng,
  NearbyStop,
  RouteDetail,
  RoutePath,
  StopDetail,
  WatchTarget,
} from './types'

/** A live subscription to ETA updates. Call `unsubscribe` to release it. */
export interface Subscription {
  unsubscribe(): void
}

// `WatchTarget` used to be declared here, as a hand-written interface. It is now `z.infer` of
// `WatchTargetSchema` and re-exported from `./types` like every other wire shape, because since WP5-1
// it crosses the network — it is what a `subscribe` frame carries and what `/v1/live?targets=` names.
// Two declarations of a shape that travels are two declarations that can disagree (ADR-052).
// `Subscription` and `EtaListener` stay here: they are function types, which no schema describes.

/**
 * What a subscription hands a screen: every current reading, and the boarding points it could not ask
 * about (WP5-14, ADR-081).
 *
 * **`failed` is a trailing optional parameter, which is what makes it not a change to the seam.** ADR-004
 * fixes `watch()` as `(targets, onUpdate) => Subscription`, and every listener already written stays
 * assignable — a one-parameter function is a valid two-parameter one in TypeScript, in Swift with a
 * default, and in Kotlin. So no caller *had* to change, and the two that wanted to (the Nearby and Place
 * hooks) pass it straight into the kernel's merge helpers, which have taken a failure set since ADR-077.
 *
 * Absent and empty mean the same thing here, deliberately: a listener that received `undefined` and one
 * that received `[]` must render identically, because on the wire the field is omitted when empty and a
 * fake transport is free to materialise it. `StopCardView.incomplete` reads length, never presence, for
 * exactly that reason (ADR-077 decision 4).
 *
 * **A round can call this with unchanged readings and a changed failure set**, which is new. The
 * identity guard in `EdgeClient.watch` used to skip any update whose `etas` array was the same object;
 * it now also asks whether the failure set moved, or the one round that matters most — a kerb starting to
 * refuse while every other reading stands still — would be swallowed at the door.
 */
export type EtaListener = (etas: Eta[], failed?: EtaFailure[]) => void

/**
 * What a caller may tell `watch()` about how to run, as opposed to what to watch.
 *
 * **Why this exists at all**, since one optional number is a suspicious sort of interface: the served
 * `refreshAfterMs` (ADR-053) reaches a screen through `useClientPolicy`, but `watch()`'s engine is built
 * inside a `DataSource` that was constructed at module scope, long before any policy had been fetched. So
 * the engine fell back to `CLIENT_POLICY_DEFAULTS` — the compiled-in number — and a served override
 * stopped reaching the one cadence it most obviously governs. That is the *same* defect ADR-053 was
 * written to end (a threshold the edge can move, in force nowhere), rebuilt one layer down, and it had
 * already put a claim in a screen comment that the code did not honour.
 *
 * A caller that knows the resolved policy passes it; a caller that does not gets the default, which is
 * what a cold start has anyway.
 *
 * The rejected alternative, recorded because it is the tempting one: have the engine fetch `/v1/policy`
 * itself. It needs no threading and would serve a future Widget automatically — but it duplicates a fetch
 * every screen already makes through its query cache, and it gives the transport a network dependency of
 * its own, which is exactly what makes a transport hard to fake. Threading it keeps the engine offline and
 * the test deterministic.
 */
export interface WatchOptions {
  /**
   * The resolved `ClientPolicy.refreshAfterMs`, ms. A polling engine uses it as its cadence; a socket
   * engine has no use for it and ignores it, which is the honest asymmetry — this is advice about
   * freshness, not an instruction about mechanism.
   */
  refreshAfterMs?: number
}

/**
 * The single seam between the apps and the data layer (see docs/03-architecture.md).
 *
 * - v1 implementation: edge proxy + cache; `watch()` is a polling shim.
 * - v2 implementation: normalization engine + Durable Objects; `watch()` is a real
 *   WebSocket subscription.
 *
 * The UI is identical against either implementation.
 */
export interface DataSource {
  /** Stops near a point, soonest arrivals first. v1 finds candidates on-device. */
  getNearby(at: LatLng, radiusM: number): Promise<NearbyStop[]>
  /** A route and its ordered stop list (static), with live ETAs where available. */
  getRoute(routeId: string): Promise<RouteDetail>
  /**
   * The road-following line for one route direction (ADR-152).
   *
   * **Separate from `getRoute` on purpose.** The geometry changes on the order of a fortnight where
   * the arrivals change every round, so joining them would tie a day-cacheable body to a 30-second
   * one — and a route screen is useful long before the line arrives. A caller shows the stop list
   * first and the line when it lands.
   *
   * `available: false` is an ordinary answer for ~7% of route-directions, not an error.
   */
  getRoutePath(routeId: string): Promise<RoutePath>
  /** A stop and every route serving it, each with its next arrival. */
  getStop(stopId: string): Promise<StopDetail>
  /**
   * Live ETAs for a stop (optionally filtered to specific routes), **and the boarding points whose
   * upstream board would not answer** (ADR-073).
   *
   * It returns an `EtaReport` rather than a bare `Eta[]`, and the extra field is not a diagnostic:
   * it is what makes the list interpretable. An empty `etas` used to mean two different things — no
   * buses due, or nobody would tell us — and a stateful caller has to tell them apart, because
   * treating the second as the first reports every reading it holds as departed. `retainFailedPoles`
   * in `@nextbus/core` is the rule for that, and both live engines apply it.
   *
   * `failed` is absent when every board answered, which is the common case and the cheap one.
   */
  getEtas(stopId: string, routeIds?: string[]): Promise<EtaReport>
  /**
   * The same answer as `getEtas`, for up to `ETAS_BATCH_MAX_IDS` ids, in **one** request (WP5-7).
   *
   * **Why the seam grew a second read of the same data.** A polling live engine issues one request per
   * target per cadence. That is invisible while a screen watches one stop, and it is a regression the
   * moment one watches six: Nearby fetched `/v1/nearby` once per window and would have fetched
   * `/v1/etas/:id` six times, which is why `applyLiveEtasToNearby` sat corpus-pinned with no consumer
   * for a whole wave. One request per round is what makes Nearby a live adopter at all.
   *
   * On the seam rather than private to `EdgeClient` for the reason `getEtas` is: **no screen calls
   * either.** Both exist for the poll emulator, and an iOS or Android port that reimplements that
   * emulator needs this call declared where it reads the rest of the seam (ADR-051). Its readers are
   * `EdgeClient` itself and `createPollTransport`.
   *
   * **No route narrowing, deliberately.** A per-id route list would need a nested delimiter and there
   * is no safe character for one (`,` is a legal `idchar`), so the batch answers every route at every
   * id and a caller that wants fewer applies `narrowEtasToRoutes` — the same kernel rule the edge
   * applies to `?routes=`. One declaration, two call sites, and the socket engine goes on narrowing
   * server-side without the two engines' output diverging.
   *
   * There is **one entry per distinct id**, in code-point order, and an entry whose `error` is set
   * carries an empty `etas` that means nothing. Branch on `error`, never on the empty list — that is
   * the same distinction ADR-073 exists to preserve, one level up.
   */
  getEtasBatch(ids: readonly string[]): Promise<EtaBatch>
  /** Subscribe to live updates for the given targets. */
  watch(targets: WatchTarget[], onUpdate: EtaListener, opts?: WatchOptions): Subscription
  /**
   * Subscribe to live updates for **every pole of one route** (ADR-116).
   *
   * Its own method rather than `watch(theRoutesPoles)`, because the property that makes it affordable is
   * not the target list: a route watch lands on one shared object per route, so the *n*th rider watching
   * Citybus 91 costs nothing upstream. A caller that named the poles instead would land on the hashed
   * shards and pay for its own fan-out.
   *
   * The listener receives exactly what `watch` delivers — the reduced session, canonically ordered, with
   * the kerbs that would not answer — so `applyLiveEtasToRouteDetail` is what turns it back into the
   * payload a screen derives from. What differs between the engines is only *how* a round is fetched (the
   * socket names the route and the server resolves its poles; the poll emulator resolves them itself),
   * which is the line ADR-074 draws and the reason this is one method rather than two.
   */
  watchRoute(routeId: string, onUpdate: EtaListener, opts?: WatchOptions): Subscription
  /**
   * The compact static route + stop index for on-device search and the smart keypad
   * (ADR-037). Large but cacheable; clients persist it and redownload only when its
   * `version` changes. v1 fetches it from the edge; v2 may bundle or push it.
   */
  getSearchIndex(): Promise<SearchIndex>
  /**
   * The tunable numbers the server owns — counts, cadences, honesty thresholds (ADR-053).
   *
   * Returns the document **as served**, with every field optional, because that is what it is: a
   * partial policy is legal and a failed fetch is ordinary. Pass it through `resolveClientPolicy`
   * before reading a field; no caller should be branching on whether a knob arrived.
   */
  getClientPolicy(): Promise<ClientPolicy>
}
