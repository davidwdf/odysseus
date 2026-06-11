import type { NearbyStop } from '@nextbus/core'
import { findNearby, type IndexStop } from '@nextbus/data-normalize'
import { getStaticIndex } from './static-index'
import { placeRouteCount, stopArrivals, toMergedStop } from './stop-route'

// Slice-1 bounds so a cold nearby request stays cheap (all edge-cached). KMB poles cost one
// `stop-eta` call each regardless of route count (ADR-042), so the fan-out is dominated by
// CTB; `NEARBY_CTB_BUDGET` caps CTB per place. The v2 push engine + on-device index
// (ADR-004 / ADR-007) replace this fan-out later.
const MAX_STOPS = 6
const NEARBY_CTB_BUDGET = 12

export async function nearby(lat: number, lng: number, radiusM: number): Promise<NearbyStop[]> {
  const index = await getStaticIndex()
  // Pull extra hits so a merged same-kerb pair doesn't cost us a result slot.
  const hits = findNearby(index, lat, lng, radiusM, MAX_STOPS * 2)

  // Collapse hits sharing a same-kerb place into one merged entry. Hits are distance-ordered,
  // so the first occurrence (the closer member) gives the place its distance; the name/anchor
  // come from the place itself (chosen once in buildPlaces) so it reads the same everywhere.
  type Group = {
    id: string
    name: IndexStop['name']
    location: { lat: number; lng: number }
    members: IndexStop[]
    distanceM: number
  }
  const groups: Group[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const place = index.placeByStopId.get(hit.stop.id)
    const key = place?.id ?? hit.stop.id
    if (seen.has(key)) continue
    seen.add(key)
    groups.push({
      id: key,
      name: place?.name ?? hit.stop.name,
      location: place
        ? { lat: place.lat, lng: place.lng }
        : { lat: hit.stop.lat, lng: hit.stop.lng },
      members: place ? place.members : [hit.stop],
      distanceM: hit.distanceM,
    })
    if (groups.length >= MAX_STOPS) break
  }

  return Promise.all(
    groups.map(async (g): Promise<NearbyStop> => {
      // Canonical, de-duplicated arrivals via the shared server seam. We fetch ALL routes at
      // the place (KMB cheap, CTB to budget) so the soonest are genuinely soonest; the card
      // shows the true `routeCount` (free, static) + "+N more" rather than a silent filter.
      const etas = await stopArrivals(index, g.members, NEARBY_CTB_BUDGET)
      return {
        stop: toMergedStop(g.id, g.members, g.name, g.location),
        distanceM: g.distanceM,
        etas,
        routeCount: placeRouteCount(index, g.members),
      }
    }),
  )
}
