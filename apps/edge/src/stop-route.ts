import type { Eta, I18nText, Route, RouteDetail, Stop, StopDetail } from '@nextbus/core'
import {
  canonicalRouteId,
  fetchKmbEta,
  type KmbRouteMeta,
  type KmbRouteRef,
  type KmbStop,
  routeKey,
} from '@nextbus/data-normalize'
import { getKmbIndex } from './kmb-index'

// Cap the per-stop ETA fan-out so a cold stop request stays cheap (edge-cached).
// Routes beyond the cap are still listed (static), just without a live ETA.
const MAX_ETA_ROUTES = 24

const EMPTY_TEXT: I18nText = { en: '', 'zh-Hant': '', 'zh-Hans': '' }

function toStop(s: KmbStop): Stop {
  return {
    id: `KMB:${s.stopId}`,
    name: s.name,
    location: { lat: s.lat, lng: s.lng },
    sources: [{ operator: 'KMB', operatorStopId: s.stopId }],
  }
}

function toRoute(ref: KmbRouteRef, meta: KmbRouteMeta | undefined): Route {
  return {
    id: canonicalRouteId('KMB', ref.route, ref.bound, ref.serviceType),
    operator: 'KMB',
    routeNo: ref.route,
    bound: ref.bound,
    serviceType: ref.serviceType,
    origin: meta?.origin ?? EMPTY_TEXT,
    destination: meta?.destination ?? EMPTY_TEXT,
  }
}

/** Parse a canonical stop id (`KMB:<stopId>`); only KMB is supported in v1. */
function parseStopId(id: string): string {
  const [operator, ...rest] = id.split(':')
  if (operator !== 'KMB' || rest.length === 0) {
    throw new Error(`unsupported stop id: ${id} (KMB only in v1)`)
  }
  return rest.join(':')
}

/** Parse a canonical route id (`KMB:<routeNo>:<bound>:<serviceType>`). */
function parseRouteId(id: string): KmbRouteRef {
  const [operator, route, bound, serviceType, ...extra] = id.split(':')
  if (operator !== 'KMB' || !route || !serviceType || extra.length > 0) {
    throw new Error(`unsupported route id: ${id} (expected KMB:<no>:<bound>:<serviceType>)`)
  }
  if (bound !== 'inbound' && bound !== 'outbound') throw new Error(`bad bound: ${bound}`)
  return { route, bound, serviceType }
}

/** Fetch live ETAs for a set of route refs at one operator-native stop, deduping
 *  upstream calls by (route, serviceType) — the KMB feed returns both bounds at once. */
async function fetchStopEtas(stopId: string, refs: KmbRouteRef[]): Promise<Eta[]> {
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
    pairs.map((p) => fetchKmbEta(stopId, p.route, p.serviceType).catch(() => [] as Eta[])),
  )
  return lists.flat()
}

/** GET /v1/stop/:id — a stop and every route serving it, each with its next ETA. */
export async function stopDetailKmb(id: string): Promise<StopDetail> {
  const stopId = parseStopId(id)
  const index = await getKmbIndex()
  const rec = index.stopById.get(stopId)
  if (!rec) throw new Error(`unknown stop: ${id}`)

  const refs = index.stopToRoutes.get(stopId) ?? []
  const etas = await fetchStopEtas(stopId, refs)
  const etaByRouteId = new Map<string, Eta>()
  for (const e of etas) if (e.arrivals.length > 0) etaByRouteId.set(e.routeId, e)

  const routes = refs.map((ref) => {
    const route = toRoute(ref, index.routeMeta.get(routeKey(ref.route, ref.bound, ref.serviceType)))
    return { route, eta: etaByRouteId.get(route.id) ?? null }
  })
  return { stop: toStop(rec), routes }
}

/** GET /v1/etas/:id — flat ETA list for a stop (optionally filtered to routes). */
export async function stopEtasKmb(id: string, routeIds?: string[]): Promise<Eta[]> {
  const stopId = parseStopId(id)
  const index = await getKmbIndex()
  const refs = index.stopToRoutes.get(stopId) ?? []
  const etas = (await fetchStopEtas(stopId, refs)).filter((e) => e.arrivals.length > 0)
  if (!routeIds?.length) return etas
  const wanted = new Set(routeIds)
  return etas.filter((e) => wanted.has(e.routeId))
}

/** GET /v1/route/:id — a route and its ordered stop list (static). */
export async function routeDetailKmb(id: string): Promise<RouteDetail> {
  const ref = parseRouteId(id)
  const index = await getKmbIndex()
  const key = routeKey(ref.route, ref.bound, ref.serviceType)
  const seqStops = index.routeToStops.get(key) ?? []
  if (seqStops.length === 0) throw new Error(`unknown route: ${id}`)

  const stops: RouteDetail['stops'] = []
  for (const rs of seqStops) {
    const rec = index.stopById.get(rs.stopId)
    if (rec) stops.push({ seq: rs.seq, stop: toStop(rec) })
  }
  return { route: toRoute(ref, index.routeMeta.get(key)), stops }
}
