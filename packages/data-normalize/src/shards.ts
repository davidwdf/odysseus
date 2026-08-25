import {
  type I18nText,
  memberStopIds,
  type OperatorId,
  type Route,
  type RouteSummary,
} from '@nextbus/core'
import type { IndexPlace, IndexStop, StaticIndex } from './dataset'
import { routeFareAtSeq } from './dataset'
import { haversineM } from './kmb-static'
import { canonicalRouteId } from './normalize'

/**
 * Precomputed dataset shards (WP0-1 / ADR-055).
 *
 * The Worker used to build the whole `StaticIndex` in-request: an 8.3 MB fetch, ~67 ms of
 * `JSON.parse` and ~20 MB of heap on every cold isolate, plus a hard runtime dependency on
 * `data.hkbus.app` being up. This module is the shape that replaces it — the same derivations,
 * done once by an external build, sliced so the Worker reads **only the few documents a request
 * actually needs**.
 *
 * Everything here is a pure function of a `StaticIndex`. That's what makes the two consumers
 * agree by construction rather than by discipline:
 *  - `scripts/publish-dataset.ts` calls the `all*` functions to write every shard to KV/R2;
 *  - the Worker's dev fallback (`apps/edge/src/dataset.ts`) calls the same per-id functions
 *    against an in-memory index, so `pnpm dev:edge` needs no remote state and still exercises
 *    exactly the document shapes production serves.
 *
 * Shards are **content-addressed**: every key carries the build hash, and one mutable pointer
 * (`build:current`) is flipped only after every key has landed. A half-written crawl is
 * therefore unreachable rather than partially served, and a rollback is a single key write.
 */

// ── Documents ────────────────────────────────────────────────────────────────────────────

/** One member pole of a place: everything needed to call its live ETA board and pin it. */
export interface MemberDoc {
  /** Canonical id, e.g. `KMB:18492910339410B1`. */
  id: string
  operator: OperatorId
  /** Raw operator stop id — what the live ETA API takes. */
  stopId: string
  name: I18nText
  lat: number
  lng: number
  /**
   * Other canonical pole ids that name **this same physical pole**, because upstream published it
   * more than once (WP5-11, `foldDuplicatePoles`). Absent for all but ~80 poles in the build.
   *
   * They are not decoration. Three things read them:
   *   · the ETA fan-out, which must call *each* alias's own upstream board — the routes upstream
   *     lists at an alias are **never** listed at the member (in `1ccad7436a8df480`, **0 of 324**
   *     route rows on a folded pole also appear on its member), so skipping them would silently
   *     strip those rows of their arrivals;
   *   · the Place screen, which groups a route row under the boarding point it belongs to and
   *     collapses two ids of one pole to one row (`boardingPoleId`, `dedupeRoutes` in
   *     `@nextbus/core`) — **without rewriting the row's id**, which stays what the wire said;
   *   · nothing else — and in particular *not* the favourite key, which stays the pole id the rider
   *     actually starred. Both ids remain valid keys forever, which is the point.
   *
   * So this field says which ids *display* as one pole, and it changes nothing about which ids are
   * addressable: an alias still resolves through the alias table, still carries its own route rows,
   * and still stamps its own id onto every reading taken off its board. Anything that treated an
   * alias as an id to be *replaced* would break the promise the field exists to keep.
   *
   * Same operator as this member by construction: `sameLabelEverywhere` requires it.
   */
  aliasIds?: string[]
}

/**
 * A route serving one member pole, with the fare for boarding *there*.
 *
 * `route` is a `RouteSummary`, not a `Route`: the summary service tier — `fareFull`, `journeyMin`,
 * `headway`, `hours` — with `patterns`, the per-day-type frequency profiles, dropped. Reason:
 * `patterns` is read on exactly one screen (the Route fact sheets), and duplicating it into
 * every place a route touches accounted for **54 MB of an 82 MB build** — a big interchange's
 * document went from 188 kB to a fraction of that. `/v1/route/:id` still carries the full
 * profile, which is where the UI reads it from (ADR-065 names the tier so a decoder can see it).
 */
