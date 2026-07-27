import {
  type Bound,
  dedupeEtas,
  type Eta,
  type RouteDetail,
  type Stop,
  type StopDetail,
} from '@nextbus/core'
import {
  fetchEta,
  fetchGmbStopEta,
  fetchKmbRouteEta,
  fetchKmbStopEta,
  type GmbEtaEntry,
  type MemberDoc,
  type PlaceDoc,
} from '@nextbus/data-normalize'
import type { DatasetSource } from './dataset'
import { coalesce } from './eta-cache'

// Per-place CTB fan-out budget (ADR-042). KMB poles cost ONE call each (`stop-eta` returns
// every route), so only CTB — which has no per-stop endpoint — needs bounding; this guards a
// pathological interchange. Routes beyond it are still counted (static) and shown on the
// Place page. The default is generous (≈ "all" in practice); Nearby passes a smaller one.
const DEFAULT_CTB_BUDGET = 24

/** A place's members as a canonical `Stop` — one id carrying every member operator's source id.
 *  `name`/`location` are the place's chosen name + anchor, picked once by the build so every
 *  screen reads the same (ADR-042 "name once"). */
export function toMergedStop(place: {
  id: string
  name: PlaceDoc['name']
  lat: number
  lng: number
  bearingDeg?: number
  members: MemberDoc[]
}): Stop {
  return {
    id: place.id,
    name: place.name,
    location: { lat: place.lat, lng: place.lng },
    sources: place.members.map((m) => ({ operator: m.operator, operatorStopId: m.stopId })),
    ...(place.bearingDeg === undefined ? {} : { bearingDeg: place.bearingDeg }),
  }
}

/** Map a GMB stop-board's raw (route_id, route_seq) entries to canonical `Eta`s (ADR-047).
 *  `route_seq` 1 → outbound, 2 → inbound; entries whose route isn't in this place's resolution
 *  table (or with no arrivals) are dropped. */
function gmbEtasFrom(entries: GmbEtaEntry[], gmbLive: Record<string, string>): Eta[] {
  const out: Eta[] = []
  for (const en of entries) {
    if (en.arrivals.length === 0) continue
    const bound: Bound = en.routeSeq === 2 ? 'inbound' : 'outbound'
    const routeId = gmbLive[`${en.routeId}:${bound}`]
    if (!routeId) continue
    out.push({
      routeId,
      stopId: en.stopId,
      operator: 'GMB',
      arrivals: en.arrivals,
      dataTimestamp: en.dataTimestamp,
      observedAt: en.observedAt,
      ...(en.remark ? { remark: en.remark } : {}),
    })
  }
  return out
}

/** Distinct CTB route numbers at one member pole, in document order. */
function ctbRoutesAt(place: PlaceDoc, memberId: string): string[] {
  const seen = new Set<string>()
  for (const r of place.routes) {
    if (r.stopId === memberId) seen.add(r.route.routeNo)
  }
  return [...seen]
}

/**
 * Raw (call-deduped, not yet rider-deduped) ETAs across every member pole of a place
 * (ADR-042). Each KMB or GMB pole is ONE stop-board call (all its routes); CTB is per-route,
 * bounded by a per-place budget. Members and CTB routes are fetched concurrently.
 *
 * Every upstream call goes through `coalesce` (WP0-4), so a pole is fetched **once per 30 s
 * per isolate** no matter how many places, requests or concurrent callers want it: the
 * distinct call keys below are exactly the upstream calls this function can issue.
 * The GMB *raw* board is what's cached — the mapping to canonical ids uses the place's own
 * resolution table, so a cached board can't outlive the build that resolved it.
 */
