import type { Eta, Locale } from './types'

/** Readings older than this are shown as stale (data quality, not a hard error). */
export const ETA_STALE_AFTER_MS = 90_000
/** Under a minute → "Arriving"/"Due" rather than a fabricated "0:59…". */
export const ETA_DUE_UNDER_SEC = 60

export interface EtaView {
  /** Whole minutes until arrival, floored. Negative means departed. */
  minutes: number
  /** Signed seconds until arrival. */
  seconds: number
  /** Arrival is imminent (< ETA_DUE_UNDER_SEC away). */
  isDue: boolean
  /** Arrival time is in the past. */
  hasDeparted: boolean
}

/**
 * View of a single arrival relative to `now`.
 *
 * IMPORTANT: derived from the upstream timestamp on demand — NOT a client-side
 * countdown. We recompute when fresh data arrives and never tick a fake decrement
 * (see ADR-008). `now` is passed in so this stays a pure function.
 */
export function etaView(arrivalIso: string, now: number): EtaView {
  const seconds = Math.round((new Date(arrivalIso).getTime() - now) / 1000)
  return {
    seconds,
    minutes: Math.floor(seconds / 60),
    isDue: seconds < ETA_DUE_UNDER_SEC && seconds >= -ETA_DUE_UNDER_SEC,
    hasDeparted: seconds < -ETA_DUE_UNDER_SEC,
  }
}

/** Whether an ETA reading should be treated as stale. */
export function isStale(eta: Eta, now: number): boolean {
  return now - new Date(eta.dataTimestamp).getTime() > ETA_STALE_AFTER_MS
}

const DUE_LABEL: Record<Locale, string> = {
  en: 'Arriving',
  'zh-Hant': '即將抵達',
  'zh-Hans': '即将抵达',
}
const MIN_LABEL: Record<Locale, string> = {
  en: 'min',
  'zh-Hant': '分鐘',
  'zh-Hans': '分钟',
}

/**
 * Honest relative label: "Arriving" under a minute, otherwise "N min". Never
 * fabricates sub-minute precision; never shows a number for a departed bus.
 */
export function formatRelative(arrivalIso: string, now: number, locale: Locale): string {
  const { isDue, minutes, hasDeparted } = etaView(arrivalIso, now)
  if (hasDeparted) return '—'
  if (isDue) return DUE_LABEL[locale]
  return `${Math.max(minutes, 1)} ${MIN_LABEL[locale]}`
}

/** Absolute clock time (HH:mm, 24h) — preferred for longer waits. */
export function formatClock(arrivalIso: string, locale: Locale): string {
  return new Date(arrivalIso).toLocaleTimeString(localeTag(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function localeTag(locale: Locale): string {
  if (locale === 'en') return 'en-HK'
  if (locale === 'zh-Hant') return 'zh-Hant-HK'
  return 'zh-Hans-CN'
}

/**
 * Collapse rider-duplicate ETAs to one entry per line, keeping the soonest reading.
 *
 * A stop is indexed per direction (and per operator service-type), but the upstream
 * KMB feed returns *every* direction of a route in one response — so fetching a
 * stop's routes can surface the same arrival more than once (identical times), and
 * service-type variants show the same line twice. A rider thinks "route + direction",
 * so we key by operator + route number + bound. Pure function; arrivals are ISO-8601
 * with a fixed +08:00 offset, so lexical comparison is chronological.
 */
export function dedupeEtas(etas: Eta[]): Eta[] {
  const byLine = new Map<string, Eta>()
  for (const eta of etas) {
    const [, routeNo = '', bound = ''] = eta.routeId.split(':')
    const key = `${eta.operator}|${routeNo}|${bound}`
    const existing = byLine.get(key)
    if (!existing) {
      byLine.set(key, eta)
      continue
    }
    const a = existing.arrivals[0] ?? ''
    const b = eta.arrivals[0] ?? ''
    if (b && (!a || b < a)) byLine.set(key, eta) // keep the sooner first arrival
  }
  return [...byLine.values()]
}