export interface PlaceRouteDoc {
  /**
   * Canonical id of the pole this route departs from (ADR-042 grouping).
   *
   * Almost always a member id. Where upstream published one pole twice it is the **id the route's
   * own stop list names** — which may be one of that member's `aliasIds` rather than the member
   * itself (WP5-11). Kept raw on purpose: this is the id a rider's favourite is keyed on and the id
   * the route schematic offers, so re-basing it here would invalidate saved keys. The display
   * collapse is `boardingPoleId`'s, at render time.
   */
  stopId: string
  route: RouteSummary
  fare?: string
}

/**
 * Everything `/v1/stop/:id` and `/v1/etas/:id` need, in **one** read.
 *
 * A standalone stop is a place of one, so there is a single document shape and a single code
 * path — the caller never has to know whether an id is a `P:` place or a bare pole.
 */
export interface PlaceDoc {
  id: string
  name: I18nText
  lat: number
  lng: number
  bearingDeg?: number
  members: MemberDoc[]
  routes: PlaceRouteDoc[]
  /** Distinct rider lines (operator + number + direction) — the honest "N routes" count. */
  routeCount: number
  /**
   * GMB live-ETA resolution for this place only (ADR-047): `${gtfsId}:${bound}` → canonical
   * route id. Scoped to the place rather than shipped as one global map, because that map is
   * ~1,100 entries and only a handful are ever relevant to a given board.
   */
  gmbLive?: Record<string, string>
}

/** Everything `/v1/route/:id` needs, in one read. */
export interface RouteDocStop {
  seq: number
  /** Canonical stop id. */
  id: string
  operator: OperatorId
  /** Raw operator stop id — stamped onto readings from the route-eta feed, which carries none. */
  stopId: string
  name: I18nText
  lat: number
  lng: number
  fare?: string
}

export interface RouteDoc {
  route: Route
  stops: RouteDocStop[]
  /** The same number in the opposite bound, when the dataset has a loadable one (ADR-046). */
  reverse?: { id: string; origin: I18nText; destination: I18nText }
  /**
   * The Transport Department's numeric route id — CSDI's `ROUTE_ID`, the join key for route
   * geometry (ADR-152). Deliberately on the **shard** and not on the wire `Route`: only the edge
   * needs it, to look a line up on the rider's behalf, so putting it on the contract would be a
   * breaking wire change that bought a client nothing. Absent for ~7% of route-directions.
   */
  gtfsId?: string
}

/**
 * A place in a geo cell — deliberately just enough to **rank** it, nothing more.
 *
 * The temptation is to inline the whole place here so `/v1/nearby` costs one read. Don't: a
 * dense urban cell holds a couple of hundred places, and carrying their route lists would make
 * a single cell megabytes, so every nearby query would pull a slab of the territory to show six
 * cards. Instead the reader ranks from these stubs and then fetches the ≤6 winning `PlaceDoc`s —
 * a handful of point reads, and no route data duplicated between two key spaces.
 */
export interface GeoEntry {
  /** Place id, or a lone stop's canonical id. Resolve with `DatasetSource.place(id)`. */
  id: string
  /** Anchor (a place's centroid, or the stop itself). */
  lat: number
  lng: number
  /** Member pole coordinates, so distance is to the nearest pole. Absent for a lone stop. */
  poles?: Array<[number, number]>
}

/** The one mutable key. Written last, so it always points at a complete build. */
export interface BuildManifest {
  /** Content hash of the shard set — the value embedded in every other key. */
  hash: string
  /** Hash of the upstream dataset, so an unchanged crawl can skip republishing. */
  sourceHash: string
  builtAt: string
  counts: { places: number; aliases: number; routes: number; cells: number; stops: number }
}

// ── Key grammar ──────────────────────────────────────────────────────────────────────────

