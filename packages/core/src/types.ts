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
  /** Mean direction buses travel through this place (deg, 0–360), for a compass/direction
   *  cue that distinguishes two same-named places (e.g. the NE vs SW kerb). Only set for
   *  merged places; absent for a lone stop. ADR-042. */
  bearingDeg?: number
}

/** A physical-location grouping of stops (e.g. KMB + CTB stops at the same kerb). */
export interface Place {
  id: string
  name: I18nText
  location: LatLng
  stopIds: string[]
}

/**
 * Static service facts for a route direction, sourced from data we already fetch (the
 * consolidated route-fare dataset — see docs/02). All optional; this is the **Static**
 * honesty tier (never styled as live). Fares are HK$ kept as the upstream string to avoid
 * float drift. Fares are *sectional* — riders boarding later pay less — so `fareFull` is
 * the fare from the origin; the per-boarding-stop fare rides on the stop/ETA records.
 */
export interface RouteServiceInfo {
  /** Full adult fare from the route origin (HK$, e.g. "6.7"). */
  fareFull?: string
  /** Holiday full fare, only when it differs from `fareFull`. */
  fareFullHoliday?: string
  /** Whole-route journey time, minutes. */
  journeyMin?: number
  /** Typical headway from the GTFS frequency bands, minutes (coarse range — no fake precision). */
  headway?: { min: number; max: number }
  /** Rough daily service span, local 24h "HH:mm" (earliest first departure → latest end). */
  hours?: { start: string; end: string }
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
  /** Static service facts (fare/journey-time/frequency/hours), where the dataset supplies them. */
  service?: RouteServiceInfo
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
  /** Where this service is headed (the route's destination), for flat ETA lists that
   *  show "→ dest" without the full Route object (e.g. Nearby). Server-populated from
   *  the canonical route meta; optional because not every feed/path supplies it. */
  destination?: I18nText
  /** Adult fare (HK$) for boarding this route *at this stop*, server-stamped from the
   *  consolidated dataset like `destination`. Sectional — see RouteServiceInfo. */
  fare?: string
  /** Free-text operator remark, if any (e.g. scheduled vs real-time). */
  remark?: I18nText
  /** When the upstream feed generated this reading (ISO-8601). */
  dataTimestamp: string
  /** When our layer fetched/observed it (ISO-8601). */
  observedAt: string
}

/** Route + its ordered stops — returned by DataSource.getRoute. Each stop carries the
 *  route's own next arrival *there* (`eta`), so a route view can show per-stop times and
 *  infer bus positions (ADR-030). `eta` is null where no live reading is available. */
export interface RouteDetail {
  route: Route
  stops: Array<{ seq: number; stop: Stop; eta: Eta | null; fare?: string }>
}

/** A stop (or merged same-kerb place) + the routes that serve it, each with its current
 *  ETA. For a multi-pole place, `stopId` on each route is the canonical id of the *member
 *  pole* it departs from (so the UI can group routes under their pole — ADR-042), and
 *  `members` carries each pole's id/name/location for the multi-pin map + per-pole walk. */
export interface StopDetail {
  stop: Stop
  routes: Array<{ route: Route; eta: Eta | null; fare?: string; stopId: string }>
  /** The place's member poles (one entry for a single stop; several for a merged place). */
  members: Array<{ id: string; name: I18nText; location: LatLng }>
}

/** A nearby stop (or merged place) with distance + its soonest arrivals. */
export interface NearbyStop {
  stop: Stop
  /** Straight-line distance from the query point, metres. */
  distanceM: number
  /** Soonest arrivals (deduped to one per route+direction). May be fewer than `routeCount`
   *  — routes without a live reading right now aren't listed here. */
  etas: Eta[]
  /** True number of distinct routes serving the place, from the static index (no live call).
   *  Lets a compact card show "soonest few of N · +N more" honestly, never a silent filter. */
  routeCount: number
}