async function memberEtaLists(place: PlaceDoc, ctbBudget = DEFAULT_CTB_BUDGET): Promise<Eta[]> {
  const tasks: Array<Promise<Eta[]>> = []
  let ctbRemaining = ctbBudget
  // A pole can appear twice in one member list (an overlapping caller, a malformed doc);
  // dedupe here so the budget isn't spent on a repeat we'd only coalesce away.
  const polesSeen = new Set<string>()
  for (const m of place.members) {
    if (polesSeen.has(m.id)) continue
    polesSeen.add(m.id)
    if (m.operator === 'CTB') {
      for (const routeNo of ctbRoutesAt(place, m.id)) {
        if (ctbRemaining <= 0) break
        ctbRemaining--
        // CTB has no per-stop board (ADR-021), so the call key is per (pole, route).
        const key = `CTB-eta|${m.stopId}|${routeNo}|1`
        tasks.push(coalesce(key, () => fetchEta('CTB', m.stopId, routeNo, '1'), []))
      }
    } else if (m.operator === 'GMB') {
      // GMB: one stop-board call returns every route at this pole (like KMB); the edge
      // resolves its raw route_id/seq to our canonical ids (ADR-047).
      const gmbLive = place.gmbLive ?? {}
      const raw = coalesce<GmbEtaEntry[]>(
        `gmb-board|${m.stopId}`,
        () => fetchGmbStopEta(m.stopId),
        [],
      )
      tasks.push(raw.then((entries) => gmbEtasFrom(entries, gmbLive)))
    } else {
      // KMB/LWB: one call returns every route at this pole. Both operators read the same
      // KMB `stop-eta` board, so the pole id alone is the call key.
      tasks.push(coalesce<Eta[]>(`kmb-board|${m.stopId}`, () => fetchKmbStopEta(m.stopId), []))
    }
  }
  const lists = await Promise.all(tasks)
  return lists.flat().filter((e) => e.arrivals.length > 0)
}

/** The rider-facing line an `Eta` belongs to. `dedupeEtas` collapses on exactly this, so it is
 *  the key that still matches when a live reading's service-type variant isn't the one the static
 *  data lists at this pole. */
const lineKey = (operator: string, routeId: string): string => {
  const [, routeNo = '', bound = ''] = routeId.split(':')
  return `${operator}|${routeNo}|${bound}`
}

/**
 * `${routeId}|${rawStopId}` → the boarding fare there, plus route → destination. Both are
 * precomputed into the place document, so stamping costs no extra lookup.
 *
 * Destinations are indexed by **route id and by rider line**. The exact id can miss: a KMB
 * stop-board returns every service-type variant at the pole, `dedupeEtas` keeps whichever is
 * soonest, and that variant may not be the one the static data lists here. Falling back to
 * operator+number+direction — the same key `dedupeEtas` collapses on — keeps "→ destination" on
 * the card instead of dropping it for exactly the readings a rider is most likely to see.
 */
function stampTables(place: PlaceDoc) {
  const memberById = new Map(place.members.map((m) => [m.id, m]))
  const fareByRouteAndRawStop = new Map<string, string>()
  const destinationByRoute = new Map<string, PlaceDoc['name']>()
  const destinationByLine = new Map<string, PlaceDoc['name']>()
  for (const r of place.routes) {
    destinationByRoute.set(r.route.id, r.route.destination)
    const line = lineKey(r.route.operator, r.route.id)
    if (!destinationByLine.has(line)) destinationByLine.set(line, r.route.destination)
    const raw = memberById.get(r.stopId)?.stopId
    if (r.fare && raw) fareByRouteAndRawStop.set(`${r.route.id}|${raw}`, r.fare)
  }
  return { fareByRouteAndRawStop, destinationByRoute, destinationByLine }
}

/**
 * THE canonical live arrivals for a stop or merged place: upstream calls deduped by
 * (route, serviceType), then collapsed to **one rider line per route+direction**
 * (`dedupeEtas`), soonest first. The single source every `Eta[]`-returning endpoint
 * (`/v1/nearby`, `/v1/etas`) flows through — so the API is consistently de-duplicated
 * and the frontend never re-dedupes. (`/v1/stop` returns the full route *list* with
 * per-route ETAs; its list-level collapse is the client's `dedupeRoutes`.)
 */