export const datasetKeys = {
  /** The pointer readers follow. The only key that affects what is served. */
  current: 'build:current',
  /**
   * Build hashes still present in the namespace, newest first — written by `publish` *after* the
   * flip and never read by the Worker.
   *
   * It exists because pruning must not depend on `kv key list`: that pages at 1,000 keys, and a
   * build is ~20k, so a listing-driven prune would silently leak most of every superseded build
   * forever. With the history plus each build's own `keys.json`, a prune deletes exactly the keys
   * that build wrote — no enumeration, no guessing.
   */
  history: 'build:history',
  place: (hash: string, id: string) => `place:${hash}:${id}`,
  /** Member pole id → its place id. Lets a bare pole id (from a route's stop list) resolve. */
  alias: (hash: string, stopId: string) => `alias:${hash}:${stopId}`,
  route: (hash: string, id: string) => `route:${hash}:${id}`,
  cell: (hash: string, cell: string) => `geo:${hash}:${cell}`,
} as const

/** R2 object keys for the bulk artefacts. */
export const buildObjects = {
  searchIndex: (hash: string) => `builds/${hash}/search-index.json`,
  manifest: (hash: string) => `builds/${hash}/manifest.json`,
  /** Every KV key this build wrote — the exact delete list for pruning it later. */
  keys: (hash: string) => `builds/${hash}/keys.json`,
} as const

// ── Spatial cells ────────────────────────────────────────────────────────────────────────

/**
 * Geo bucket size in degrees. ~1.1 km at Hong Kong's latitude, chosen against the 500 m
 * default nearby radius: the query bounding box is 1 km across, so it touches four cells in
 * the worst case and one or two typically. Smaller cells would mean more reads per request;
 * larger ones would mean pulling a big slab of the territory to answer a street-corner query.
 */
export const CELL_DEG = 0.01

/** The cell a coordinate belongs to. Stable and grid-aligned — never derived from a stop set. */
export function geoCell(lat: number, lng: number): string {
  return `${Math.floor(lat / CELL_DEG)}_${Math.floor(lng / CELL_DEG)}`
}

/**
 * Slack added to the query radius when choosing cells. A place is filed under its **anchor**
 * cell but ranked by its **nearest member**, and members sit up to ~30 m from the anchor — so
 * without padding, a place whose nearest pole is just inside the radius could be missed because
 * its anchor sits in a cell we didn't read. 100 m is comfortably more than the 30 m merge radius.
 */
const CELL_PAD_M = 100

/** Every cell whose square overlaps the `radiusM` circle around a point (plus `CELL_PAD_M`). */
export function cellsForRadius(lat: number, lng: number, radiusM: number): string[] {
  const padded = radiusM + CELL_PAD_M
  // Latitude degrees are constant; longitude degrees shrink with latitude, so the box is wider
  // in degrees than it is tall. Guard the cosine so a nonsense coordinate can't explode it.
  const dLat = padded / 111_320
  const dLng = padded / (111_320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))
  const cells: string[] = []
  const y0 = Math.floor((lat - dLat) / CELL_DEG)
  const y1 = Math.floor((lat + dLat) / CELL_DEG)
  const x0 = Math.floor((lng - dLng) / CELL_DEG)
  const x1 = Math.floor((lng + dLng) / CELL_DEG)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(`${y}_${x}`)
  return cells
}

// ── Derivations ──────────────────────────────────────────────────────────────────────────

const EMPTY_TEXT: I18nText = { en: '', 'zh-Hant': '', 'zh-Hans': '' }

function toMember(s: IndexStop, aliases: readonly IndexStop[]): MemberDoc {
  return {
    id: s.id,
    operator: s.operator,
    stopId: s.stopId,
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    ...(aliases.length > 0 ? { aliasIds: aliases.map((a) => a.id) } : {}),
  }
}

/**
 * Project a route onto the **summary service tier** — `service.patterns` dropped (ADR-065).
 * Returns the argument untouched when there is nothing to drop, so re-summarizing a document a
 * build already summarized costs no allocation.
 *
 * Exported because two callers need the *same* definition of what the tier is, for two different
 * reasons: the shard build drops `patterns` for **size** (54 MB of an 82 MB build, ADR-055 §7),
 * and the Worker's `/v1/stop/:id` drops it for the **contract** — a KV document is untyped JSON
 * that may have been written by an older publisher, and the endpoint's tier must be a property of
 * the endpoint, not of whatever happens to be in the namespace.
 */
