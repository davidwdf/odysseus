import type { SearchIndex } from './search'
import type {
  ClientPolicy,
  Eta,
  EtaReport,
  LatLng,
  NearbyStop,
  RouteDetail,
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

export type EtaListener = (etas: Eta[]) => void

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
  /** Subscribe to live updates for the given targets. */
  watch(targets: WatchTarget[], onUpdate: EtaListener, opts?: WatchOptions): Subscription
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
