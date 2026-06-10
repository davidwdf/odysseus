import type { Bound, I18nText, OperatorId, RouteServiceInfo } from '@nextbus/core'
import { haversineM } from './kmb-static'
import { canonicalRouteId, i18nText, toBound } from './normalize'

// Multi-operator static index built from the hkbus/hk-bus-crawling consolidated
// dataset (ADR-021). It folds KMB + CTB route/stop geometry into one canonical
// model in a SINGLE ~8 MB fetch — no per-operator crawl, no Worker subrequest-limit
// problem. Source data is data.gov.hk (official); we attribute both.
//
// Key facts established by investigation (see ADR-021):
//  - `routeList[*].stops[co]` holds the RAW, directly-ETA-callable operator stop ids
//    (verified: /eta/CTB/001027/1 returns route-1 ETAs). We use them as-is.
//  - `stopMap` is a BROAD spatial cluster for hkbus's own UX and is WRONG for ETA
//    resolution (the clustered id returns no ETAs), so we ignore it. Same-kerb merge
//    is a backlog item using our own coordinate clustering.
//  - Names carry only `en` + `zh` (Traditional). We map zh → both zh-Hant and zh-Hans
//    (Simplified falls back to Traditional for static names; live ETA text still has all
//    three from the operator APIs). True Simplified static names is a backlog item.
// Canonical host. The old `hkbus.github.io/hk-bus-crawling/…` path now 301-redirects here;
// we pin the redirect target directly so we don't depend on redirect-following.
const DATASET_URL = 'https://data.hkbus.app/routeFareList.min.json'

/** Operators we ingest from the dataset's `co` field. */
const CO_TO_OPERATOR: Record<string, OperatorId> = { kmb: 'KMB', ctb: 'CTB' }

interface RawRoute {
  co: string[]
  route: string
  serviceType: string
  bound: Record<string, string>
  orig: { en?: string; zh?: string }
  dest: { en?: string; zh?: string }
  stops: Record<string, string[]>
  // Fields we previously discarded (ADR-036). Sectional fares: index = stop seq-1, length
  // = stops-1 (the terminus has no boarding fare). `freq` = GTFS frequency bands keyed by
  // service id then "HHMM" start → [endHHMM, headwaySeconds]. `jt` = whole-route minutes.
  fares?: Array<string | null> | null
  faresHoliday?: Array<string | null> | null
  freq?: Record<string, Record<string, [string, string] | null>> | null
  jt?: string | null
}
interface RawStopEntry {
  location: { lat: number; lng: number }
  name: { en?: string; zh?: string }
}
interface RawDataset {
  routeList: Record<string, RawRoute>
  stopList: Record<string, RawStopEntry>
}

export interface IndexStop {
  /** Canonical, app-stable id, e.g. `CTB:001027` or `KMB:18492910339410B1`. */
  id: string
  operator: OperatorId
  /** Raw operator stop id — what the live ETA API takes. */
  stopId: string
  name: I18nText
  lat: number
  lng: number
}

export interface IndexRouteRef {
  operator: OperatorId
  route: string
  bound: Bound
  serviceType: string
}

export interface IndexRouteMeta extends IndexRouteRef {
  origin: I18nText
  destination: I18nText
  /** Sectional adult fares (HK$ strings), index = stop seq-1; the terminus has none. */
  fares?: Array<string | null>
  faresHoliday?: Array<string | null>
  /** Computed static service facts (fare/journey-time/frequency/hours) — ADR-036. */
  service?: RouteServiceInfo
}

export interface IndexRouteStop {
  seq: number
  /** Canonical stop id. */
  stopId: string
}

/**
 * A same-kerb grouping of co-located stops from *different* operators (e.g. a KMB
 * and a CTB stop on one pavement). Our own conservative clustering — the dataset's
 * `stopMap` over-clusters and breaks ETA resolution (ADR-021), so we don't use it.
 * Invariant: at most one member per operator (two same-operator stops that close
 * are opposite-direction kerbs and must stay distinct).
 */
