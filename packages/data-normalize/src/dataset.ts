import type {
  Bound,
  FreqPattern,
  I18nText,
  OperatorId,
  RouteServiceInfo,
  ServiceDayType,
} from '@nextbus/core'
import { haversineM } from './kmb-static'
import { canonicalRouteId, i18nText, toBound } from './normalize'

// Multi-operator static index built from the hkbus/hk-bus-crawling consolidated
// dataset (ADR-021). It folds KMB + CTB + GMB (ADR-047) route/stop geometry into one
// canonical model in a SINGLE ~8 MB fetch — no per-operator crawl, no Worker
// subrequest-limit problem. Source data is data.gov.hk (official); we attribute both.
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
const CO_TO_OPERATOR: Record<string, OperatorId> = { kmb: 'KMB', ctb: 'CTB', gmb: 'GMB' }

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
  // GMB only: the globally-unique numeric GMB route_id (as a string). GMB public numbers
  // repeat across regions, so this — not the number — is what makes a GMB route unique and
  // is the id its live ETA API takes. We fold it into the canonical route id's service-type
  // slot (ADR-047).
  gtfsId?: string | null
}
interface RawStopEntry {
  location: { lat: number; lng: number }
  name: { en?: string; zh?: string }
}
interface RawDataset {
  routeList: Record<string, RawRoute>
  stopList: Record<string, RawStopEntry>
  /** GTFS service-id → 7-day run mask `[Sun,Mon,Tue,Wed,Thu,Fri,Sat]` ("1" = runs). Resolves
   *  the `freq` service ids to day-types for the per-day-type patterns (ADR-044). */
  serviceDayMap?: Record<string, string[]>
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
 * A same-kerb grouping of co-located stops travelling the same direction — possibly
 * several poles, possibly multiple operators (ADR-042; the bearing gate, not the
 * operator, separates kerbs). Our own conservative clustering — the dataset's
 * `stopMap` over-clusters and breaks ETA resolution (ADR-021), so we don't use it.
 */
export interface IndexPlace {
  /** `P:` + member canonical ids (sorted) joined by `+` — self-describing so the
   *  edge can resolve members from the id alone. */
  id: string
  name: I18nText
  lat: number
  lng: number
  members: IndexStop[]
  /** Mean travel bearing of the place (deg, 0–360) — the direction buses move through
   *  it. Undefined only if no member has bearing data (e.g. a place of pure termini). */
  meanBearingDeg?: number
  /** Max pairwise bearing spread among members (deg, 0–180). Higher = looser grouping. */
  bearingSpreadDeg: number
  /** Heuristic 0–100 confidence that this is ONE real boarding location, for prioritising
   *  manual review (low = review first). Internal — never shown to riders. ADR-042. */
  confidence: number
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
  /** GMB live-ETA resolution (ADR-047): `${gtfsId}:${bound}` → canonical route id. The GMB
   *  stop-board feed identifies routes by numeric route_id (= `gtfsId`) + `route_seq`; this
   *  maps that back to our canonical id (public numbers repeat across regions, so we can't). */
  gmbCanonicalByLive: Map<string, string>
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

type DayMap = RawDataset['serviceDayMap']

/** Classify a service-day run mask `[Sun,Mon,Tue,Wed,Thu,Fri,Sat]` into a friendly day-type.
 *  Clean weekday/Sat/Sun splits are the common case (ADR-044); anything else is `other` and the
 *  UI renders the exact days from the mask. */
function classifyDays(mask: string[]): ServiceDayType {
  const [sun, mon, tue, wed, thu, fri, sat] = mask.map((d) => d === '1')
  const weekdays = mon && tue && wed && thu && fri
  if (sun && weekdays && sat) return 'daily'
  if (weekdays && !sat && !sun) return 'weekday'
  if (sat && !sun && !mon && !tue && !wed && !thu && !fri) return 'saturday'
  if (sun && !sat && !mon && !tue && !wed && !thu && !fri) return 'sunday'
  return 'other'
}

const DAY_TYPE_ORDER: ServiceDayType[] = ['weekday', 'saturday', 'sunday', 'daily', 'other']

/**
 * Turn the GTFS frequency table into per-day-type profiles by joining each `freq` service id to
 * `serviceDayMap` (ADR-044). One profile per day-type; when several service ids share a day-type
 * (seasonal variants) we keep the richest (most bands) as the representative — the Static tier is
 * a coarse summary, not a promise of every variant. Bands are sorted by clock start; first/last
 * are the earliest start → latest end (mirrors `summarizeFreq`, so the badge and sheet agree).
 */
function buildPatterns(freq: RawRoute['freq'], dayMap: DayMap): FreqPattern[] | undefined {
  if (!freq || !dayMap) return undefined
  const byType = new Map<ServiceDayType, { mask: string[]; bands: [string, string, string][] }>()
  for (const [serviceId, bands] of Object.entries(freq)) {
    const mask = dayMap[serviceId]
    if (!bands || !mask) continue
    const rows = Object.entries(bands)
      .filter((e): e is [string, [string, string]] => e[1] != null)
      .map(([start, v]) => [start, v[0], v[1]] as [string, string, string])
    if (rows.length === 0) continue
    const dayType = classifyDays(mask)
    const prev = byType.get(dayType)
    if (!prev || rows.length > prev.bands.length) byType.set(dayType, { mask, bands: rows })
  }
  const patterns: FreqPattern[] = []
  for (const [dayType, { mask, bands }] of byType) {
    const parsed = bands
      .map(([start, end, head]) => ({
        startN: Number(start),
        endN: Number(end),
        start: hhmm(Number(start)),
        end: hhmm(Number(end)),
        headwayMin: Math.round(Number(head) / 60),
      }))
      .filter((b) => Number.isFinite(b.startN) && Number.isFinite(b.endN) && b.headwayMin > 0)
      .sort((a, b) => a.startN - b.startN)
    if (parsed.length === 0) continue
    patterns.push({
      dayType,
      days: mask.map((d) => d === '1'),
      bands: parsed.map(({ start, end, headwayMin }) => ({ start, end, headwayMin })),
      first: hhmm(Math.min(...parsed.map((b) => b.startN))),
      last: hhmm(Math.max(...parsed.map((b) => b.endN))),
    })
  }
  patterns.sort((a, b) => DAY_TYPE_ORDER.indexOf(a.dayType) - DAY_TYPE_ORDER.indexOf(b.dayType))
  return patterns.length > 0 ? patterns : undefined
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Build the static service facts for a route entry, or undefined if the dataset has none. */
function buildService(entry: RawRoute, dayMap: DayMap): RouteServiceInfo | undefined {
  const { headway, hours } = summarizeFreq(entry.freq)
  const patterns = buildPatterns(entry.freq, dayMap)
  const fareFull = asString(entry.fares?.[0])
  const holidayFull = asString(entry.faresHoliday?.[0])
  const journeyMin = entry.jt && Number.isFinite(Number(entry.jt)) ? Number(entry.jt) : undefined
  const info: RouteServiceInfo = {}
  if (fareFull) info.fareFull = fareFull
  if (holidayFull && holidayFull !== fareFull) info.fareFullHoliday = holidayFull
  if (journeyMin) info.journeyMin = journeyMin
  if (headway) info.headway = headway
  if (hours) info.hours = hours
  if (patterns) info.patterns = patterns
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

// Direction gate (ADR-042 quick win). Two co-located, same-named cross-operator stops can
// still be OPPOSITE kerbs that merely share a landmark name; merging them fuses opposite-
// direction ETAs onto one card (the live ADR-022 false merges the bearing audit found —
// Causeway Centre, Ko Po Tsuen, HK Heritage Museum, Yuk Ming Court). We reject a candidate
// pair whose MEAN TRAVEL BEARINGS (the direction buses move through each stop) disagree by
// more than this tolerance — UNLESS a jointly-run KMB+CTB route lists both ids at the same
// sequence position (the decisive "same physical pole" signal, which overrides a bearing
// made noisy by a terminus loop or an immediate turn).
const BEARING_TOL_DEG = 45

// Cluster-level guard (ADR-042). Single-linkage can chain A–B–C where the A–C edge would
// itself have been rejected; the verification's one bad cluster (East Point City) came from
// exactly this. So a whole cluster's travel bearings must stay within this spread, and the
// two vetoes are enforced for EVERY pair in a cluster, not just each linking edge.
const BEARING_SPREAD_CAP_DEG = 60

const toRad = (deg: number): number => (deg * Math.PI) / 180

/** Initial great-circle bearing from (lat1,lng1) to (lat2,lng2), degrees 0..360. */
function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const lat1r = toRad(lat1)
  const lat2r = toRad(lat2)
  const dLng = toRad(lng2 - lng1)
  const y = Math.sin(dLng) * Math.cos(lat2r)
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Smallest absolute angle between two bearings (degrees, 0..180). */
function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** A sorted, order-independent key for a stop pair (for the joint-route same-pole set). */
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * Whether a candidate same-kerb pair agrees on direction of travel (ADR-042). The
 * joint-route signal is decisive (same physical pole); otherwise the mean bearings must
 * agree within tolerance. A missing bearing on either side does NOT reject — we keep the
 * conservative ADR-022 behaviour rather than drop a merge on absent geometry.
 */
function directionAgrees(
  a: IndexStop,
  b: IndexStop,
  meanBearing: Map<string, number>,
  jointPairs: Set<string>,
): boolean {
  if (jointPairs.has(pairKey(a.id, b.id))) return true
  const ba = meanBearing.get(a.id)
  const bb = meanBearing.get(b.id)
  if (ba === undefined || bb === undefined) return true
  return angularDiffDeg(ba, bb) <= BEARING_TOL_DEG
}

/** The richest member name — most complete (en + zh) and longest — so a place reads well
 *  regardless of which member you came from (ADR-042 "name once"). Deterministic on ties
 *  (lowest id wins). Called only with a non-empty member list. */
function pickName(members: IndexStop[]): I18nText {
  const score = (n: I18nText) => n.en.length + n['zh-Hant'].length
  return members.reduce((acc, m) => {
    const sa = score(acc.name)
    const sm = score(m.name)
    if (sa !== sm) return sa > sm ? acc : m
    return acc.id <= m.id ? acc : m
  }).name
}

/** Circular mean of a set of stops' known travel bearings (deg, 0..360), or undefined. */
function meanBearingOf(ids: string[], meanBearing: Map<string, number>): number | undefined {
  let x = 0
  let y = 0
  let n = 0
  for (const id of ids) {
    const b = meanBearing.get(id)
    if (b === undefined) continue
    x += Math.cos(toRad(b))
    y += Math.sin(toRad(b))
    n++
  }
  return n === 0 ? undefined : ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// Confidence tuning (ADR-042). A heuristic 0–100 score of how sure we are a cluster is one
// real boarding location, used ONLY to prioritise manual review (low = review first) — never
// shown to riders. Termini/BBIs score low because their loop geometry makes the bearing
// signal unreliable, so they can't be vouched for automatically (not because they're wrong).
const CONF_SPREAD_FREE_DEG = 15 // spread up to here is unpenalised (gentle road curve)
const CONF_SPREAD_PENALTY = 1.1 // points lost per degree of spread beyond the free band
const CONF_DIAM_FREE_M = 25 // diameter up to here is unpenalised
const CONF_DIAM_PENALTY = 0.8 // points lost per metre of diameter beyond the free band
const CONF_SIZE_FREE = 3 // member count up to here is unpenalised
const CONF_SIZE_PENALTY = 2 // points lost per member beyond the free count
const CONF_JOINT_BONUS = 12 // a joint-route same-pole proof raises confidence
const CONF_TERMINUS_PENALTY = 10 // termini/BBIs have unreliable bearings → flag for review

const TERMINUS_NAME = /TERMINUS|\bBBI\b|INTERCHANGE/i

/** Heuristic 0–100 review-priority confidence for a built place (see CONF_* above). */
function placeConfidence(
  members: IndexStop[],
  spreadDeg: number,
  diameterM: number,
  hasJointProof: boolean,
): number {
  let c = 100
  c -= Math.max(0, spreadDeg - CONF_SPREAD_FREE_DEG) * CONF_SPREAD_PENALTY
  c -= Math.max(0, diameterM - CONF_DIAM_FREE_M) * CONF_DIAM_PENALTY
  c -= Math.max(0, members.length - CONF_SIZE_FREE) * CONF_SIZE_PENALTY
  if (hasJointProof) c += CONF_JOINT_BONUS
  if (members.some((m) => TERMINUS_NAME.test(m.name.en))) c -= CONF_TERMINUS_PENALTY
  return Math.max(0, Math.min(100, Math.round(c)))
}

/** Max pairwise great-circle distance (m) among a set of stops; 0 if <2. */
function clusterDiameterM(members: IndexStop[]): number {
  let max = 0
  for (let a = 0; a < members.length; a++) {
    for (let b = a + 1; b < members.length; b++) {
      // biome-ignore lint/style/noNonNullAssertion: a,b index within members.length
      const x = members[a]!
      // biome-ignore lint/style/noNonNullAssertion: a,b index within members.length
      const y = members[b]!
      max = Math.max(max, haversineM(x.lat, x.lng, y.lat, y.lng))
    }
  }
  return max
}

/** Max pairwise angular spread (deg) among the known bearings of a set of stops; 0 if <2. */
function bearingSpread(ids: string[], meanBearing: Map<string, number>): number {
  const bs = ids.map((id) => meanBearing.get(id)).filter((b): b is number => b !== undefined)
  let max = 0
  for (let a = 0; a < bs.length; a++) {
    for (let b = a + 1; b < bs.length; b++) {
      // biome-ignore lint/style/noNonNullAssertion: a,b index within bs.length
      max = Math.max(max, angularDiffDeg(bs[a]!, bs[b]!))
    }
  }
  return max
}

/**
 * Cluster co-located stops into N-member places (ADR-042). Single-linkage over a spatial
 * grid: a pair is a candidate edge when within range, name-matching, and direction-agreeing
 * (`directionAgrees`). Edges merge nearest-first, but two CLUSTERS only join when, across
 * every cross pair, neither veto fires — (1) the stops are consecutive on some route,
 * (2) one route+bound serves both — and the merged cluster's bearing spread stays within
 * `BEARING_SPREAD_CAP_DEG`. Members may now share an operator (e.g. three adjacent KMB poles
 * on one kerb); the bearing gate, not the operator, separates kerbs — superseding ADR-022's
 * one-member-per-operator invariant.
 */
function buildPlaces(
  stops: IndexStop[],
  meanBearing: Map<string, number>,
  jointPairs: Set<string>,
  consecutivePairs: Set<string>,
  linesByStop: Map<string, Set<string>>,
): {
  places: IndexPlace[]
  placeByStopId: Map<string, IndexPlace>
} {
  // ~30 m in degrees (lat: 1° ≈ 111 km). A square cell of the merge radius means any
  // pair within range shares a cell or an immediate neighbour, so a 3×3 sweep suffices.
  const cell = MERGE_RADIUS_M / 111_000
  const grid = new Map<string, number[]>()
  const key = (lat: number, lng: number) => `${Math.round(lat / cell)},${Math.round(lng / cell)}`
  stops.forEach((s, i) => {
    const k = key(s.lat, s.lng)
    const bucket = grid.get(k)
    if (bucket) bucket.push(i)
    else grid.set(k, [i])
  })

  // Candidate edges within range (each unordered pair once); same-operator pairs are now
  // allowed — the direction gate, not the operator, separates kerbs.
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
          if (!o) continue
          const d = haversineM(s.lat, s.lng, o.lat, o.lng)
          if (
            d <= MERGE_RADIUS_M &&
            namesMatch(s.name, o.name) &&
            directionAgrees(s, o, meanBearing, jointPairs)
          ) {
            candidates.push({ i, j, d })
          }
        }
      }
    }
  })
  candidates.sort((a, b) => a.d - b.d) // nearest edges win contention

