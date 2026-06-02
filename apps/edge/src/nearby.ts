import type { Eta, NearbyStop, Stop } from '@nextbus/core'
import {
  fetchKmbEta,
  fetchKmbStatic,
  findNearbyKmb,
  type KmbStaticIndex,
} from '@nextbus/data-normalize'

// Slice-1 bounds so a cold nearby request stays cheap (≤ MAX_STOPS × MAX_ROUTES
// upstream ETA calls, all edge-cached). The v2 push engine + on-device index
// (ADR-004 / ADR-007) replace this fan-out later.
const MAX_STOPS = 6
const MAX_ROUTES_PER_STOP = 6

// Memoize the KMB static index for the isolate's lifetime. Production swaps this
// for the daily-crawl output served from KV/R2 (docs/03 "daily crawl").
let indexPromise: Promise<KmbStaticIndex> | null = null
function getKmbIndex(): Promise<KmbStaticIndex> {
  if (!indexPromise) indexPromise = fetchKmbStatic()
  return indexPromise
}

export async function nearbyKmb(lat: number, lng: number, radiusM: number): Promise<NearbyStop[]> {
  const index = await getKmbIndex()
  const hits = findNearbyKmb(index, lat, lng, radiusM, MAX_STOPS)

  return Promise.all(
    hits.map(async (hit): Promise<NearbyStop> => {
      const routes = hit.routes.slice(0, MAX_ROUTES_PER_STOP)
      const etaLists = await Promise.all(
        routes.map((r) =>
          fetchKmbEta(hit.stop.stopId, r.route, r.serviceType).catch(() => [] as Eta[]),
        ),
      )
      const etas = etaLists
        .flat()
        .filter((e) => e.arrivals.length > 0)
        .sort((a, b) => (a.arrivals[0] ?? '').localeCompare(b.arrivals[0] ?? ''))

      const stop: Stop = {
        id: `KMB:${hit.stop.stopId}`,
        name: hit.stop.name,
        location: { lat: hit.stop.lat, lng: hit.stop.lng },
        sources: [{ operator: 'KMB', operatorStopId: hit.stop.stopId }],
      }
      return { stop, distanceM: hit.distanceM, etas }
    }),
  )
}
