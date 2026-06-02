import type { Eta, NearbyStop, Stop } from '@nextbus/core'
import { fetchEta, findNearby } from '@nextbus/data-normalize'
import { getStaticIndex } from './static-index'

// Slice-1 bounds so a cold nearby request stays cheap (≤ MAX_STOPS × MAX_ROUTES
// upstream ETA calls, all edge-cached). The v2 push engine + on-device index
// (ADR-004 / ADR-007) replace this fan-out later.
const MAX_STOPS = 6
const MAX_ROUTES_PER_STOP = 6

export async function nearby(lat: number, lng: number, radiusM: number): Promise<NearbyStop[]> {
  const index = await getStaticIndex()
  const hits = findNearby(index, lat, lng, radiusM, MAX_STOPS)

  return Promise.all(
    hits.map(async (hit): Promise<NearbyStop> => {
      const routes = hit.routes.slice(0, MAX_ROUTES_PER_STOP)
      const etaLists = await Promise.all(
        routes.map((r) =>
          // Dispatch by operator: KMB takes a service type, CTB does not.
          fetchEta(r.operator, hit.stop.stopId, r.route, r.serviceType).catch(() => [] as Eta[]),
        ),
      )
      const etas = etaLists
        .flat()
        .filter((e) => e.arrivals.length > 0)
        .sort((a, b) => (a.arrivals[0] ?? '').localeCompare(b.arrivals[0] ?? ''))

      const stop: Stop = {
        id: hit.stop.id,
        name: hit.stop.name,
        location: { lat: hit.stop.lat, lng: hit.stop.lng },
        sources: [{ operator: hit.stop.operator, operatorStopId: hit.stop.stopId }],
      }
      return { stop, distanceM: hit.distanceM, etas }
    }),
  )
}
