import type { Locale } from './types'

// Distance / walk-time formatting for nearby stops. Straight-line distance is an
// approximation, so we never show fake precision (ADR-008 honesty applied to
// geography): metres are rounded to the nearest 10, and walk time to a whole minute.

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
