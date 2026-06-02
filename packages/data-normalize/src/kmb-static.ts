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

export interface KmbStaticIndex {
  stops: KmbStop[]
  /** stopId → the routes that serve it. */
  stopToRoutes: Map<string, KmbRouteRef[]>
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
  stop: string
}

export async function fetchKmbStatic(fetchImpl: typeof fetch = fetch): Promise<KmbStaticIndex> {
  const [stopRes, rsRes] = await Promise.all([
    fetchImpl(`${KMB_BASE}/stop`),
    fetchImpl(`${KMB_BASE}/route-stop`),
  ])
  if (!stopRes.ok) throw new Error(`KMB stop list ${stopRes.status}`)
  if (!rsRes.ok) throw new Error(`KMB route-stop list ${rsRes.status}`)

  const stopJson = (await stopRes.json()) as { data: RawStop[] }
  const rsJson = (await rsRes.json()) as { data: RawRouteStop[] }

  const stops: KmbStop[] = []
  for (const s of stopJson.data) {
    const lat = Number(s.lat)
    const lng = Number(s.long)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    stops.push({ stopId: s.stop, name: i18nText(s.name_en, s.name_tc, s.name_sc), lat, lng })
  }

  const stopToRoutes = new Map<string, KmbRouteRef[]>()
  for (const rs of rsJson.data) {
    const ref: KmbRouteRef = {
      route: rs.route,
      bound: toBound(rs.bound),
      serviceType: String(rs.service_type),
    }
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
  }

  return { stops, stopToRoutes }
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
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
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