export function toRouteSummary(route: Route): RouteSummary {
  if (!route.service?.patterns) return route
  const { patterns: _dropped, ...summary } = route.service
  // A route whose only static fact *was* the frequency table has no summary-tier facts left;
  // emitting `service: {}` would claim otherwise.
  if (Object.keys(summary).length === 0) {
    const { service: _empty, ...rest } = route
    return rest
  }
  return { ...route, service: summary }
}

function routeOf(index: StaticIndex, routeId: string): Route | null {
  const meta = index.routeMeta.get(routeId)
  if (!meta) return null
  const service = meta.service
  return {
    id: routeId,
    operator: meta.operator,
    routeNo: meta.route,
    bound: meta.bound,
    serviceType: meta.serviceType,
    origin: meta.origin ?? EMPTY_TEXT,
    destination: meta.destination ?? EMPTY_TEXT,
    ...(service && Object.keys(service).length > 0 ? { service } : {}),
  }
}

/** 1-based sequence of a canonical stop on a route, if it serves it. */
function seqOf(index: StaticIndex, routeId: string, stopId: string): number | undefined {
  return index.routeToStops.get(routeId)?.find((rs) => rs.stopId === stopId)?.seq
}

/** GMB live-board resolution entries for exactly the routes at these poles (ADR-047). */
function gmbLiveFor(
  index: StaticIndex,
  poles: readonly IndexStop[],
): Record<string, string> | undefined {
  const wanted = new Set<string>()
  for (const m of poles) {
    if (m.operator !== 'GMB') continue
    for (const r of index.stopToRoutes.get(m.id) ?? []) {
      wanted.add(canonicalRouteId(r.operator, r.route, r.bound, r.serviceType))
    }
  }
  if (wanted.size === 0) return undefined
  const out: Record<string, string> = {}
  for (const [live, routeId] of index.gmbCanonicalByLive) {
    if (wanted.has(routeId)) out[live] = routeId
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Distinct rider lines (operator + number + direction) across a set of poles. */
function routeCountOf(index: StaticIndex, poles: readonly IndexStop[]): number {
  const lines = new Set<string>()
  for (const m of poles) {
    for (const r of index.stopToRoutes.get(m.id) ?? [])
      lines.add(`${r.operator}|${r.route}|${r.bound}`)
  }
  return lines.size
}

/**
 * The place a canonical id denotes: an explicit `P:` place, a member's place, or a lone stop.
 *
 * A `P:` id is self-describing (`P:<memberId>+<memberId>+…`), so it resolves through its members
 * rather than a scan of `index.places` — which matters because the dev fallback calls this per
 * request. It tries **every** member, so a *stale* place id still lands on the current place even
 * when the pole named first has since been retired upstream; only an id with no surviving member
 * at all resolves to nothing. `memberStopIds` (the id grammar, `@nextbus/core/ids`) yields the
 * members of a place id and a lone pole as a set of one, so there is no prefix test here.
 */
function placeFor(index: StaticIndex, id: string): { place?: IndexPlace; members: IndexStop[] } {
  const seedIds = memberStopIds(id)
  for (const seedId of seedIds) {
    const stop = index.stopById.get(seedId)
    if (!stop) continue
    // Promote a bare pole to its *current* place, so tapping a stop on a route lands on the whole
    // place rather than a lone pole (ADR-042). Member ids are stable; the place id is derived.
    const place = index.placeByStopId.get(stop.id)
    return place ? { place, members: place.members } : { members: [stop] }
  }
  return { members: [] }
}

/** Build the `PlaceDoc` for a place id, a member pole id, or a standalone stop id. */
export function placeDocFor(index: StaticIndex, id: string): PlaceDoc | null {
  const { place, members: raw } = placeFor(index, id)
  if (raw.length === 0) return null
  const aliasesOf = (memberId: string): readonly IndexStop[] => place?.aliases?.get(memberId) ?? []
  const members = raw.map((m) => toMember(m, aliasesOf(m.id)))
  const anchor = place ?? raw[0]
  if (!anchor) return null

  // Every upstream pole this place answers for: each boarding point, then the poles folded onto it.
  // Routes are read per *pole*, because a folded pole's routes are its own — upstream lists them
  // there and nowhere else — and each row keeps the pole id the route's own stop list names.
  const poles = raw.flatMap((m) => [m, ...aliasesOf(m.id)])
  const routes: PlaceRouteDoc[] = []
  for (const pole of poles) {
    for (const ref of index.stopToRoutes.get(pole.id) ?? []) {
      const routeId = canonicalRouteId(ref.operator, ref.route, ref.bound, ref.serviceType)
      const route = routeOf(index, routeId)
      if (!route) continue
      const meta = index.routeMeta.get(routeId)
      const seq = seqOf(index, routeId, pole.id)
      const fare = meta && seq ? routeFareAtSeq(meta, seq) : undefined
      routes.push({ stopId: pole.id, route: toRouteSummary(route), ...(fare ? { fare } : {}) })
    }
  }

  const gmbLive = gmbLiveFor(index, poles)
  return {
    id: place ? place.id : anchor.id,
    name: place ? place.name : anchor.name,
    lat: anchor.lat,
    lng: anchor.lng,
    ...(place?.meanBearingDeg === undefined ? {} : { bearingDeg: place.meanBearingDeg }),
    members,
    routes,
    routeCount: routeCountOf(index, poles),
    ...(gmbLive ? { gmbLive } : {}),
  }
}

/** Prefer service type "1" as the representative variant, else the lowest (mirrors the search
 *  index's collapsing, so a direction toggle lands on the same "main" variant riders search). */
function preferServiceType(a: string, b: string): string {
  if (a === '1') return a
  if (b === '1') return b
  return a.localeCompare(b, 'en', { numeric: true }) <= 0 ? a : b
}

/** Build the `RouteDoc` for a canonical route id. */
export function routeDocFor(index: StaticIndex, id: string): RouteDoc | null {
  const meta = index.routeMeta.get(id)
  const seqStops = index.routeToStops.get(id) ?? []
  const route = routeOf(index, id)
  if (!meta || !route || seqStops.length === 0) return null

  const stops: RouteDocStop[] = []
  for (const rs of seqStops) {
    const rec = index.stopById.get(rs.stopId)
    if (!rec) continue
    const fare = routeFareAtSeq(meta, rs.seq)
    stops.push({
      seq: rs.seq,
      id: rec.id,
      operator: rec.operator,
      stopId: rec.stopId,
      name: rec.name,
      lat: rec.lat,
      lng: rec.lng,
      ...(fare ? { fare } : {}),
    })
  }

  // The opposite bound, if the dataset carries a loadable one. Requires a real stop sequence,
  // so the client can always follow the toggle (ADR-046).
  let best: typeof meta | undefined
  const opposite = meta.bound === 'inbound' ? 'outbound' : 'inbound'
  for (const m of index.routeMeta.values()) {
    if (m.operator !== meta.operator || m.route !== meta.route || m.bound !== opposite) continue
    const rid = canonicalRouteId(m.operator, m.route, m.bound, m.serviceType)
    if (!index.routeToStops.get(rid)?.length) continue
    if (!best || preferServiceType(m.serviceType, best.serviceType) === m.serviceType) best = m
  }

  return {
    route,
    stops,
    ...(meta.gtfsId ? { gtfsId: meta.gtfsId } : {}),
    ...(best
      ? {
          reverse: {
            id: canonicalRouteId(best.operator, best.route, best.bound, best.serviceType),
            origin: best.origin,
            destination: best.destination,
          },
        }
      : {}),
  }
}

/** The ranking stub for a place or lone stop. */
function geoEntryFor(place: IndexPlace | undefined, seed: IndexStop): GeoEntry {
  if (!place) return { id: seed.id, lat: seed.lat, lng: seed.lng }
  return {
    id: place.id,
    lat: place.lat,
    lng: place.lng,
    poles: place.members.map((m) => [m.lat, m.lng] as [number, number]),
  }
}

/**
 * Every geo cell, each holding the places and lone stops anchored inside it.
 *
 * A multi-pole place is filed **once**, under its anchor (centroid) cell — never once per
 * member — so a query can't see the same place twice and the "N places" a card counts stays
 * honest. Members can straddle a cell boundary, but they sit ≤30 m apart while a cell is
 * ~1.1 km, so the anchor is always within a cell of every member and the reader's
 * radius-based filter still catches it.
 */
export function allGeoCells(index: StaticIndex): Map<string, GeoEntry[]> {
  const cells = new Map<string, GeoEntry[]>()
  const push = (entry: GeoEntry) => {
    const key = geoCell(entry.lat, entry.lng)
    const bucket = cells.get(key)
    if (bucket) bucket.push(entry)
    else cells.set(key, [entry])
  }
  for (const place of index.places) {
    const seed = place.members[0]
    if (seed) push(geoEntryFor(place, seed))
  }
  for (const stop of index.stops) {
    if (index.placeByStopId.has(stop.id)) continue
    push(geoEntryFor(undefined, stop))
  }
  // Deterministic order so the same dataset always hashes to the same build.
  for (const bucket of cells.values()) bucket.sort((a, b) => a.id.localeCompare(b.id))
  return new Map([...cells].sort((a, b) => a[0].localeCompare(b[0])))
}

/**
 * Pole id → the place id that owns it. Only clustered poles; lone stops key themselves.
 *
 * Read straight off `placeByStopId` rather than off each place's `members`, and that is
 * load-bearing: a pole folded onto a member (WP5-11) is not in `members`, but it **is** an id a
 * rider may have starred and a route's stop list still names, so it has to resolve. `placeByStopId`
 * is the index's own answer to "which place does this pole belong to?", so deriving the table from
 * it means the two can never disagree.
 */
export function allAliases(index: StaticIndex): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const [stopId, place] of index.placeByStopId) aliases.set(stopId, place.id)
  return new Map([...aliases].sort((a, b) => a[0].localeCompare(b[0])))
}

