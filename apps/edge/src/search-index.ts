import {
  parseRouteId,
  type RouteLite,
  routeSortKey,
  type SearchIndex,
  type StopLite,
} from '@nextbus/core'
import { canonicalRouteId, type StaticIndex } from '@nextbus/data-normalize'

// Build the compact on-device search index (ADR-037). Routes are collapsed to one record per
// (operator, number, direction) — riders search by number, not service-type variant — and stops
// are pre-merged so a same-kerb KMB+CTB place appears once.
//
// Pure: a function of a `StaticIndex`, nothing more. Since WP0-1 the production copy is built
// **once by the daily job** and stored as an R2 object (`builds/<hash>/search-index.json`); the
// Worker streams that object rather than deriving it. This function is still what produces it,
// and it's what the dev fallback calls, so there is one definition of the index either way.

/** Prefer service type "1" as the representative variant, else the lowest. */
function preferServiceType(a: string, b: string): string {
  if (a === '1') return a
  if (b === '1') return b
  return a.localeCompare(b, 'en', { numeric: true }) <= 0 ? a : b
}

/**
 * SHA-256 of the payload, first 16 hex — the **same digest recipe** `scripts/build-dataset.mts`
 * uses for the build hash. Deliberately not a cheaper non-cryptographic hash: a second hashing
 * scheme in one system is a thing to keep in step for no benefit, and this runs once per build.
 * `crypto.subtle` rather than `node:crypto` because this function has two runtimes — the node
 * build script and the Worker's inline fallback — and only one of them has node's.
 */
async function contentHash(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

export async function buildSearchIndex(index: StaticIndex): Promise<SearchIndex> {
  // Collapse directional/service-type variants to one route per (operator, no, bound).
  // GMB needs a different key: its public numbers repeat across regions (route "1" exists in
  // HKI *and* NT — genuinely different routes we must keep separate), yet within a region a
  // number can have several route_ids that are just variants ("Normal"/"Special" departures of
  // one route). Region isn't in the dataset, so we key GMB on **number + direction + origin +
  // destination** — the rider-facing identity: cross-region routes differ in from/to and stay
  // split; same-route variants share from/to and collapse. The representative is the fullest
  // variant (most stops), tie-broken by id. A true region/area tag is a follow-up. ADR-047.
  const byNumber = new Map<string, RouteLite>()
  for (const meta of index.routeMeta.values()) {
    const id = canonicalRouteId(meta.operator, meta.route, meta.bound, meta.serviceType)
    const key =
      meta.operator === 'GMB'
        ? `${meta.operator}:${meta.route}:${meta.bound}:${meta.origin.en}:${meta.destination.en}`
        : `${meta.operator}:${meta.route}:${meta.bound}`
    const existing = byNumber.get(key)
    if (existing) {
      if (meta.operator === 'GMB') {
        // Prefer the fuller routing (most stops); tie → lower id. Deterministic.
        const curN = index.routeToStops.get(existing.id)?.length ?? 0
        const newN = index.routeToStops.get(id)?.length ?? 0
        if (newN < curN || (newN === curN && id >= existing.id)) continue
      } else {
        // Keep the representative service type; the id encodes it. Default to "1" when the id
        // cannot be read, which is what `preferServiceType` treats as the representative anyway.
        const existingSt = parseRouteId(existing.id)?.serviceType ?? '1'
        if (preferServiceType(meta.serviceType, existingSt) === existingSt) continue
      }
    }
    byNumber.set(key, {
      id,
      operator: meta.operator,
      routeNo: meta.route,
      bound: meta.bound,
      origin: meta.origin,
      destination: meta.destination,
      // Precomputed here so the *display order* is data the client reads rather than a collator
      // call it makes — the one thing three platforms could not be relied on to agree about
      // (ADR-063). `routeSortKey` is the definition; the client can still derive it.
      sortKey: routeSortKey(meta.route),
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

  // The version is a **content hash of what we are about to ship**, not a pair of collection
  // sizes. The size pair collided the moment a build added one route and dropped another — or one
  // stop and one place — which is the ordinary shape of a daily dataset diff, and the collision
  // is silent: the client compares two identical strings and keeps an index that no longer
  // describes the network. It also moved for changes riders never see. This moves exactly when
  // the bytes move, and doubles as the endpoint's ETag (ADR-063).
  //
  // Deliberately *not* the dataset build hash, which is available a few lines up the call stack:
  // that hash digests every shard, so a fare change on one route would re-download the whole
  // index for content identical to what the client already holds.
  const version = await contentHash(JSON.stringify({ routes, stops }))
  return { version, routes, stops }
}
