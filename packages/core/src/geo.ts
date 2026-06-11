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

/** Average pedestrian pace, metres per minute (~4.8 km/h). */
const WALK_M_PER_MIN = 80

/** Estimated walking minutes for a straight-line distance. Floor of 1 min. */
export function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.round(distanceM / WALK_M_PER_MIN))
}

/** Human distance: rounded metres under 1 km, else one-decimal km. Unit symbols
 *  (`m` / `km`) are locale-neutral, so this needs no locale. */
export function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM / 10) * 10} m`
  return `${(distanceM / 1000).toFixed(1)} km`
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
