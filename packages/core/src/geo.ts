import type { LatLng, Locale } from './types'

// Distance / walk-time formatting for nearby stops. Straight-line distance is an
// approximation, so we never show fake precision (ADR-008 honesty applied to
// geography): metres are rounded to the nearest 10, and walk time to a whole minute.

/** Mean Earth radius, metres (WGS84 authalic). */
const EARTH_R = 6_371_008.8

/** Great-circle (haversine) distance between two WGS84 points, in metres. A
 *  straight-line approximation — never presented with fake precision (ADR-008). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLng = (b.lng - a.lng) * toRad
  const lat1 = a.lat * toRad
  const lat2 = b.lat * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Total straight-line length of a path through ordered points — the sum of great-circle hops
 *  between consecutive points. Used as an APPROXIMATE bus-route distance from its stop
 *  coordinates: HK open data carries no route polylines, so this under-counts the real road
 *  distance (a bus follows curving roads, not straight hops) and is only ever shown as an
 *  explicit estimate (ADR-008 / ADR-044). Returns 0 for fewer than two points. */
export function routeDistanceM(points: LatLng[]): number {
  let total = 0
  let prev: LatLng | undefined
  for (const p of points) {
    if (prev) total += haversineMeters(prev, p)
    prev = p
  }
  return total
}

/** Average pedestrian pace, metres per minute (~4.8 km/h). */
const WALK_M_PER_MIN = 80

/** Estimated walking minutes for a straight-line distance. Floor of 1 min. */
export function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.round(distanceM / WALK_M_PER_MIN))
}

/** Human distance: rounded metres under 1 km, else one-decimal km. Unit symbols
 *  (`m` / `km`) are locale-neutral, so this needs no locale. No space before the unit
 *  ("200m", "1.2km") — reads tighter for a glanceable distance label. */
export function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM / 10) * 10}m`
  return `${(distanceM / 1000).toFixed(1)}km`
}

const WALK_LABEL: Record<Locale, string> = {
  en: 'min walk',
  'zh-Hant': '分鐘路程',
  'zh-Hans': '分钟路程',
}

/** Localized walk estimate, e.g. "2 min walk" / "2 分鐘路程". */
export function formatWalk(distanceM: number, locale: Locale): string {
  return `${walkMinutes(distanceM)} ${WALK_LABEL[locale]}`
}

/** 8-point compass labels (N, NE, E, … NW) as localized "-bound" directions. The cue that
 *  tells two same-named places apart — the NE vs SW kerb of one landmark (ADR-042). */
const COMPASS_LABELS: Record<Locale, readonly string[]> = {
  en: [
    'Northbound',
    'Northeast-bound',
    'Eastbound',
    'Southeast-bound',
    'Southbound',
    'Southwest-bound',
    'Westbound',
    'Northwest-bound',
  ],
  'zh-Hant': ['北行', '東北行', '東行', '東南行', '南行', '西南行', '西行', '西北行'],
  'zh-Hans': ['北行', '东北行', '东行', '东南行', '南行', '西南行', '西行', '西北行'],
}

/** Localized 8-point compass direction for a travel bearing (deg, any range), e.g.
 *  "Northeast-bound" / "東北行". Snaps to the nearest octant. */
export function formatBearing(deg: number, locale: Locale): string {
  const octant = Math.round((((deg % 360) + 360) % 360) / 45) % 8
  const labels = COMPASS_LABELS[locale] ?? COMPASS_LABELS.en
  return labels[octant] ?? ''
}

/** Localized walk estimate across a *range* of distances (a multi-pole place — ADR-042):
 *  "4–6 min walk" when the poles differ in walking minutes, else a single "4 min walk"
 *  (never "4–4"). Order-independent. */
export function formatWalkRange(
  minDistanceM: number,
  maxDistanceM: number,
  locale: Locale,
): string {
  const lo = walkMinutes(Math.min(minDistanceM, maxDistanceM))
  const hi = walkMinutes(Math.max(minDistanceM, maxDistanceM))
  return lo === hi ? `${lo} ${WALK_LABEL[locale]}` : `${lo}–${hi} ${WALK_LABEL[locale]}`
}
