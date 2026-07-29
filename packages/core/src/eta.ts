import { parseRouteId } from './ids'
import { CLIENT_POLICY_DEFAULTS } from './policy'
import type { Eta, I18nText, Locale, RemarkKind } from './types'

// `@spec <module>#<export>` below means: that export's behaviour is pinned by the language-neutral
// JSON corpus at `../spec/<module>.spec.json`, group `<export>`. These are **domain rules** — the
// one kind of change no schema can generate (ADR-052 context, kind 2), so they are hand-ported to
// Swift and Kotlin and the corpus is the only thing keeping the ports equal. Change a rule and you
// edit the corpus; every platform's suite then goes red until it has been ported.
// `scripts/check-spec-coverage.mjs` fails a tagged export with no corpus **and** a corpus with no tag.

// The two honesty thresholds these functions used to declare — 90 s stale, 60 s "Due" — are now
// fields of `CLIENT_POLICY_DEFAULTS` (ADR-053), because they are numbers rather than behaviours and
// the server can therefore own them. Nothing about the rules changed; the values moved to where they
// can be served, and each function takes an explicit override so a client that has been told a
// different number can honour it without a second implementation.

export interface EtaView {
  /** Whole minutes until arrival, floored. Negative means departed. */
  minutes: number
  /** Signed seconds until arrival. */
  seconds: number
  /** Arrival is imminent (< `dueUnderSec` away). */
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
 *
 * `dueUnderSec` is the served `ClientPolicy` threshold, defaulting to the shipped one. It is one
 * number doing two jobs, and deliberately so: the band in which we refuse to show a figure and the
 * band in which a just-passed reading is still shown are the same judgement seen from either side, so
 * splitting them would let a rider be told "Due" for a bus the next screen calls departed.
 *
 * @spec eta#etaView
 */
export function etaView(
  arrivalIso: string,
  now: number,
  dueUnderSec: number = CLIENT_POLICY_DEFAULTS.dueUnderSec,
): EtaView {
  const seconds = Math.round((new Date(arrivalIso).getTime() - now) / 1000)
  return {
    seconds,
    minutes: Math.floor(seconds / 60),
    isDue: seconds < dueUnderSec && seconds >= -dueUnderSec,
    hasDeparted: seconds < -dueUnderSec,
  }
}

/**
 * Whether an ETA reading should be treated as stale.
 *
 * Reads `dataTimestamp` — when the *operator* generated the reading — not `observedAt`, so a reading
 * replayed from the offline cache ages by the operator's clock rather than looking fresh because we
 * fetched it recently (ADR-058).
 *
 * @spec eta#isStale
 */
export function isStale(
  eta: Eta,
  now: number,
  staleAfterMs: number = CLIENT_POLICY_DEFAULTS.staleAfterMs,
): boolean {
  return now - new Date(eta.dataTimestamp).getTime() > staleAfterMs
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
 *
 * @spec eta#formatRelative
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
/**
 * The `EtaLabelParts` above, for one arrival — same rule as `formatRelative`, split so the
 * number and the unit can be styled separately.
 *
 * @spec eta#etaLabelParts
 */
export function etaLabelParts(arrivalIso: string, now: number, locale: Locale): EtaLabelParts {
  const { isDue, minutes, hasDeparted } = etaView(arrivalIso, now)
  if (hasDeparted) return { kind: 'departed' }
  if (isDue) return { kind: 'due', label: DUE_LABEL[locale] }
  return { kind: 'mins', value: Math.max(minutes, 1), unit: MIN_LABEL[locale] }
}

/** Hong Kong is UTC+8 all year — no DST since 1979 — so the offset is a constant, not a lookup. */
const HK_UTC_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * Hong Kong wall-clock time of an arrival, `HH:mm` on a 24-hour clock — preferred for longer waits
 * (proposals/00 P5, the countdown⇄clock toggle). Returns `''` for an unparseable timestamp.
 *
 * Computed arithmetically rather than through `toLocaleTimeString`, which is why it can be pinned by
 * a corpus at all. Two distinct reasons, and neither is style:
 *
 *  1. **The locale-formatting version was not reproducible.** It read the *device's* time zone and
 *     the host's ICU version, so the same ISO string rendered three different ways on three
 *     platforms — and a rider abroad got their own local time on a Hong Kong bus board. Neither is a
 *     property of this code, so no fixture could have caught either, and `packages/core` is the layer
 *     we intend to hand-port to Swift and Kotlin.
 *  2. **It slipped past the kernel's determinism ban.** `Intl` is in the denied-globals list
 *     (ADR-051), but `toLocaleTimeString` is a method on `Date`, so no global was ever referenced.
 *     `layers.json` now bans the `toLocale*` *pattern* in the kernel too, so this class of regression
 *     fails the build instead of waiting to be noticed.
 *
 * Shift the instant into HK and read the UTC fields back: one branch, no locale, byte-reproducible
 * everywhere. Fixed while the function still had **zero callers**, which made it free — after P5
 * ships it would have been a visible change to every arrival row.
 *
 * There is deliberately no `locale` parameter. A 24-hour `HH:mm` is identical in all three of our
 * locales, so a locale argument could only introduce a difference we do not want.
 *
 * @spec eta#formatClock
 */
export function formatClock(arrivalIso: string): string {
  const t = Date.parse(arrivalIso)
  if (Number.isNaN(t)) return ''
  const hk = new Date(t + HK_UTC_OFFSET_MS)
  const hh = String(hk.getUTCHours()).padStart(2, '0')
  const mm = String(hk.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
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
 *
 * @spec eta#dedupeEtas
 */
export function dedupeEtas(etas: Eta[]): Eta[] {
  const byLine = new Map<string, Eta>()
  for (const eta of etas) {
    // Keyed by operator + number + direction. Safe even for GMB, whose numbers repeat across
    // regions: a stop belongs to one region and route_code is unique within a region, so two
    // arrivals here sharing number+direction are always variants of the same route — collapsing
    // them (keeping the sooner) is exactly right (ADR-047).
    //
    // An unparseable route id keys on the id itself, so it only ever dedupes against its own twin.
    // The `split(':')` this replaced defaulted the fields to `''`, which collapsed *every*
    // malformed reading from one operator into a single row and dropped the rest — the worst
    // available answer for the case where we already know the data is odd.
    const line = parseRouteId(eta.routeId)
    const key = line
      ? `${eta.operator}|${line.routeNo}|${line.bound}`
      : `${eta.operator}|${eta.routeId}`
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

/**
 * HK$ fare for display, e.g. "6.7" → "$6.7". Kept as the upstream string (no float maths).
 *
 * @spec eta#formatFare
 */
export function formatFare(fare: string): string {
  return `$${fare}`
}

/**
 * The cheapest/dearest fares across a set of boarding-stop fares. HK bus fares are
 * *sectional* — boarding later usually costs less — so a route spans a range from the
 * origin (dearest) down to the last fare stage. We compare numerically but keep the
 * **original** upstream strings as the min/max values (no float maths on the figures
 * themselves, see RouteServiceInfo). Returns undefined when no usable fare is present.
 *
 * @spec eta#fareRange
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
 *
 * @spec eta#formatFareRange
 */
export function formatFareRange(range: { min: string; max: string }): string {
  return range.min === range.max
    ? formatFare(range.max)
    : `${formatFare(range.max)} → ${formatFare(range.min)}`
}

/** A contiguous run of stops sharing one boarding fare — a "fare stage". `fromSeq`/`toSeq` are
 *  1-based stop sequence numbers (inclusive). HK fares are sectional, so a route reads as a
 *  descending series of these stages, dearest from the origin (ADR-036/044). */
export interface FareStage {
  fare: string
  fromSeq: number
  toSeq: number
}

/**
 * Collapse a route's per-stop sectional fares (index = seq-1) into contiguous fare stages:
 * consecutive stops with an equal fare merge into one stage. Blank/missing/non-numeric fares
 * (e.g. the terminus, which has no boarding fare) break a run and are skipped. Ordered by seq.
 * Powers the fare-stage timeline (ADR-044).
 *
 * @spec eta#fareStages
 */
export function fareStages(fares: Array<string | undefined>): FareStage[] {
  const stages: FareStage[] = []
  fares.forEach((f, i) => {
    const seq = i + 1
    if (f == null || f === '' || Number.isNaN(Number(f))) return
    const last = stages[stages.length - 1]
    if (last && last.fare === f && last.toSeq === seq - 1) last.toSeq = seq
    else stages.push({ fare: f, fromSeq: seq, toSeq: seq })
  })
  return stages
}

// --- Concession estimates (ADR-044) -------------------------------------------------------
// HK open data carries NO fares-by-passenger-type — child/elderly figures don't exist upstream
// (docs/research/02). These helpers derive a labelled ESTIMATE from policy, kept here as the
// single source of truth so a scheme change (the $2 Scheme changed on 3 Apr 2026) is one edit.
// A deliberate, bounded exception to ADR-008: always shown as an explicit estimate, never as data.

/**
 * A fare figure as a number, or `undefined` when there isn't one.
 *
 * `Number('')` is **0**, not `NaN`, so a `Number.isFinite` guard alone let a *missing* fare through
 * as zero — and both estimators below then produced a confident figure from nothing ("$0.0" for a
 * child, "$2.0" for an elderly rider, because `max($2, 0)` is `$2`). Presenting an invented number
 * as an estimate is precisely what ADR-008 forbids: absent must stay absent, so the caller renders
 * nothing rather than a fare no rider will be charged.
 */
function parseFareOrUndefined(fare: string): number | undefined {
  if (fare.trim() === '') return undefined
  const n = Number(fare)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Approximate child (3–11) fare — roughly half the adult fare, rounded to $0.1. Estimate.
 *
 * @spec eta#estimateChildFare
 */
export function estimateChildFare(adultFare: string): string | undefined {
  const n = parseFareOrUndefined(adultFare)
  if (n === undefined) return undefined
  return (Math.round((n / 2) * 10) / 10).toFixed(1)
}

/** Approximate elderly-65+/PwD fare under the Government $2 Scheme (from 3 Apr 2026: $2 for
 *  fares up to $10, otherwise 20% of the fare — i.e. `max($2, 20%)`). Requires an eligible/
 *  JoyYou Octopus, not cash. Estimate.
 *
 * @spec eta#estimateElderlyFare
 */
export function estimateElderlyFare(adultFare: string): string | undefined {
  const n = parseFareOrUndefined(adultFare)
  if (n === undefined) return undefined
  return (Math.round(Math.max(2, n * 0.2) * 10) / 10).toFixed(1)
}

// `formatStopCount` used to sit here; it is now `t(locale, 'stopCount', { n })` in `@nextbus/i18n`.
// The boundary that move draws: **`core` owns the rule, `i18n` owns the word.** A stop count has no
// rule — it was `${n} ${STOPS_LABEL[locale]}`, a pure label — and pretending otherwise cost us the
// repo's last `knownDefect`: `formatStopCount(1, 'en')` returned `"1 stops"`, because English
// pluralization is not something a `Record<Locale, string>` can express. That corpus row's own `why`
// prescribed exactly this, rather than an English-only `n === 1` branch three ports would each have
// to remember.
//
// The other six label tables in this package stay: `DUE_LABEL`, `MIN_LABEL`, `EVERY_LABEL`,
// `ABOUT_LABEL` above, and `geo.ts`'s `WALK_LABEL` and `COMPASS_LABELS`. Each is an uninflected unit
// word attached to a real rule — minute rounding, headway shape, compass bucketing — which a port
// reproduces from the corpus. Moving them would churn ~100 corpus rows across seven formatters and
// buy no cross-platform guarantee, so that is deferred deliberately, not forgotten.

/**
 * Honest journey-time label, e.g. "~45 min" / "約 45 分鐘".
 *
 * @spec eta#formatJourney
 */
export function formatJourney(min: number, locale: Locale): string {
  return locale === 'en'
    ? `~${min} ${MIN_LABEL.en}`
    : `${ABOUT_LABEL[locale]} ${min} ${MIN_LABEL[locale]}`
}

/** Typical headway, e.g. "every 10 – 25 min" / "每 10 – 25 分鐘". A coarse range from the GTFS
 *  frequency bands — honest, not a fabricated single figure. The en dash is spaced so it doesn't
 *  read as touching the digits on both sides.
 *
 * @spec eta#formatHeadway
 */
export function formatHeadway(headway: { min: number; max: number }, locale: Locale): string {
  const span = headway.min === headway.max ? `${headway.min}` : `${headway.min} – ${headway.max}`
  return locale === 'en'
    ? `${EVERY_LABEL.en} ${span} ${MIN_LABEL.en}`
    : `${EVERY_LABEL[locale]} ${span} ${MIN_LABEL[locale]}`
}

/**
 * Normalize a GTFS-style `"HH:mm"` that may run past midnight into a real clock time.
 *
 * The frequency table expresses "01:35 the next day" as `"25:35"` (see `FreqBand` in the wire
 * contract), which is correct for arithmetic and meaningless to a rider. Anything at or beyond
 * 24:00 wraps; everything else, including values we can't parse, passes through untouched so a
 * surprising upstream string is shown rather than mangled.
 */
function wrapPastMidnight(hhmm: string): string {
  const m = /^(\d{1,3}):(\d{2})$/.exec(hhmm)
  if (!m?.[1] || !m[2]) return hhmm
  const h = Number(m[1])
  if (h < 24) return hhmm
  return `${String(h % 24).padStart(2, '0')}:${m[2]}`
}

/** Daily service span, "05:35 – 23:40" (24h clock; locale-independent). Spaced en dash for
 *  legibility — an unspaced dash visually fuses with the times on either side.
 *
 *  Past-midnight values are wrapped first: the dataset's `"25:35"` reaches a rider as `"01:35"`.
 *  Doing it here rather than at every call site is deliberate — this is the display boundary, and
 *  leaving it to callers is what let a raw `"25:35"` through in the first place.
 *
 * @spec eta#formatServiceHours
 */
export function formatServiceHours(hours: { start: string; end: string }): string {
  return `${wrapPastMidnight(hours.start)} – ${wrapPastMidnight(hours.end)}`
}

// `RemarkKind` used to be declared here as a union literal. It is now `z.infer` of
// `RemarkKindSchema` in `@nextbus/contract` (re-exported from `./types`), because the classification
// crosses the wire as `Eta.remarkKind` since ADR-053 — and a wire shape declared in two places is
// the thing ADR-052 exists to prevent.
/**
 * @spec eta#classifyRemark
 */
export function classifyRemark(remark: I18nText): RemarkKind {
  const en = remark.en.toLowerCase()
  const zh = `${remark['zh-Hant']}${remark['zh-Hans']}`
  if (/schedul/.test(en) || /原定|預定|预定|未開出|未开出/.test(zh)) return 'scheduled'
  if (/last bus|final bus/.test(en) || /尾班|最後一?班|最后一?班/.test(zh)) return 'lastBus'
  return 'info'
}
