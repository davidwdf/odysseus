import {
  dedupeEtas,
  type Eta,
  type OperatorId,
  type Route,
  type RouteDetail,
  type Stop,
  type StopDetail,
} from '@nextbus/core'
import {
  canonicalRouteId,
  fetchEta,
  fetchKmbRouteEta,
  type IndexRouteRef,
  type IndexStop,
  routeFareAtSeq,
  type StaticIndex,
} from '@nextbus/data-normalize'
import { getStaticIndex } from './static-index'

// Cap the per-stop ETA fan-out so a cold stop request stays cheap (edge-cached).
// Routes beyond the cap are still listed (static), just without a live ETA.
const MAX_ETA_ROUTES = 24

function toStop(s: IndexStop): Stop {
  return {
    id: s.id,
    name: s.name,
    location: { lat: s.lat, lng: s.lng },
    sources: [{ operator: s.operator, operatorStopId: s.stopId }],
  }
}

/** A merged same-kerb stop: one canonical `Stop` carrying every member operator's
 *  source id. `rep` supplies the display name/location. */
export function toMergedStop(id: string, members: IndexStop[], rep: IndexStop): Stop {
  return {
    id,
    name: rep.name,
    location: { lat: rep.lat, lng: rep.lng },
    sources: members.map((m) => ({ operator: m.operator, operatorStopId: m.stopId })),
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

/** Live ETAs for a single-operator stop's routes, deduping upstream calls by
 *  (route, serviceType) — the operator feed returns *every direction* in one
 *  response, so per-direction refs must not re-fetch (that's the double-count). */
async function fetchStopEtas(
  operator: OperatorId,
  rawStopId: string,
  refs: IndexRouteRef[],
  maxRoutes: number,
): Promise<Eta[]> {
  const seen = new Set<string>()
  const pairs: Array<{ route: string; serviceType: string }> = []
  for (const r of refs) {
    const key = `${r.route}|${r.serviceType}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push({ route: r.route, serviceType: r.serviceType })
    if (pairs.length >= maxRoutes) break
  }
  const lists = await Promise.all(
    pairs.map((p) =>
      fetchEta(operator, rawStopId, p.route, p.serviceType).catch(() => [] as Eta[]),
    ),
  )
  return lists.flat()
}

/** Raw (call-deduped, not yet rider-deduped) ETAs across every member of a
 *  (possibly merged same-kerb) stop. Members are fetched concurrently. */
async function memberEtaLists(
  index: StaticIndex,
  members: IndexStop[],
  maxRoutes = MAX_ETA_ROUTES,
): Promise<Eta[]> {
  const lists = await Promise.all(
    members.map((m) =>
      fetchStopEtas(m.operator, m.stopId, index.stopToRoutes.get(m.id) ?? [], maxRoutes),
    ),
  )
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
  maxRoutes = MAX_ETA_ROUTES,
): Promise<Eta[]> {
  const all = dedupeEtas(await memberEtaLists(index, members, maxRoutes))
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
  const members = resolveMembers(index, id)
  const rep = members[0]
  if (!rep) throw new Error(`unknown stop: ${id}`)

  const etaByRouteId = new Map<string, Eta>()
  for (const e of await memberEtaLists(index, members)) etaByRouteId.set(e.routeId, e)
  const routes = members.flatMap((m) =>
    (index.stopToRoutes.get(m.id) ?? []).map((ref) => {
      const route = toRoute(ref, index)
      const meta = index.routeMeta.get(route.id)
      const seq = seqOf(index, route.id, m.id)
      const fare = meta && seq ? routeFareAtSeq(meta, seq) : undefined
      return { route, eta: etaByRouteId.get(route.id) ?? null, fare }
    }),
  )
  return { stop: toMergedStop(id, members, rep), routes }
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
  return { route: toRoute(meta, index), stops }
}
