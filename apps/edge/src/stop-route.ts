import {
  type Bound,
  dedupeEtas,
  type Eta,
  type I18nText,
  type LatLng,
  type Route,
  type RouteDetail,
  type RouteRef,
  type Stop,
  type StopDetail,
} from '@nextbus/core'
import {
  canonicalRouteId,
  fetchEta,
  fetchGmbStopEta,
  fetchKmbRouteEta,
  fetchKmbStopEta,
  type GmbEtaEntry,
  type IndexRouteMeta,
  type IndexRouteRef,
  type IndexStop,
  routeFareAtSeq,
  type StaticIndex,
} from '@nextbus/data-normalize'
import { getStaticIndex } from './static-index'

// Per-place CTB fan-out budget (ADR-042). KMB poles cost ONE call each (`stop-eta` returns
// every route), so only CTB — which has no per-stop endpoint — needs bounding; this guards a
// pathological interchange. Routes beyond it are still counted (static) and shown on the
// Place page. The default is generous (≈ "all" in practice); Nearby passes a smaller one.
const DEFAULT_CTB_BUDGET = 24

function toStop(s: IndexStop): Stop {
  return {
    id: s.id,
    name: s.name,
    location: { lat: s.lat, lng: s.lng },
    sources: [{ operator: s.operator, operatorStopId: s.stopId }],
  }
}

/** A merged same-kerb stop: one canonical `Stop` carrying every member operator's source id.
 *  `name`/`location` are the place's chosen name + anchor (centroid) — picked once in
 *  `buildPlaces` so every screen reads the same (ADR-042 "name once"). */
export function toMergedStop(
  id: string,
  members: IndexStop[],
  name: I18nText,
  location: LatLng,
  bearingDeg?: number,
): Stop {
  return {
    id,
    name,
    location,
    sources: members.map((m) => ({ operator: m.operator, operatorStopId: m.stopId })),
    ...(bearingDeg === undefined ? {} : { bearingDeg }),
  }
}

/** Resolve a canonical id — a single stop id, or a `P:`-prefixed same-kerb place id
 *  (`P:<memberId>+<memberId>`) — to its member index stops, dropping any unknown ids. */
export function resolveMembers(index: StaticIndex, id: string): IndexStop[] {
  const ids = id.startsWith('P:') ? id.slice(2).split('+') : [id]
  return ids.map((mid) => index.stopById.get(mid)).filter((s): s is IndexStop => Boolean(s))
}

function toRoute(ref: IndexRouteRef, index: StaticIndex): Route {
  const id = canonicalRouteId(ref.operator, ref.route, ref.bound, ref.serviceType)
  const meta = index.routeMeta.get(id)
  const empty = { en: '', 'zh-Hant': '', 'zh-Hans': '' }
  return {
    id,
    operator: ref.operator,
    routeNo: ref.route,
    bound: ref.bound,
    serviceType: ref.serviceType,
    origin: meta?.origin ?? empty,
    destination: meta?.destination ?? empty,
    service: meta?.service,
  }
}

/** 1-based sequence of a (canonical) stop on a route, if it serves it. */
function seqOf(index: StaticIndex, routeId: string, stopId: string): number | undefined {
  return index.routeToStops.get(routeId)?.find((rs) => rs.stopId === stopId)?.seq
}

/** Distinct rider lines (operator + route + direction) serving a place, from the static
 *  index alone — no live call. The honest "N routes" count a compact card shows (ADR-042). */
export function placeRouteCount(index: StaticIndex, members: IndexStop[]): number {
  const lines = new Set<string>()
  for (const m of members) {
    for (const r of index.stopToRoutes.get(m.id) ?? [])
      lines.add(`${r.operator}|${r.route}|${r.bound}`)
  }
  return lines.size
}

/** Map a GMB stop-board's raw (route_id, route_seq) entries to canonical `Eta`s, resolving
 *  the route via the index (ADR-047). `route_seq` 1 → outbound, 2 → inbound; entries whose
 *  route isn't in our index (or with no arrivals) are dropped. */
