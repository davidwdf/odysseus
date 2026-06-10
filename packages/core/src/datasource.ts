import type { SearchIndex } from './search'
import type { Eta, LatLng, NearbyStop, RouteDetail, StopDetail } from './types'

/** A live subscription to ETA updates. Call `unsubscribe` to release it. */
export interface Subscription {
  unsubscribe(): void
}

export interface WatchTarget {
  stopId: string
  /** Optional: only these routes at the stop. */
  routeIds?: string[]
}

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
}
