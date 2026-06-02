import type { Bound, I18nText } from '@nextbus/core'
import { i18nText, toBound } from './normalize'

// KMB exposes the full static dataset via three bulk endpoints, so building a
// stop index + stop→routes map is a cheap, finite crawl (no per-route fan-out).
// The small per-request ETA responses are zod-validated (see kmb.ts); these bulk
// payloads are large (~100k+ rows) so we parse them lightly for performance.
const KMB_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb'

export interface KmbStop {
  stopId: string
  name: I18nText
  lat: number
  lng: number
}

export interface KmbRouteRef {
  route: string
  bound: Bound
  serviceType: string
}

/** Static route metadata: the directional origin → destination for a route variant. */
export interface KmbRouteMeta extends KmbRouteRef {
  origin: I18nText
  destination: I18nText
}

/** A stop's position along a route. */
export interface KmbRouteStop {
  seq: number
  stopId: string
}

export interface KmbStaticIndex {
  stops: KmbStop[]
  /** stopId → the stop record (O(1) lookup for stop-detail). */
  stopById: Map<string, KmbStop>
  /** stopId → the routes that serve it. */
  stopToRoutes: Map<string, KmbRouteRef[]>
  /** routeKey → directional origin/destination (from the bulk `route` endpoint). */
  routeMeta: Map<string, KmbRouteMeta>
  /** routeKey → ordered stop list along the route. */
  routeToStops: Map<string, KmbRouteStop[]>
}

/** Stable key for a route variant (route number + direction + service type). */
export function routeKey(route: string, bound: Bound, serviceType: string): string {
  return `${route}|${bound}|${serviceType}`
}

interface RawStop {
  stop: string
  name_en: string
  name_tc: string
  name_sc: string
  lat: string
  long: string
}
interface RawRouteStop {
  route: string
  bound: string
  service_type: number | string
  seq: number | string
  stop: string
}
interface RawRoute {
  route: string
  bound: string
  service_type: number | string
  orig_en: string
  orig_tc: string
  orig_sc: string
  dest_en: string
  dest_tc: string
  dest_sc: string
}

/** Fetch + parse a KMB bulk endpoint, retrying transient throttling. Bursting the
 *  three bulk endpoints concurrently can trip a 403/429 on one of them; a short
 *  backoff retry clears it once the burst subsides. */
async function fetchKmbJson<T>(url: string, fetchImpl: typeof fetch, label: string): Promise<T> {
  const delaysMs = [0, 300, 800]
  let lastStatus = 0
  for (const delay of delaysMs) {
    if (delay) await new Promise((r) => setTimeout(r, delay))
    const res = await fetchImpl(url)
    if (res.ok) return (await res.json()) as T
    lastStatus = res.status
    // Only retry throttling / server errors; a 4xx like 404 won't fix itself.
    if (lastStatus !== 403 && lastStatus !== 429 && lastStatus < 500) break
  }
  throw new Error(`KMB ${label} ${lastStatus}`)
}

export async function fetchKmbStatic(fetchImpl: typeof fetch = fetch): Promise<KmbStaticIndex> {
  // Three bulk endpoints: stop list, route-stop (sequences), route (origin/dest).
  // etabus throttles 3 concurrent connections from one client (403s the odd one out),
  // but tolerates 2. So fetch the small `route` list solo first, then the larger
  // `stop` + `route-stop` pair together (the Slice-1 combination known to be fine).
  const routeJson = await fetchKmbJson<{ data: RawRoute[] }>(
    `${KMB_BASE}/route`,
    fetchImpl,
    'route list',
  )
  const [stopJson, rsJson] = await Promise.all([
    fetchKmbJson<{ data: RawStop[] }>(`${KMB_BASE}/stop`, fetchImpl, 'stop list'),
    fetchKmbJson<{ data: RawRouteStop[] }>(`${KMB_BASE}/route-stop`, fetchImpl, 'route-stop list'),
  ])

  const stops: KmbStop[] = []
  const stopById = new Map<string, KmbStop>()
  for (const s of stopJson.data) {
    const lat = Number(s.lat)
    const lng = Number(s.long)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const stop: KmbStop = {
      stopId: s.stop,
      name: i18nText(s.name_en, s.name_tc, s.name_sc),
      lat,
      lng,
    }
    stops.push(stop)
    stopById.set(stop.stopId, stop)
  }

  const routeMeta = new Map<string, KmbRouteMeta>()
  for (const r of routeJson.data) {
    const bound = toBound(r.bound)
    const serviceType = String(r.service_type)
    routeMeta.set(routeKey(r.route, bound, serviceType), {
      route: r.route,
      bound,
      serviceType,
      origin: i18nText(r.orig_en, r.orig_tc, r.orig_sc),
      destination: i18nText(r.dest_en, r.dest_tc, r.dest_sc),
    })
  }

  const stopToRoutes = new Map<string, KmbRouteRef[]>()
  const routeToStops = new Map<string, KmbRouteStop[]>()
  for (const rs of rsJson.data) {
    const bound = toBound(rs.bound)
    const serviceType = String(rs.service_type)
    const ref: KmbRouteRef = { route: rs.route, bound, serviceType }

    const list = stopToRoutes.get(rs.stop)
    if (!list) {
      stopToRoutes.set(rs.stop, [ref])
    } else if (
      !list.some(
        (r) => r.route === ref.route && r.bound === ref.bound && r.serviceType === ref.serviceType,
      )
    ) {
      list.push(ref)
    }

    const key = routeKey(rs.route, bound, serviceType)
    const seqList = routeToStops.get(key)
    const entry: KmbRouteStop = { seq: Number(rs.seq), stopId: rs.stop }
    if (seqList) seqList.push(entry)
    else routeToStops.set(key, [entry])
  }
  for (const seqList of routeToStops.values()) seqList.sort((a, b) => a.seq - b.seq)

  return { stops, stopById, stopToRoutes, routeMeta, routeToStops }
}

export interface KmbNearbyHit {
  stop: KmbStop
  distanceM: number
  routes: KmbRouteRef[]
}

const EARTH_M = 6_371_000

/** Great-circle distance in metres. */
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.sqrt(h))
}

/** Nearest stops within `radiusM`, closest first, capped at `limit`. */
export function findNearbyKmb(
  index: KmbStaticIndex,
  lat: number,
  lng: number,
  radiusM: number,
  limit: number,
): KmbNearbyHit[] {
  const hits: KmbNearbyHit[] = []
  for (const stop of index.stops) {
    const distanceM = haversineM(lat, lng, stop.lat, stop.lng)
    if (distanceM <= radiusM) {
      hits.push({
        stop,
        distanceM: Math.round(distanceM),
        routes: index.stopToRoutes.get(stop.stopId) ?? [],
      })
    }
  }
  hits.sort((a, b) => a.distanceM - b.distanceM)
  return hits.slice(0, limit)
}