function gmbEtasFrom(entries: GmbEtaEntry[], index: StaticIndex): Eta[] {
  const out: Eta[] = []
  for (const en of entries) {
    if (en.arrivals.length === 0) continue
    const bound: Bound = en.routeSeq === 2 ? 'inbound' : 'outbound'
    const routeId = index.gmbCanonicalByLive.get(`${en.routeId}:${bound}`)
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

/** Raw (call-deduped, not yet rider-deduped) ETAs across every member pole of a place
 *  (ADR-042). Each KMB or GMB pole is ONE stop-board call (all its routes); CTB is per-route,
 *  bounded by a per-place budget. Members and CTB routes are fetched concurrently. */
async function memberEtaLists(
  index: StaticIndex,
  members: IndexStop[],
  ctbBudget = DEFAULT_CTB_BUDGET,
): Promise<Eta[]> {
  const tasks: Array<Promise<Eta[]>> = []
  let ctbRemaining = ctbBudget
  for (const m of members) {
    if (m.operator === 'CTB') {
      const seen = new Set<string>()
      for (const r of index.stopToRoutes.get(m.id) ?? []) {
        if (seen.has(r.route)) continue
        seen.add(r.route)
        if (ctbRemaining <= 0) break
        ctbRemaining--
        tasks.push(fetchEta('CTB', m.stopId, r.route, '1').catch(() => [] as Eta[]))
      }
    } else if (m.operator === 'GMB') {
      // GMB: one stop-board call returns every route at this pole (like KMB); the edge
      // resolves its raw route_id/seq to our canonical ids (ADR-047).
      tasks.push(
        fetchGmbStopEta(m.stopId)
          .then((entries) => gmbEtasFrom(entries, index))
          .catch(() => [] as Eta[]),
      )
    } else {
      // KMB/LWB: one call returns every route at this pole.
      tasks.push(fetchKmbStopEta(m.stopId).catch(() => [] as Eta[]))
    }
  }
  const lists = await Promise.all(tasks)
  return lists.flat().filter((e) => e.arrivals.length > 0)
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
  index: StaticIndex,
  members: IndexStop[],
  ctbBudget = DEFAULT_CTB_BUDGET,
): Promise<Eta[]> {
  const all = dedupeEtas(await memberEtaLists(index, members, ctbBudget))
  // Stamp each reading with its route's destination + boarding fare (from canonical route
  // meta) so flat ETA lists can show "→ dest · $6.7" without the full Route object (ADR-036).
  return all
    .map((e) => {
      const meta = index.routeMeta.get(e.routeId)
      if (!meta) return e
      const seq = seqOf(index, e.routeId, `${e.operator}:${e.stopId}`)
      const fare = seq ? routeFareAtSeq(meta, seq) : undefined
      const stamped: Eta = { ...e }
      if (meta.destination) stamped.destination = meta.destination
      if (fare) stamped.fare = fare
      return stamped
    })
    .sort((a, b) => (a.arrivals[0] ?? '').localeCompare(b.arrivals[0] ?? ''))
}

/** GET /v1/stop/:id — a stop (or merged same-kerb place) and every route serving it,
 *  each with its next ETA. A `P:`-prefixed id spans both operators at one kerb. */
export async function stopDetail(id: string): Promise<StopDetail> {
  const index = await getStaticIndex()
  const seed = resolveMembers(index, id)
  const rep = seed[0]
  if (!rep) throw new Error(`unknown stop: ${id}`)
  // Promote a bare member id to its *current* place, so tapping a stop on a route lands on the
  // whole place (grouped by pole), not a lone pole (ADR-042). A `P:` id or standalone stop is
  // unchanged. Member ids are stable; the place id is derived here from the live clustering.
  const place = index.placeByStopId.get(rep.id)
  const members = place ? place.members : seed
  const placeId = place ? place.id : id

  const etaByRouteId = new Map<string, Eta>()
  for (const e of await memberEtaLists(index, members)) etaByRouteId.set(e.routeId, e)
  // `stopId: m.id` records which member pole each route departs from, so the Place screen can
  // group routes under their pole (ADR-042).
  const routes = members.flatMap((m) =>
    (index.stopToRoutes.get(m.id) ?? []).map((ref) => {
      const route = toRoute(ref, index)
      const meta = index.routeMeta.get(route.id)
      const seq = seqOf(index, route.id, m.id)
      const fare = meta && seq ? routeFareAtSeq(meta, seq) : undefined
      return { route, eta: etaByRouteId.get(route.id) ?? null, fare, stopId: m.id }
    }),
  )
  const memberPoles = members.map((m) => ({
    id: m.id,
    name: m.name,
    location: { lat: m.lat, lng: m.lng },
  }))
  // Use the place's chosen name + centroid (not the rep's) so all screens agree.
  const name = place?.name ?? rep.name
  const location = place ? { lat: place.lat, lng: place.lng } : { lat: rep.lat, lng: rep.lng }
  return {
    stop: toMergedStop(placeId, members, name, location, place?.meanBearingDeg),
    routes,
    members: memberPoles,
  }
}

/** GET /v1/etas/:id — flat ETA list for a stop or merged place (optionally route-filtered). */
export async function stopEtas(id: string, routeIds?: string[]): Promise<Eta[]> {
  const index = await getStaticIndex()
  const members = resolveMembers(index, id)
  if (members.length === 0) throw new Error(`unknown stop: ${id}`)

  const all = await stopArrivals(index, members)
  if (!routeIds?.length) return all
  const wanted = new Set(routeIds)
  return all.filter((e) => wanted.has(e.routeId))
}

/** Prefer service type "1" as the representative variant, else the lowest (mirrors the
 *  search index's collapsing so the toggle lands on the same "main" variant riders search). */
function preferServiceType(a: string, b: string): string {
  if (a === '1') return a
  if (b === '1') return b
  return a.localeCompare(b, 'en', { numeric: true }) <= 0 ? a : b
}

/** The same route number in the opposite bound, if the dataset carries one (absent for
 *  circular / single-direction routes). Picks the representative service-type variant and
 *  requires it to actually have a stop sequence, so the client can always load it. ADR-046. */
function findReverse(index: StaticIndex, meta: IndexRouteMeta): RouteRef | undefined {
  const opposite: Bound = meta.bound === 'inbound' ? 'outbound' : 'inbound'
  let best: IndexRouteMeta | undefined
  for (const m of index.routeMeta.values()) {
    if (m.operator !== meta.operator || m.route !== meta.route || m.bound !== opposite) continue
    const rid = canonicalRouteId(m.operator, m.route, m.bound, m.serviceType)
    if (!index.routeToStops.get(rid)?.length) continue
    if (!best || preferServiceType(m.serviceType, best.serviceType) === m.serviceType) best = m
  }
  if (!best) return undefined
  return {
    id: canonicalRouteId(best.operator, best.route, best.bound, best.serviceType),
    origin: best.origin,
    destination: best.destination,
  }
}

/** GET /v1/route/:id — a route and its ordered stop list, each stop carrying the route's
 *  own next arrival there (ADR-030). KMB/LWB pull every stop's ETA in ONE upstream call
 *  (`route-eta`); CTB has no bulk route-eta endpoint (ADR-021) so it stays static-only. */
export async function routeDetail(id: string): Promise<RouteDetail> {
  const index = await getStaticIndex()
  const meta = index.routeMeta.get(id)
  const seqStops = index.routeToStops.get(id) ?? []
  if (!meta || seqStops.length === 0) throw new Error(`unknown route: ${id}`)

  // Live arrivals along the whole route, keyed by sequence (the route-eta feed identifies
  // stops only by `seq`). Best-effort: a failure degrades to a static-only route view
  // rather than erroring the screen.
  const etaBySeq = new Map<number, Eta>()
  if (meta.operator === 'KMB' || meta.operator === 'LWB') {
    try {
      for (const entry of await fetchKmbRouteEta(meta.route, meta.serviceType)) {
        if (entry.eta.routeId === id && entry.eta.arrivals.length > 0) {
          etaBySeq.set(entry.seq, entry.eta)
        }
      }
    } catch {
      // ignore — static-only fallback
    }
  }

  const stops: RouteDetail['stops'] = []
  for (const rs of seqStops) {
    const rec = index.stopById.get(rs.stopId)
    if (!rec) continue
    // route-eta carries no stop id, so stamp the operator stop id we already know
    // (matching the raw-id convention the other ETA endpoints use).
    const eta = etaBySeq.get(rs.seq)
    stops.push({
      seq: rs.seq,
      stop: toStop(rec),
      eta: eta ? { ...eta, stopId: rec.stopId } : null,
      fare: routeFareAtSeq(meta, rs.seq),
    })
  }
  const reverse = findReverse(index, meta)
  return { route: toRoute(meta, index), stops, ...(reverse ? { reverse } : {}) }
}