  // Agglomerative single-linkage with cluster-level guards. Stops enter a cluster only via a
  // candidate edge, so singletons never become places.
  const clusterOf = new Map<number, number>() // stop index → cluster id
  const clusters = new Map<number, number[]>() // cluster id → member stop indices
  let nextCluster = 0
  const ensure = (i: number): number => {
    const existing = clusterOf.get(i)
    if (existing !== undefined) return existing
    const id = nextCluster++
    clusterOf.set(i, id)
    clusters.set(id, [i])
    return id
  }
  const linesShared = (a: string, b: string): boolean => {
    const la = linesByStop.get(a)
    const lb = linesByStop.get(b)
    if (!la || !lb) return false
    const [small, big] = la.size <= lb.size ? [la, lb] : [lb, la]
    for (const l of small) if (big.has(l)) return true
    return false
  }
  const canMerge = (a: number[], b: number[]): boolean => {
    for (const ia of a) {
      for (const ib of b) {
        const ida = stops[ia]?.id
        const idb = stops[ib]?.id
        if (!ida || !idb) continue
        if (consecutivePairs.has(pairKey(ida, idb))) return false
        if (linesShared(ida, idb)) return false
      }
    }
    const ids = [...a, ...b].map((i) => stops[i]?.id).filter((id): id is string => Boolean(id))
    return bearingSpread(ids, meanBearing) <= BEARING_SPREAD_CAP_DEG
  }
  for (const { i, j } of candidates) {
    const ci = ensure(i)
    const cj = ensure(j)
    if (ci === cj) continue
    const a = clusters.get(ci)
    const b = clusters.get(cj)
    if (!a || !b || !canMerge(a, b)) continue
    for (const ib of b) {
      clusterOf.set(ib, ci)
      a.push(ib)
    }
    clusters.delete(cj)
  }

