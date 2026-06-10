import type { RouteLite, SearchIndex, StopLite } from '@nextbus/core'
import { canonicalRouteId, type StaticIndex } from '@nextbus/data-normalize'
import { getStaticIndex } from './static-index'

// Build the compact on-device search index from the shared memoized static index
// (ADR-037). Routes are collapsed to one record per (operator, number, direction) —
// riders search by number, not service-type variant — and stops are pre-merged so a
// same-kerb KMB+CTB place appears once. Memoized like the static index: one build per
// isolate, then served from the edge cache.

/** Prefer service type "1" as the representative variant, else the lowest. */
function preferServiceType(a: string, b: string): string {
  if (a === '1') return a
  if (b === '1') return b
  return a.localeCompare(b, 'en', { numeric: true }) <= 0 ? a : b
}

export function buildSearchIndex(index: StaticIndex): SearchIndex {
  // Collapse directional/service-type variants to one route per (operator, no, bound).
  const byNumber = new Map<string, RouteLite>()
  for (const meta of index.routeMeta.values()) {
    const key = `${meta.operator}:${meta.route}:${meta.bound}`
    const existing = byNumber.get(key)
    if (existing) {
      // Keep the representative service type; the id encodes it.
      const existingSt = existing.id.split(':')[3] ?? '1'
      if (preferServiceType(meta.serviceType, existingSt) === existingSt) continue
    }
    byNumber.set(key, {
      id: canonicalRouteId(meta.operator, meta.route, meta.bound, meta.serviceType),
      operator: meta.operator,
      routeNo: meta.route,
      bound: meta.bound,
      origin: meta.origin,
      destination: meta.destination,
    })
  }
  const routes = [...byNumber.values()]

  // Stops: each same-kerb place once (by its self-describing P: id), plus every
  // stop that isn't part of a place. Both id shapes resolve in /v1/stop/:id.
  const stops: StopLite[] = index.places.map((p) => ({
    id: p.id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
  }))
  for (const s of index.stops) {
    if (index.placeByStopId.has(s.id)) continue
    stops.push({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })
  }

  // Coarse content tag: counts move whenever the dataset gains/loses routes or stops.
  // Good enough for cache-busting the client blob; a true content hash is a follow-up.
  const version = `${routes.length}.${stops.length}`
  return { version, routes, stops }
}

let searchIndexPromise: Promise<SearchIndex> | null = null

/** Memoized compact search index for the isolate's lifetime (built off the static index). */
export function getSearchIndex(): Promise<SearchIndex> {
  if (!searchIndexPromise) {
    searchIndexPromise = getStaticIndex()
      .then(buildSearchIndex)
      .catch((err) => {
        searchIndexPromise = null
        throw err
      })
  }
  return searchIndexPromise
}