export interface IndexPlace {
  /** `P:` + member canonical ids (sorted) joined by `+` — self-describing so the
   *  edge can resolve members from the id alone. */
  id: string
  name: I18nText
  lat: number
  lng: number
  members: IndexStop[]
}

export interface StaticIndex {
  stops: IndexStop[]
  /** canonical stop id → stop record. */
  stopById: Map<string, IndexStop>
  /** canonical stop id → the routes that serve it. */
  stopToRoutes: Map<string, IndexRouteRef[]>
  /** canonical route id → directional origin/destination. */
  routeMeta: Map<string, IndexRouteMeta>
  /** canonical route id → ordered canonical stop ids. */
  routeToStops: Map<string, IndexRouteStop[]>
  /** Same-kerb cross-operator groupings (KMB+CTB at one kerb). */
  places: IndexPlace[]
  /** canonical stop id → the place it belongs to (members only). */
  placeByStopId: Map<string, IndexPlace>
}

/** Map the dataset's `{en, zh}` to our three-locale text (zh-Hans falls back to zh-Hant). */
function datasetText(t: { en?: string; zh?: string }): I18nText {
  const zh = t.zh ?? ''
  return i18nText(t.en ?? '', zh, zh)
}

/** "HHMM" minutes-of-day number → "HH:mm", wrapping past-midnight bands (2535 → 01:35). */
function hhmm(n: number): string {
  const h = Math.floor(n / 100) % 24
  const m = n % 100
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Reduce the GTFS frequency table to a coarse, honest summary: the headway range (minutes)
 *  across all bands, and the daily span (earliest start → latest end). Either may be absent. */
function summarizeFreq(freq: RawRoute['freq']): Pick<RouteServiceInfo, 'headway' | 'hours'> {
  if (!freq) return {}
  let minH = Number.POSITIVE_INFINITY
  let maxH = 0
  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = Number.NEGATIVE_INFINITY
  for (const bands of Object.values(freq)) {
    if (!bands) continue
    for (const [start, val] of Object.entries(bands)) {
      const s = Number(start)
      if (Number.isFinite(s)) minStart = Math.min(minStart, s)
      if (!val) continue
      const end = Number(val[0])
      const head = Number(val[1])
      if (Number.isFinite(end)) maxEnd = Math.max(maxEnd, end)
      if (Number.isFinite(head) && head > 0) {
        minH = Math.min(minH, head)
        maxH = Math.max(maxH, head)
      }
    }
  }
  const out: Pick<RouteServiceInfo, 'headway' | 'hours'> = {}
  if (maxH > 0) out.headway = { min: Math.round(minH / 60), max: Math.round(maxH / 60) }
  if (minStart < Number.POSITIVE_INFINITY && maxEnd > Number.NEGATIVE_INFINITY) {
    out.hours = { start: hhmm(minStart), end: hhmm(maxEnd) }
  }
  return out
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Build the static service facts for a route entry, or undefined if the dataset has none. */
function buildService(entry: RawRoute): RouteServiceInfo | undefined {
  const { headway, hours } = summarizeFreq(entry.freq)
  const fareFull = asString(entry.fares?.[0])
  const holidayFull = asString(entry.faresHoliday?.[0])
  const journeyMin = entry.jt && Number.isFinite(Number(entry.jt)) ? Number(entry.jt) : undefined
  const info: RouteServiceInfo = {}
  if (fareFull) info.fareFull = fareFull
  if (holidayFull && holidayFull !== fareFull) info.fareFullHoliday = holidayFull
  if (journeyMin) info.journeyMin = journeyMin
  if (headway) info.headway = headway
  if (hours) info.hours = hours
  return Object.keys(info).length > 0 ? info : undefined
}

/** Adult boarding fare (HK$ string) at a 1-based stop `seq` on a route, or undefined. Fares
 *  are sectional (index = seq-1; the terminus has none); falls back to the weekday fare. */
export function routeFareAtSeq(
  meta: IndexRouteMeta,
  seq: number,
  holiday = false,
): string | undefined {
  const arr = holiday && meta.faresHoliday ? meta.faresHoliday : meta.fares
  return asString(arr?.[seq - 1])
}

// Same-kerb merge tuning. Conservative on purpose: we'd rather under-merge (show a
// genuine pair as two cards) than over-merge distinct stops into one. Both the radius
// and the name-match are required (see buildPlaces). ADR-022.
const MERGE_RADIUS_M = 30

/**
 * The landmark head of a stop name — everything before the first road/code separator,
 * normalized (punctuation/spacing stripped, lowercased; CJK kept). The two operators
 * name the same kerb differently — KMB as `LANDMARK (CW112)`, CTB as `Landmark, Road` —
 * but both *lead* with the shared landmark (e.g. `怡和大廈` / "Jardine House"), so the
 * landmark is the reliable match key, not the full string.
 */
function landmark(s: string): string {
  const head = s.split(/[,，(（]/)[0] ?? s
  return head.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()
}

/** Two stops name-match if their English OR Chinese landmark heads are equal. */
function namesMatch(a: I18nText, b: I18nText): boolean {
  const aEn = landmark(a.en)
  const bEn = landmark(b.en)
  if (aEn && bEn && aEn === bEn) return true
  const aZh = landmark(a['zh-Hant'])
  const bZh = landmark(b['zh-Hant'])
  return Boolean(aZh && bZh && aZh === bZh)
}

/**
 * Cluster co-located, same-named stops from *different* operators into places.
 * Greedy nearest-first pairing with a spatial grid for O(n·k) candidate lookup;
 * each stop joins at most one place, preserving the one-member-per-operator invariant.
 */
function buildPlaces(stops: IndexStop[]): {
  places: IndexPlace[]
  placeByStopId: Map<string, IndexPlace>
} {
  // ~30 m in degrees (lat: 1° ≈ 111 km). A square cell of the merge radius means any
  // pair within range shares a cell or a immediate neighbour, so a 3×3 sweep suffices.
  const cell = MERGE_RADIUS_M / 111_000
  const grid = new Map<string, number[]>()
  const key = (lat: number, lng: number) => `${Math.round(lat / cell)},${Math.round(lng / cell)}`
  stops.forEach((s, i) => {
    const k = key(s.lat, s.lng)
    const bucket = grid.get(k)
    if (bucket) bucket.push(i)
    else grid.set(k, [i])
  })

  // Collect cross-operator candidate pairs within range (each unordered pair once).
  const candidates: Array<{ i: number; j: number; d: number }> = []
  stops.forEach((s, i) => {
    const ci = Math.round(s.lat / cell)
    const cj = Math.round(s.lng / cell)
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const bucket = grid.get(`${ci + di},${cj + dj}`)
        if (!bucket) continue
        for (const j of bucket) {
          if (j <= i) continue // unordered: only j > i
          const o = stops[j]
          if (!o || o.operator === s.operator) continue // never merge same-operator kerbs
          const d = haversineM(s.lat, s.lng, o.lat, o.lng)
          if (d <= MERGE_RADIUS_M && namesMatch(s.name, o.name)) {
            candidates.push({ i, j, d })
          }
        }
      }
    }
  })

  candidates.sort((a, b) => a.d - b.d) // nearest pairs win contention
  const taken = new Set<number>()
  const places: IndexPlace[] = []
  const placeByStopId = new Map<string, IndexPlace>()
  for (const { i, j } of candidates) {
    if (taken.has(i) || taken.has(j)) continue
    const a = stops[i]
    const b = stops[j]
    if (!a || !b) continue
    taken.add(i)
    taken.add(j)
    const members = [a, b].sort((x, y) => x.id.localeCompare(y.id))
    const rep = members[0]
    if (!rep) continue
    const place: IndexPlace = {
      id: `P:${members.map((m) => m.id).join('+')}`,
      name: rep.name,
      lat: rep.lat,
      lng: rep.lng,
      members,
    }
    places.push(place)
    for (const m of members) placeByStopId.set(m.id, place)
  }
  return { places, placeByStopId }
}

export async function fetchConsolidatedIndex(
  fetchImpl: typeof fetch = fetch,
): Promise<StaticIndex> {
  const res = await fetchImpl(DATASET_URL)
  if (!res.ok) throw new Error(`consolidated dataset ${res.status}`)
  const data = (await res.json()) as RawDataset

  const stopById = new Map<string, IndexStop>()
  const stops: IndexStop[] = []
  const stopToRoutes = new Map<string, IndexRouteRef[]>()
  const routeMeta = new Map<string, IndexRouteMeta>()
  const routeToStops = new Map<string, IndexRouteStop[]>()

  const ensureStop = (operator: OperatorId, rawId: string): string | null => {
    const id = `${operator}:${rawId}`
    if (stopById.has(id)) return id
    const raw = data.stopList[rawId]
    if (!raw?.location) return null // referenced stop missing coords — skip it
    const stop: IndexStop = {
      id,
      operator,
      stopId: rawId,
      name: datasetText(raw.name ?? {}),
      lat: raw.location.lat,
      lng: raw.location.lng,
    }
    stopById.set(id, stop)
    stops.push(stop)
    return id
  }

  for (const entry of Object.values(data.routeList)) {
    for (const co of entry.co) {
      const operator = CO_TO_OPERATOR[co]
      if (!operator) continue // skip GMB/NLB/MTR/etc — out of v1 scope
      const dir = entry.bound[co]
      const seq = entry.stops?.[co]
      if (!dir || !seq?.length) continue
      const bound = toBound(dir)
      const serviceType = entry.serviceType
      const routeId = canonicalRouteId(operator, entry.route, bound, serviceType)

      routeMeta.set(routeId, {
        operator,
        route: entry.route,
        bound,
        serviceType,
        origin: datasetText(entry.orig ?? {}),
        destination: datasetText(entry.dest ?? {}),
        fares: entry.fares ?? undefined,
        faresHoliday: entry.faresHoliday ?? undefined,
        service: buildService(entry),
      })

      const ref: IndexRouteRef = { operator, route: entry.route, bound, serviceType }
      const ordered: IndexRouteStop[] = []
      seq.forEach((rawId, i) => {
        const stopId = ensureStop(operator, rawId)
        if (!stopId) return
        ordered.push({ seq: i + 1, stopId })
        const list = stopToRoutes.get(stopId)
        if (!list) stopToRoutes.set(stopId, [ref])
        else if (
          !list.some(
            (r) =>
              r.operator === operator &&
              r.route === ref.route &&
              r.bound === ref.bound &&
              r.serviceType === ref.serviceType,
          )
        ) {
          list.push(ref)
        }
      })
      routeToStops.set(routeId, ordered)
    }
  }

  const { places, placeByStopId } = buildPlaces(stops)
  return { stops, stopById, stopToRoutes, routeMeta, routeToStops, places, placeByStopId }
}

export interface NearbyHit {
  stop: IndexStop
  distanceM: number
  routes: IndexRouteRef[]
}

/** Nearest stops within `radiusM`, closest first, capped at `limit` (all operators). */
export function findNearby(
  index: StaticIndex,
  lat: number,
  lng: number,
  radiusM: number,
  limit: number,
): NearbyHit[] {
  const hits: NearbyHit[] = []
  for (const stop of index.stops) {
    const distanceM = haversineM(lat, lng, stop.lat, stop.lng)
    if (distanceM <= radiusM) {
      hits.push({
        stop,
        distanceM: Math.round(distanceM),
        routes: index.stopToRoutes.get(stop.id) ?? [],
      })
    }
  }
  hits.sort((a, b) => a.distanceM - b.distanceM)
  return hits.slice(0, limit)
}
