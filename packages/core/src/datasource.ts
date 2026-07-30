import type { SearchIndex } from './search'
import type {
  ClientPolicy,
  Eta,
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
  /** Live ETAs for a stop (optionally filtered to specific routes). */
  getEtas(stopId: string, routeIds?: string[]): Promise<Eta[]>
  /** Subscribe to live updates for the given targets. */
  watch(targets: WatchTarget[], onUpdate: EtaListener): Subscription
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