/** Every id that gets its own `PlaceDoc`: one per place, plus every unmerged stop. */
export function allPlaceIds(index: StaticIndex): string[] {
  const ids = index.places.map((p) => p.id)
  for (const s of index.stops) if (!index.placeByStopId.has(s.id)) ids.push(s.id)
  return ids.sort()
}

/** Every route id with a loadable stop sequence. */
export function allRouteIds(index: StaticIndex): string[] {
  return [...index.routeMeta.keys()]
    .filter((id) => (index.routeToStops.get(id)?.length ?? 0) > 0)
    .sort()
}

/**
 * Nearby hits from a set of geo-cell entries, closest first. Shared by both dataset sources so
 * the KV path and the dev fallback rank identically.
 *
 * Distance is to the **nearest member pole**, not the place centroid: that's the walk the rider
 * actually makes, and it preserves the pre-shard behaviour (which ordered raw stop hits and let
 * the closest member speak for its place). Ties break on id so the order is deterministic.
 */
export function nearbyFromCells(
  entries: GeoEntry[],
  lat: number,
  lng: number,
  radiusM: number,
  limit: number,
): Array<{ entry: GeoEntry; distanceM: number }> {
  const hits: Array<{ entry: GeoEntry; distanceM: number }> = []
  for (const entry of entries) {
    // Measure to the poles when we have them and to the anchor only otherwise. Including the
    // centroid alongside the poles would report 0 m for a rider standing between two poles that
    // are each 15 m away — nearer than the walk they actually face, and enough to reorder a
    // genuinely closer lone stop below it.
    const poles = entry.poles ?? []
    let nearest =
      poles.length > 0 ? Number.POSITIVE_INFINITY : haversineM(lat, lng, entry.lat, entry.lng)
    for (const [pLat, pLng] of poles) {
      nearest = Math.min(nearest, haversineM(lat, lng, pLat, pLng))
    }
    if (nearest <= radiusM) hits.push({ entry, distanceM: Math.round(nearest) })
  }
  hits.sort((a, b) => a.distanceM - b.distanceM || a.entry.id.localeCompare(b.entry.id))
  return hits.slice(0, limit)
}