export async function stopArrivals(
  place: PlaceDoc,
  ctbBudget = DEFAULT_CTB_BUDGET,
): Promise<Eta[]> {
  const all = dedupeEtas(await memberEtaLists(place, ctbBudget))
  const { fareByRouteAndRawStop, destinationByRoute, destinationByLine } = stampTables(place)
  // Stamp each reading with its route's destination + boarding fare so flat ETA lists can show
  // "→ dest · $6.7" without the full Route object (ADR-036).
  return all
    .map((e) => {
      const destination =
        destinationByRoute.get(e.routeId) ?? destinationByLine.get(lineKey(e.operator, e.routeId))
      const fare = fareByRouteAndRawStop.get(`${e.routeId}|${e.stopId}`)
      if (!destination && !fare) return e
      return { ...e, ...(destination ? { destination } : {}), ...(fare ? { fare } : {}) }
    })
    .sort((a, b) => (a.arrivals[0] ?? '').localeCompare(b.arrivals[0] ?? ''))
}

/** GET /v1/stop/:id — a stop (or merged same-kerb place) and every route serving it,
 *  each with its next ETA. A `P:`-prefixed id spans both operators at one kerb. */
export async function stopDetail(ds: DatasetSource, id: string): Promise<StopDetail> {
  const place = await ds.place(id)
  if (!place) throw new Error(`unknown stop: ${id}`)

  const etaByRouteId = new Map<string, Eta>()
  for (const e of await memberEtaLists(place)) etaByRouteId.set(e.routeId, e)

  return {
    stop: toMergedStop(place),
    // `stopId` records which member pole each route departs from, so the Place screen can
    // group routes under their pole (ADR-042).
    routes: place.routes.map((r) => ({
      route: r.route,
      eta: etaByRouteId.get(r.route.id) ?? null,
      fare: r.fare,
      stopId: r.stopId,
    })),
    members: place.members.map((m) => ({
      id: m.id,
      name: m.name,
      location: { lat: m.lat, lng: m.lng },
    })),
  }
}

/** GET /v1/etas/:id — flat ETA list for a stop or merged place (optionally route-filtered). */
export async function stopEtas(ds: DatasetSource, id: string, routeIds?: string[]): Promise<Eta[]> {
  const place = await ds.place(id)
  if (!place) throw new Error(`unknown stop: ${id}`)

  const all = await stopArrivals(place)
  if (!routeIds?.length) return all
  const wanted = new Set(routeIds)
  return all.filter((e) => wanted.has(e.routeId))
}

/** GET /v1/route/:id — a route and its ordered stop list, each stop carrying the route's
 *  own next arrival there (ADR-030). KMB/LWB pull every stop's ETA in ONE upstream call
 *  (`route-eta`); CTB has no bulk route-eta endpoint (ADR-021) so it stays static-only. */
export async function routeDetail(ds: DatasetSource, id: string): Promise<RouteDetail> {
  const doc = await ds.route(id)
  if (!doc) throw new Error(`unknown route: ${id}`)
  const { route } = doc

  // Live arrivals along the whole route, keyed by sequence (the route-eta feed identifies
  // stops only by `seq`). Coalesced like the stop boards (WP0-4): every direction and
  // service-type variant of a number reads the same upstream feed, so opening two route
  // screens for one number costs one call. A failure degrades to a static-only route view —
  // `coalesce` resolves to `[]` and doesn't cache the failure — rather than erroring the screen.
  const etaBySeq = new Map<number, Eta>()
  if (route.operator === 'KMB' || route.operator === 'LWB') {
    const entries = await coalesce(
      `kmb-route-eta|${route.routeNo}|${route.serviceType}`,
      () => fetchKmbRouteEta(route.routeNo, route.serviceType),
      [],
    )
    for (const entry of entries) {
      if (entry.eta.routeId === id && entry.eta.arrivals.length > 0) {
        etaBySeq.set(entry.seq, entry.eta)
      }
    }
  }

  return {
    route,
    stops: doc.stops.map((s) => {
      const eta = etaBySeq.get(s.seq)
      return {
        seq: s.seq,
        stop: {
          id: s.id,
          name: s.name,
          location: { lat: s.lat, lng: s.lng },
          sources: [{ operator: s.operator, operatorStopId: s.stopId }],
        },
        // route-eta carries no stop id, so stamp the operator stop id we already know
        // (matching the raw-id convention the other ETA endpoints use).
        eta: eta ? { ...eta, stopId: s.stopId } : null,
        fare: s.fare,
      }
    }),
    ...(doc.reverse ? { reverse: doc.reverse } : {}),
  }
}
