// Canonical data model. See docs/02-data-sources.md. Operators use incompatible
// IDs upstream; everything here is normalized so the apps see one shape.

/** Supported UI + data locales. Traditional Chinese is the primary HK form. */
export type Locale = 'en' | 'zh-Hant' | 'zh-Hans'

/** Localized text; every name from the operators carries these variants. */
export type I18nText = Record<Locale, string>

/** Operators in scope. v1 = KMB/LWB + Citybus; others tracked in the backlog. */
export type OperatorId = 'KMB' | 'LWB' | 'CTB'

/** Direction of travel. */
export type Bound = 'inbound' | 'outbound'

/** A geographic coordinate (WGS84). */
export interface LatLng {
  lat: number
  lng: number
}

export interface Operator {
  id: OperatorId
  name: I18nText
}

/** A canonical bus stop, with the per-operator source IDs it was merged from. */
export interface Stop {
  /** Canonical, app-stable stop id. */
  id: string
  name: I18nText
  location: LatLng
  /** The operator-native stop ids this canonical stop maps to. */
  sources: Array<{ operator: OperatorId; operatorStopId: string }>
}

/** A physical-location grouping of stops (e.g. KMB + CTB stops at the same kerb). */
export interface Place {
  id: string
  name: I18nText
  location: LatLng
  stopIds: string[]
}

export interface Route {
  /** Canonical route id, e.g. `KMB:6:outbound:1`. */
  id: string
  operator: OperatorId
  /** Public route number shown on the bus, e.g. "6", "720", "N691". */
  routeNo: string
  bound: Bound
  /** Operator service-type discriminator (KMB has variants per route). */
  serviceType: string
  origin: I18nText
  destination: I18nText
}

/** One stop in a route's ordered sequence. */
export interface RouteStop {
  routeId: string
  /** 1-based position along the route. */
  seq: number
  stopId: string
}

/** A normalized estimated-arrival reading. ETAs are approximations — see eta.ts. */
export interface Eta {
  routeId: string
  stopId: string
  operator: OperatorId
  /** Up to ~3 upcoming arrivals, ISO-8601, soonest first. */
  arrivals: string[]
  /** Free-text operator remark, if any (e.g. scheduled vs real-time). */
  remark?: I18nText
  /** When the upstream feed generated this reading (ISO-8601). */
  dataTimestamp: string
  /** When our layer fetched/observed it (ISO-8601). */
  observedAt: string
}

/** Route + its ordered stops (static) — returned by DataSource.getRoute. */
export interface RouteDetail {
  route: Route
  stops: Array<{ seq: number; stop: Stop }>
}

/** A stop + the routes that serve it, each with its current ETA. */
export interface StopDetail {
  stop: Stop
  routes: Array<{ route: Route; eta: Eta | null }>
}

/** A nearby stop with distance + its soonest arrivals. */
export interface NearbyStop {
  stop: Stop
  /** Straight-line distance from the query point, metres. */
  distanceM: number
  etas: Eta[]
}
