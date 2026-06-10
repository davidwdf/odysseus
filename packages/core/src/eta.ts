import type { Eta, I18nText, Locale } from './types'

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

// Short "imminent" label — under a minute we don't fake a number (ADR-008). "Due" is the
// conventional countdown-board term and stays brief, so the swap to the first numeric slot
// barely shifts width.
const DUE_LABEL: Record<Locale, string> = {
  en: 'Due',
  'zh-Hant': '即將',
  'zh-Hans': '即将',
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

/**
 * Structured parts for a compact ETA badge: the minutes value and its unit kept separate, so a
 * caller can render the number prominent and the unit small + pinned — only the number moves as
 * the value changes, minimising width-jump — with a short status word under a minute. Honest:
 * no sub-minute number (ADR-008).
 */
export type EtaLabelParts =
  | { kind: 'departed' }
  | { kind: 'due'; label: string }
  | { kind: 'mins'; value: number; unit: string }
export function etaLabelParts(arrivalIso: string, now: number, locale: Locale): EtaLabelParts {
  const { isDue, minutes, hasDeparted } = etaView(arrivalIso, now)
  if (hasDeparted) return { kind: 'departed' }
  if (isDue) return { kind: 'due', label: DUE_LABEL[locale] }
  return { kind: 'mins', value: Math.max(minutes, 1), unit: MIN_LABEL[locale] }
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

// --- Static service-fact formatting (fares / frequency / journey time) -------------------
// These mirror formatRelative's pattern (transit-data formatting lives in core, not i18n):
// the locale only selects a unit word. The values are the **Static** honesty tier — derived
// from the route-fare dataset, shown plainly, never animated or styled as live.

const EVERY_LABEL: Record<Locale, string> = { en: 'every', 'zh-Hant': '每', 'zh-Hans': '每' }
const ABOUT_LABEL: Record<Locale, string> = { en: '~', 'zh-Hant': '約', 'zh-Hans': '约' }

/** HK$ fare for display, e.g. "6.7" → "$6.7". Kept as the upstream string (no float maths). */
export function formatFare(fare: string): string {
  return `$${fare}`
}

/**
 * The cheapest/dearest fares across a set of boarding-stop fares. HK bus fares are
 * *sectional* — boarding later usually costs less — so a route spans a range from the
 * origin (dearest) down to the last fare stage. We compare numerically but keep the
 * **original** upstream strings as the min/max values (no float maths on the figures
 * themselves, see RouteServiceInfo). Returns undefined when no usable fare is present.
 */
export function fareRange(
  fares: Array<string | undefined>,
): { min: string; max: string } | undefined {
  let min: string | undefined
  let max: string | undefined
  for (const f of fares) {
    if (f == null || f === '') continue
    const n = Number(f)
    if (Number.isNaN(n)) continue
    if (min === undefined || n < Number(min)) min = f
    if (max === undefined || n > Number(max)) max = f
  }
  return min !== undefined && max !== undefined ? { min, max } : undefined
}

/**
 * Sectional fare for display, framed **high → low** to mirror the route's own direction:
 * the dearest fare is paid boarding at the origin, less from each later stage — "$6.7 → $5.8".
 * Uses the same arrow as the `A → B` route label so the framing reads as "origin → later stops".
 * Collapses to a single figure when the fare is flat across the route.
 */
export function formatFareRange(range: { min: string; max: string }): string {
  return range.min === range.max
    ? formatFare(range.max)
    : `${formatFare(range.max)} → ${formatFare(range.min)}`
}

const STOPS_LABEL: Record<Locale, string> = { en: 'stops', 'zh-Hant': '個站', 'zh-Hans': '个站' }

/** Stop-count label, e.g. "24 stops" / "24 個站". A Static fact (route length), locale only
 *  selects the unit word — same pattern as the fare/frequency formatters above. */
export function formatStopCount(n: number, locale: Locale): string {
  return `${n} ${STOPS_LABEL[locale]}`
}

/** Honest journey-time label, e.g. "~45 min" / "約 45 分鐘". */
export function formatJourney(min: number, locale: Locale): string {
  return locale === 'en'
    ? `~${min} ${MIN_LABEL.en}`
    : `${ABOUT_LABEL[locale]} ${min} ${MIN_LABEL[locale]}`
}

/** Typical headway, e.g. "every 10 – 25 min" / "每 10 – 25 分鐘". A coarse range from the GTFS
 *  frequency bands — honest, not a fabricated single figure. The en dash is spaced so it doesn't
 *  read as touching the digits on both sides. */
export function formatHeadway(headway: { min: number; max: number }, locale: Locale): string {
  const span = headway.min === headway.max ? `${headway.min}` : `${headway.min} – ${headway.max}`
  return locale === 'en'
    ? `${EVERY_LABEL.en} ${span} ${MIN_LABEL.en}`
    : `${EVERY_LABEL[locale]} ${span} ${MIN_LABEL[locale]}`
}

/** Daily service span, "05:35 – 23:40" (24h clock; locale-independent). Spaced en dash for
 *  legibility — an unspaced dash visually fuses with the times on either side. */
export function formatServiceHours(hours: { start: string; end: string }): string {
  return `${hours.start} – ${hours.end}`
}

/** A coarse class for an operator ETA remark, for honest styling (ADR-008/036). `scheduled`
 *  = timetable-based (not a tracked bus); `lastBus` = final departure. Matched on the en + zh
 *  free text since the feeds carry prose, not codes. */
export type RemarkKind = 'scheduled' | 'lastBus' | 'info'
export function classifyRemark(remark: I18nText): RemarkKind {
  const en = remark.en.toLowerCase()
  const zh = `${remark['zh-Hant']}${remark['zh-Hans']}`
  if (/schedul/.test(en) || /原定|預定|预定/.test(zh)) return 'scheduled'
  if (/last bus|final bus/.test(en) || /尾班|最後一?班|最后一?班/.test(zh)) return 'lastBus'
  return 'info'
}
