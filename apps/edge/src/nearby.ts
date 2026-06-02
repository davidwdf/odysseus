import type { NearbyStop } from '@nextbus/core'
import { findNearby, type IndexStop } from '@nextbus/data-normalize'
import { getStaticIndex } from './static-index'
import { stopArrivals, toMergedStop } from './stop-route'

// Slice-1 bounds so a cold nearby request stays cheap (≤ MAX_STOPS × MAX_ROUTES
// upstream ETA calls, all edge-cached). The v2 push engine + on-device index
// (ADR-004 / ADR-007) replace this fan-out later.
const MAX_STOPS = 6
const MAX_ROUTES_PER_STOP = 6

export async function nearby(lat: number, lng: number, radiusM: number): Promise<NearbyStop[]> {
  const index = await getStaticIndex()
  // Pull extra hits so a merged same-kerb pair doesn't cost us a result slot.
  const hits = findNearby(index, lat, lng, radiusM, MAX_STOPS * 2)

  // Collapse hits sharing a same-kerb place into one merged entry. Hits are
  // distance-ordered, so the first occurrence (the closer member) represents the place.
  type Group = { id: string; rep: IndexStop; members: IndexStop[]; distanceM: number }
  const groups: Group[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const place = index.placeByStopId.get(hit.stop.id)
    const key = place?.id ?? hit.stop.id
    if (seen.has(key)) continue
    seen.add(key)
    groups.push({
      id: key,
      rep: hit.stop,
      members: place ? place.members : [hit.stop],
      distanceM: hit.distanceM,
    })
    if (groups.length >= MAX_STOPS) break
  }

  return Promise.all(
    groups.map(async (g): Promise<NearbyStop> => {
      // Canonical, de-duplicated arrivals via the shared server seam.
      const etas = await stopArrivals(index, g.members, MAX_ROUTES_PER_STOP)
      return { stop: toMergedStop(g.id, g.members, g.rep), distanceM: g.distanceM, etas }
    }),
  )
}
