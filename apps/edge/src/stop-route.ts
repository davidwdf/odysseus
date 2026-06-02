import type { Eta, OperatorId, Route, RouteDetail, Stop, StopDetail } from '@nextbus/core'
import {
  canonicalRouteId,
  fetchEta,
  type IndexRouteRef,
  type IndexStop,
  type StaticIndex,
} from '@nextbus/data-normalize'
import { getStaticIndex } from './static-index'

// Cap the per-stop ETA fan-out so a cold stop request stays cheap (edge-cached).
// Routes beyond the cap are still listed (static), just without a live ETA.
const MAX_ETA_ROUTES = 24

const OPERATORS: Record<string, OperatorId> = { KMB: 'KMB', LWB: 'LWB', CTB: 'CTB' }

function toStop(s: IndexStop): Stop {
  return {
    id: s.id,
    name: s.name,
    location: { lat: s.lat, lng: s.lng },
    sources: [{ operator: s.operator, operatorStopId: s.stopId }],
  }
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
  }
}

/** Parse a canonical stop id (`<OP>:<rawStopId>`), validating the operator. */
function parseStopId(id: string): { operator: OperatorId; stopId: string } {
  const [op, ...rest] = id.split(':')
  const operator = OPERATORS[op ?? '']
  if (!operator || rest.length === 0) throw new Error(`unsupported stop id: ${id}`)
  return { operator, stopId: rest.join(':') }
}

/** Live ETAs for a single-operator stop's routes, deduping upstream calls by
 *  (route, serviceType) — the operator feed returns both bounds at once. */
async function fetchStopEtas(
  operator: OperatorId,
  rawStopId: string,
  refs: IndexRouteRef[],
): Promise<Eta[]> {
  const seen = new Set<string>()
  const pairs: Array<{ route: string; serviceType: string }> = []
  for (const r of refs) {
    const key = `${r.route}|${r.serviceType}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push({ route: r.route, serviceType: r.serviceType })
    if (pairs.length >= MAX_ETA_ROUTES) break
  }
  const lists = await Promise.all(
    pairs.map((p) =>
      fetchEta(operator, rawStopId, p.route, p.serviceType).catch(() => [] as Eta[]),
    ),
  )
  return lists.flat()
}

/** GET /v1/stop/:id — a stop and every route serving it, each with its next ETA. */
export async function stopDetail(id: string): Promise<StopDetail> {
  const { operator, stopId } = parseStopId(id)
  const index = await getStaticIndex()
  const rec = index.stopById.get(id)
  if (!rec) throw new Error(`unknown stop: ${id}`)

  const refs = index.stopToRoutes.get(id) ?? []
  const etas = await fetchStopEtas(operator, stopId, refs)
  const etaByRouteId = new Map<string, Eta>()
  for (const e of etas) if (e.arrivals.length > 0) etaByRouteId.set(e.routeId, e)

  const routes = refs.map((ref) => {
    const route = toRoute(ref, index)
    return { route, eta: etaByRouteId.get(route.id) ?? null }
  })
  return { stop: toStop(rec), routes }
}

/** GET /v1/etas/:id — flat ETA list for a stop (optionally filtered to routes). */
export async function stopEtas(id: string, routeIds?: string[]): Promise<Eta[]> {
  const { operator, stopId } = parseStopId(id)
  const index = await getStaticIndex()
  const refs = index.stopToRoutes.get(id) ?? []
  const etas = (await fetchStopEtas(operator, stopId, refs)).filter((e) => e.arrivals.length > 0)
  if (!routeIds?.length) return etas
  const wanted = new Set(routeIds)
  return etas.filter((e) => wanted.has(e.routeId))
}

/** GET /v1/route/:id — a route and its ordered stop list (static). */
export async function routeDetail(id: string): Promise<RouteDetail> {
  const index = await getStaticIndex()
  const meta = index.routeMeta.get(id)
  const seqStops = index.routeToStops.get(id) ?? []
  if (!meta || seqStops.length === 0) throw new Error(`unknown route: ${id}`)

  const stops: RouteDetail['stops'] = []
  for (const rs of seqStops) {
    const rec = index.stopById.get(rs.stopId)
    if (rec) stops.push({ seq: rs.seq, stop: toStop(rec) })
  }
  return { route: toRoute(meta, index), stops }
}