  const places: IndexPlace[] = []
  const placeByStopId = new Map<string, IndexPlace>()
  for (const indices of clusters.values()) {
    if (indices.length < 2) continue
    const members = indices
      .map((i) => stops[i])
      .filter((s): s is IndexStop => Boolean(s))
      .sort((x, y) => x.id.localeCompare(y.id))
    if (members.length < 2) continue
    const ids = members.map((m) => m.id)
    const spreadDeg = Math.round(bearingSpread(ids, meanBearing))
    const meanBearingDeg = meanBearingOf(ids, meanBearing)
    // Any joint-route same-pole proof among the members raises confidence.
    let hasJointProof = false
    for (let a = 0; a < ids.length && !hasJointProof; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        // biome-ignore lint/style/noNonNullAssertion: a,b index within ids.length
        if (jointPairs.has(pairKey(ids[a]!, ids[b]!))) {
          hasJointProof = true
          break
        }
      }
    }
    const place: IndexPlace = {
      id: `P:${members.map((m) => m.id).join('+')}`,
      name: pickName(members),
      // Centroid — the most representative single anchor for a multi-pole place.
      lat: members.reduce((sum, m) => sum + m.lat, 0) / members.length,
      lng: members.reduce((sum, m) => sum + m.lng, 0) / members.length,
      members,
      meanBearingDeg: meanBearingDeg === undefined ? undefined : Math.round(meanBearingDeg),
      bearingSpreadDeg: spreadDeg,
      confidence: placeConfidence(members, spreadDeg, clusterDiameterM(members), hasJointProof),
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
  // Per-stop mean travel bearing, accumulated as circular-mean components (ADR-042).
  const bearingAcc = new Map<string, { x: number; y: number }>()
  // Stop pairs proven to be the same physical pole by a co-run KMB+CTB route.
  const jointPairs = new Set<string>()
  // Cluster-level veto inputs (ADR-042): pairs consecutive on some route, and the set of
  // route lines (canonical route id) serving each stop.
  const consecutivePairs = new Set<string>()
  const linesByStop = new Map<string, Set<string>>()
  // GMB live-ETA resolution (ADR-047): `${gtfsId}:${bound}` → canonical route id.
  const gmbCanonicalByLive = new Map<string, string>()

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
      if (!operator) continue // skip NLB/MTR-Bus/rail/etc — out of v1 scope
      const dir = entry.bound[co]
      const seq = entry.stops?.[co]
      if (!dir || !seq?.length) continue
      const bound = toBound(dir)
      // GMB public numbers repeat across regions, so the number+bound isn't unique; fold the
      // globally-unique route_id (`gtfsId`) into the service-type slot to disambiguate, and it
      // doubles as the live ETA route_id (ADR-047). KMB/CTB keep their real service type.
      const gmbId = operator === 'GMB' ? (entry.gtfsId ?? undefined) : undefined
      const serviceType = gmbId ?? entry.serviceType
      const routeId = canonicalRouteId(operator, entry.route, bound, serviceType)
      if (gmbId) gmbCanonicalByLive.set(`${gmbId}:${bound}`, routeId)

      routeMeta.set(routeId, {
        operator,
        route: entry.route,
        bound,
        serviceType,
        origin: datasetText(entry.orig ?? {}),
        destination: datasetText(entry.dest ?? {}),
        // GMB fares are flat/non-sectional in EVERY open-data feed (the consolidated dataset,
        // the TD Routes-and-Fares dataset, and the GMB API — verified all 1,149 route-dirs are a
        // single fare repeated; ADR-047). Any real fare change en route is only on the physical
        // fare board, not in open data. So we drop the misleading per-stop array for GMB and
        // expose only the route-level full fare via `service.fareFull` (computed below).
        fares: operator === 'GMB' ? undefined : (entry.fares ?? undefined),
        faresHoliday: operator === 'GMB' ? undefined : (entry.faresHoliday ?? undefined),
        service: buildService(entry, data.serviceDayMap),
      })

      const ref: IndexRouteRef = { operator, route: entry.route, bound, serviceType }
      const ordered: IndexRouteStop[] = []
      seq.forEach((rawId, i) => {
        const stopId = ensureStop(operator, rawId)
        if (!stopId) return
        ordered.push({ seq: i + 1, stopId })
        // Travel bearing through this stop = chord from the previous to the next stop
        // (skipping the stop itself). Termini, where prev === next, contribute nothing.
        const prevRaw = seq[i - 1] ?? rawId
        const nextRaw = seq[i + 1] ?? rawId
        const p = data.stopList[prevRaw]?.location
        const n = data.stopList[nextRaw]?.location
        if (p && n && prevRaw !== nextRaw) {
          const b = toRad(bearingDeg(p.lat, p.lng, n.lat, n.lng))
          const acc = bearingAcc.get(stopId)
          if (acc) {
            acc.x += Math.cos(b)
            acc.y += Math.sin(b)
          } else {
            bearingAcc.set(stopId, { x: Math.cos(b), y: Math.sin(b) })
          }
        }
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

      // Veto inputs: stops consecutive on this route, and this route line per member stop.
      for (let k = 0; k + 1 < ordered.length; k++) {
        const a = ordered[k]?.stopId
        const b = ordered[k + 1]?.stopId
        if (a && b && a !== b) consecutivePairs.add(pairKey(a, b))
      }
      for (const o of ordered) {
        const set = linesByStop.get(o.stopId)
        if (set) set.add(routeId)
        else linesByStop.set(o.stopId, new Set([routeId]))
      }
    }

    // Joint-route same-pole signal (ADR-042): a co-run KMB+CTB route lists parallel,
    // index-aligned stop sequences — the same physical pole under each operator's id. Used
    // only to rescue an already-close, already-same-named candidate pair from the direction
    // gate, so it cannot introduce a merge on its own.
    const kmbSeq = entry.stops?.kmb
    const ctbSeq = entry.stops?.ctb
    if (entry.co.includes('kmb') && entry.co.includes('ctb') && kmbSeq && ctbSeq) {
      const n = Math.min(kmbSeq.length, ctbSeq.length)
      for (let i = 0; i < n; i++) {
        const k = kmbSeq[i]
        const c = ctbSeq[i]
        if (k && c && data.stopList[k]?.location && data.stopList[c]?.location) {
          jointPairs.add(pairKey(`KMB:${k}`, `CTB:${c}`))
        }
      }
    }
  }

  // Reduce the accumulated circular-mean components to one bearing per stop.
  const meanBearing = new Map<string, number>()
  for (const [id, { x, y }] of bearingAcc) {
    meanBearing.set(id, ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360)
  }

  const { places, placeByStopId } = buildPlaces(
    stops,
    meanBearing,
    jointPairs,
    consecutivePairs,
    linesByStop,
  )
  return {
    stops,
    stopById,
    stopToRoutes,
    routeMeta,
    routeToStops,
    places,
    placeByStopId,
    gmbCanonicalByLive,
  }
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
