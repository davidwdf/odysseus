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
   * The published frequency, where there is **no live reading at all** — "every 10 – 15 min".
   *
   * `etaLabelParts` never returns this, and cannot: it is handed an arrival and every arm above is a
   * statement about one. It exists because a **saved** route is a row whether or not a bus is due
   * (WP6-4b), and a row with nothing on its right-hand side is the empty card `StopRow`'s spec has
   * declared a `mustNot` since WP6-1: *a card with a name and nothing under it cannot be told from a
   * favourite key that no longer resolves.* A route with a timetable is not a route with nothing to say.
   */
  | { kind: 'headway'; text: string }
  /**
   * Neither a reading nor a published frequency — the dash.
   *
   * The third arm of the same union `PlaceRouteRow.readout` has carried since WP6-3a, and it is here for
   * the same reason: so that "we do not know" is a thing a row can *say*, rather than a blank a rider has
   * to interpret. `urgency` is `none` and `stale` is false for both of these — there is no reading to be
   * urgent or old about.
   */
  | { kind: 'none' }
/**
 * The `EtaLabelParts` above, for one arrival — same rule as `formatRelative`, split so the
 * number and the unit can be styled separately.
 *
 * `dueUnderSec` is threaded through to `etaView` rather than left at the shipped default. It had been
 * omitted, which made this function the one place a served `ClientPolicy` override was silently
 * dropped: `EtaBadge` — the only caller, and the widest-reached ETA renderer in the app — asked for a
 * label and got the compiled-in 60 s band, so an edge that moved `dueUnderSec` would have been
 * honoured by `etaView`'s other callers and ignored here. Recorded as a Wave 3 loose end
 * (`docs/11`, ADR-053 consequences) and closed here because a second renderer would have inherited
 * the same gap in a different language, which is exactly the divergence Wave 4 exists to detect.
 *
 * @spec eta#etaLabelParts
 */
export function etaLabelParts(
  arrivalIso: string,
  now: number,
  locale: Locale,
  dueUnderSec: number = CLIENT_POLICY_DEFAULTS.dueUnderSec,
): EtaLabelParts {
  const { isDue, minutes, hasDeparted } = etaView(arrivalIso, now, dueUnderSec)
  if (hasDeparted) return { kind: 'departed' }
  if (isDue) return { kind: 'due', label: DUE_LABEL[locale] }
  return { kind: 'mins', value: Math.max(minutes, 1), unit: MIN_LABEL[locale] }
}

/**
 * How much attention one arrival is owed — the *meaning* a renderer turns into a colour.
 *
 * This exists because the alternative had already drifted. `apps/mobile/components/EtaBadge.tsx`
 * decided imminence with a literal `parts.value <= 5` — 360 s, since `value` is floored minutes —
 * while `CLIENT_POLICY_DEFAULTS.warnUnderSec` served **180**, and the comment on that field said
 * *"Nothing reads this yet"*. Both were true: the field had no reader, and the screen had its own
 * number. That is the WP3-4 arrival-cap disagreement one field over, and it is the seventh instance
 * in this repo of one judgement written down twice.
 *
 * The return is a **name, not a token and certainly not a colour** — the ADR-053 line, applied on
 * the client side of the network this time. `EtaBadge`'s `urgency → text-warning` table is the
 * correct client half and stays in the view; what could not stay there is the *threshold*, because a
 * second renderer would have had to re-guess it. So: the kernel says an arrival is `soon`; each
 * platform decides what `soon` looks like in its own colour system.
 *
 * `undefined` means the route had no reading at all, which is distinct from `departed` — the row
 * still exists and still names its route, it just has nothing to count down.
 *
 * @spec eta#etaUrgency
 */
export function etaUrgency(
  arrivalIso: string | undefined,
  now: number,
  policy: Pick<
    typeof CLIENT_POLICY_DEFAULTS,
    'dueUnderSec' | 'warnUnderSec'
  > = CLIENT_POLICY_DEFAULTS,
): EtaUrgency {
  if (arrivalIso === undefined) return 'none'
  const { isDue, hasDeparted, seconds } = etaView(arrivalIso, now, policy.dueUnderSec)
  if (hasDeparted) return 'none'
  if (isDue) return 'due'
  return seconds < policy.warnUnderSec ? 'soon' : 'normal'
}

/**
 * The attention an arrival is owed. Ordered by urgency descending, which is the order a renderer's
 * own table will want to read in.
 *
 *  · `due` — inside `dueUnderSec`; no figure is shown at all (ADR-008)
 *  · `soon` — inside `warnUnderSec`; the point at which "there is a bus coming" becomes "run"
 *  · `normal` — a figure the rider can plan around
 *  · `none` — departed, or no reading; there is nothing to be urgent about
 */
export type EtaUrgency = 'due' | 'soon' | 'normal' | 'none'

/** Everything an honest arrival readout needs, and nothing a renderer could disagree about. */
export interface EtaReadout {
  /** The figure and its unit, or the status word — never a fabricated sub-minute number (ADR-008). */
  label: EtaLabelParts
  /** What it means. A renderer maps this to its own colour system; it is never a colour. */
  urgency: EtaUrgency
  /** Old enough to say so. Dimming is the renderer's choice; the judgement is not. */
  stale: boolean
}

/**
 * The three things every arrival readout in the product is made of, derived together.
 *
 * They travel together because they are read together and because they must agree: the label's "Due"
 * band and the urgency's `due` band are the *same* `dueUnderSec`, so a caller that computed one with a
 * served policy and the other with the default could render the word "Due" in the ordinary colour.
 * Two screens were doing exactly that by hand before WP4-0 — the Nearby card and the Place detail row
 * — and a third renderer would have made three.
 *
 * @spec eta#etaReadout
 */
export function etaReadout(
  eta: Eta,
  locale: Locale,
  now: number,
  policy: Pick<
    typeof CLIENT_POLICY_DEFAULTS,
    'dueUnderSec' | 'warnUnderSec' | 'staleAfterMs'
  > = CLIENT_POLICY_DEFAULTS,
): EtaReadout {
  const next = eta.arrivals[0]
  return {
    label:
      next === undefined
        ? { kind: 'departed' }
        : etaLabelParts(next, now, locale, policy.dueUnderSec),
    urgency: etaUrgency(next, now, policy),
    stale: isStale(eta, now, policy.staleAfterMs),
  }
}

/** An operator remark reduced to one locale and classified — what a renderer actually shows. */
export interface RemarkView {
  text: string
  /** The server's class where it sent one, else `classifyRemark`'s. Never absent, so a renderer's
   *  kind→tone table needs no fallback for a missing kind (only for an unknown one). */
  kind: RemarkKind
}

/**
 * An operator remark as a renderer needs it, or `undefined` when there is nothing to show.
 *
 * Three rules in one place, each of which had been sitting inside a React component:
 *
 *  1. **Absent in this locale counts as absent.** The feeds really do send an empty `en`, and the
 *     component tested truthiness, so a blank rendered nothing. Returning it as text would put an
 *     empty tag into the layout.
 *  2. **The served class wins.** `Eta.remarkKind` is the edge's classification (ADR-053).
 *  3. **Falling back is not degrading.** With no served kind, `classifyRemark` — *the same kernel
 *     function the edge calls* — produces the identical answer, which is what makes an offline replay
 *     (ADR-058) or an older edge indistinguishable from a current one.
 *
 * @spec eta#remarkView
 */
export function remarkView(
  // `null` as well as `undefined`, and the type is deliberately wider than `Eta.remark`'s. The app does
  // **no runtime validation** (ADR-052 decision 2), so an explicit `"remark": null` on the wire arrives
  // here as `null` however the schema types it. The code this replaced reached the field through
  // `eta.remark?.[locale]`, where optional chaining absorbed that for free; writing the guard as
  // `=== undefined` reintroduced a crash on a payload the old component survived, and a corpus row
  // caught it. Widening the parameter is the honest fix — narrowing at the call site would just move
  // the same assumption somewhere less visible.
  remark: I18nText | null | undefined,
  locale: Locale,
  servedKind?: RemarkKind,
): RemarkView | undefined {
  const text = remark?.[locale]
  if (!text || remark === null || remark === undefined) return undefined
  return { text, kind: servedKind ?? classifyRemark(remark) }
}

/** Hong Kong is UTC+8 all year — no DST since 1979 — so the offset is a constant, not a lookup. */
const HK_UTC_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * The newest board among the ones a screen drew, or `null` when it drew none — the data half of `feedNotice`.
 *
 * **One rule, four callers.** Route detail carries the answer on its view; Nearby, Place detail and
 * Favourites hand their payload's timestamps straight in. The alternative was each screen taking its own
 * maximum, which is four chances to disagree about a tie or about an unreadable value — and taking a maximum
 * is arithmetic, which a renderer may not do (`check-no-derivation`).
 *
 * **Unreadable and absent values are skipped, not treated as epoch zero.** Upstream really does publish
 * fields this app cannot parse — that is the whole of ADR-128's fare defect — and a `NaN` folded into a
 * maximum would make one bad field read as *"last updated 08:00"* on every screen that touched it.
 *
 * Returns an ISO string rather than a number so the value can cross a wire, sit in a corpus, and be handed
 * to `formatClock` without a second conversion at each call site.
 *
 * @spec eta#newestBoard
 */
export function newestBoard(timestamps: readonly (string | null | undefined)[]): string | null {
  let best = Number.NaN
  for (const ts of timestamps) {
    if (ts === null || ts === undefined) continue
    const t = Date.parse(ts)
    if (Number.isNaN(t)) continue
    if (Number.isNaN(best) || t > best) best = t
  }
  return Number.isNaN(best) ? null : new Date(best).toISOString()
}

/**
 * What a **screen** says when it has stopped being fed — the four states of `docs/07`'s hardening row,
 * reduced to the three that need a sentence.
 *
 * ## Why this is a screen's statement and not a reading's
 *
 * Staleness is a property of the **board**: one `dataTimestamp` per board, so a per-reading cue draws one
 * fact once per reading and a rider can do nothing with *"this number is two minutes old"*. Two such cues
 * were built and withdrawn for exactly that reason (ADR-123). What a rider *can* act on is *"the screen has
 * stopped updating"*, and that is one line, once, here.
 *
 * ## The four states, and why one of them says nothing
 *
 * | state | what it means to a rider | this returns |
 * |---|---|---|
 * | fresh | nothing to say | `none` |
 * | old data, still trying | *"the data is old and we are still asking"* | `lastUpdated` |
 * | the rider has no network | *their* problem to fix | `offline` |
 * | our edge is unreachable or erroring | *our* problem, retrying | `unreachable` |
 * | **an upstream board refused** | already has vocabulary | **nothing — deliberately** |
 *
 * The last row is the important one. A refused upstream board is already said per card and per row
 * (`StopCardView.incomplete`, `RouteStopRowView.incomplete`, `liveArrivals`) by ADR-073/077/081/114, and a
 * second sentence at screen level could **disagree with the first**: a live round asks each pole separately,
 * so one kerb can refuse while forty answer, and no screen-level line can say that without being wrong about
 * most of the route. So `feedNotice` is not given upstream failures and has no arm for them.
 *
 * ## Precedence, which is the whole of the logic
 *
 * `offline` → `unreachable` → `lastUpdated` → `none`. Each earlier state *explains* the later ones: a rider
 * with no network does not also need telling their data is old, and neither sentence is improved by adding
 * the other. One line, one message.
 *
 * ## The clock
 *
 * `at` is Hong Kong wall-clock from `formatClock`, i.e. an **absolute** time. ADR-008 prefers that to a
 * fabricated relative one — *"2 minutes ago"* ages while nothing re-renders, which is the same dishonesty as
 * a client-side countdown. It is carried on every arm, not only `lastUpdated`, so a later iteration can
 * enrich the offline sentence without a kernel change.
 *
 * ⚠️ **A reading from yesterday reads as today.** `formatClock` gives an `HH:MM` with no date, so a cache
 * replayed after midnight says *"Last updated 23:58"* with no hint that it is stale by a day. Recorded rather
 * than fixed: the honest fix needs a date-aware format and a locale, and this arm is only reachable through
 * the persisted query cache. `docs/07` carries it.
 *
 * @spec eta#feedNotice
 */
export function feedNotice(input: {
  /** The freshest board on screen, or `null` when the screen is drawing no readings at all. */
  lastUpdatedIso: string | null
  now: number
  /** Whether the platform believes it has a network — a platform fact, handed in like a clock. */
  online: boolean
  /** How the last attempt failed. Upstream refusals are **not** passed here; see above. */
  trouble: FeedTrouble
  staleAfterMs: number
}): FeedNotice {
  const at = input.lastUpdatedIso === null ? '' : formatClock(input.lastUpdatedIso)
  if (!input.online) return { kind: 'offline', at }
  if (input.trouble === 'unreachable') return { kind: 'unreachable', at }
  const t = input.lastUpdatedIso === null ? Number.NaN : Date.parse(input.lastUpdatedIso)
  // An unreadable or absent timestamp is not evidence of staleness. Saying "last updated" with no time to
  // put after it would be worse than silence, which is the same reason `formatClock` returns '' rather
  // than inventing a value.
  if (Number.isNaN(t)) return { kind: 'none', at: '' }
  return input.now - t > input.staleAfterMs ? { kind: 'lastUpdated', at } : { kind: 'none', at }
}

/** How the last attempt to reach our own edge failed. An upstream board's refusal is not one of these. */
export type FeedTrouble = 'none' | 'unreachable'

/** What a screen should say about its own freshness, and the clock time to say it with. */
export interface FeedNotice {
  kind: 'none' | 'lastUpdated' | 'offline' | 'unreachable'
  /** Hong Kong wall-clock of the freshest board, or `''` when there is none. */
  at: string
}

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
 * The rider-facing line an arrival belongs to: operator + route number + direction.
 *
 * **One declaration, three readers.** `dedupeEtas` builds its key on top of it, `stopCardView`
 * collapses a compact card's rows with it, and the edge indexes a place's destinations by it
 * (`stampTables` in `apps/edge/src/stop-route.ts`, which used to carry its own copy under a comment
 * saying "must agree with `dedupeEtas` exactly" — a comment is not a mechanism, and a second spelling
 * of one line silently drops a destination rather than failing).
 *
 * The service type is deliberately absent: a rider does not choose a timetable variant. The pole is
 * absent too, because a *line* is not a boarding point — `dedupeEtas` appends the pole itself, and
 * keeping the two halves separate is what lets the edge index by line while the wire keys by kerb.
 *
 * An unparseable route id keys on the whole id, so it only ever dedupes against its own twin. The
 * `split(':')` this rule replaced defaulted the missing fields to `''`, which collapsed *every*
 * malformed reading from one operator into a single row and dropped the rest — the worst available
 * answer for the case where we already know the data is odd.
 *
 * @spec eta#etaLineKey
 */
export function etaLineKey(eta: Pick<Eta, 'operator' | 'routeId'>): string {
  const line = parseRouteId(eta.routeId)
  return line ? `${eta.operator}|${line.routeNo}|${line.bound}` : `${eta.operator}|${eta.routeId}`
}

/**
 * **The identity of an arrival: a rider line at one boarding point.** `<line>|<pole>`.
 *
 * This is the unit WP5-9 made the model agree on. A place is N poles (ADR-042); a route row is per
 * pole; and this is the matching unit for a *reading*, so "one arrival" and "one row" finally mean the
 * same thing. Two readers, and they must not disagree: `dedupeEtas` collapses on it, and
 * `applyLiveEtasToStopDetail` uses it to find the reading for a row whose exact service-type variant
 * is not the one upstream published. A fallback keyed differently from the normalisation would put a
 * reading on a row the wire never gave it to.
 *
 * The pole is **last**, and both halves are joined with `|` while nothing escapes a `|` inside a
 * field. That is a real hazard rather than a theoretical one — it cost this repo an arrival once
 * already, see `dedupeEtas:literal-pipe-in-route-id-collides` — and it is bounded here: canonical ids
 * carry colons and never a pipe (ADR-032), a route id that breaks that rule has already fallen back
 * to the whole id in `etaLineKey`, and a pipe in the trailing field can only ever *split* one line,
 * never merge two.
 *
 * @spec eta#etaBoardingKey
 */
export function etaBoardingKey(eta: Pick<Eta, 'operator' | 'routeId' | 'stopId'>): string {
  return `${etaLineKey(eta)}|${eta.stopId}`
}

/**
 * Collapse rider-duplicate ETAs to one entry per line **at one boarding point**, keeping the soonest
 * reading.
 *
 * A stop is indexed per direction (and per operator service-type), but the upstream
 * KMB feed returns *every* direction of a route in one response — so fetching a
 * stop's routes can surface the same arrival more than once (identical times), and
 * service-type variants show the same line twice. A rider thinks "route + direction",
 * so we key by operator + route number + bound. Pure function; arrivals are ISO-8601
 * with a fixed +08:00 offset, so lexical comparison is chronological.
 *
 * ## The pole is in the key, and that is WP5-9
 *
 * A place is N poles (ADR-042) and a rider walks to *one* of them, so one line boarding at two of
 * them is **two arrivals**, not one. Keyed without the pole, this function was the last place in the
 * model where the unit of "an arrival" was (line, place) while the unit of a row had become (line,
 * pole) — so `/v1/etas/:id` published at most one reading per line for a whole place and the sibling
 * pole's row read "no reading right now" while a bus was genuinely due there. Measured against the
 * live GMB feed on 2026-07-31: 68K had buses at both poles of Fu Kin Street 11 s apart and we
 * published one. Upstream keeps the two distinct; fusing them was ours.
 *
 * Two poles of one line are also not always two buses of one service. At Tai On Street two different
 * minibus services share the number 20 and both are circular, so number and direction separate
 * nothing and only the pole can (`dedupeRoutes` was corrected the same way one wave earlier). So the
 * pole is not merely a tie-break here — for GMB it is part of the identity.
 *
 * **What still collapses, deliberately:** two service-type variants at the SAME pole. Citybus 969 is
 * listed three times at one kerb, all bound for Causeway Bay; KMB runs 269D as types 1 and 4 off one
 * pole. Those are one bus to a rider and this is the function that says so.
 *
 * @spec eta#dedupeEtas
 */
export function dedupeEtas(etas: Eta[]): Eta[] {
  const byLine = new Map<string, Eta>()
  for (const eta of etas) {
    const key = etaBoardingKey(eta)
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
 *  fares up to $10, otherwise 20% of the fare — i.e. `max($2, 20%)`), **capped at the adult fare**.
 *  Requires an eligible/JoyYou Octopus, not cash. Estimate.
 *
 *  ## The cap is the whole of the rule, and it was missing
 *
 *  `max($2, 20%)` is right for every fare *above* $2 and wrong below it: the Scheme **caps** what a
 *  concessionary rider pays, it does not invent a charge. A section priced at **$0** — which is what a
 *  bus-bus interchange leg costs on routes like 49X through the Shing Mun Tunnels BBI — came out as
 *  **$2.0**, a figure no rider is charged and which is *more than the adult beside it*. Reported from
 *  the shipping app, and it was wrong on all three renderers because the rule is shared.
 *
 *  `min(adult, …)` is the fix and it changes nothing above $2: for any `n >= 2`, `max(2, 0.2n) <= n`
 *  already, so the clamp is inert exactly where the Scheme applies and binding exactly where it does
 *  not. A $1.50 fare now estimates $1.50 rather than $2.00, for the same reason.
 *
 * @spec eta#estimateElderlyFare
 */
export function estimateElderlyFare(adultFare: string): string | undefined {
  const n = parseFareOrUndefined(adultFare)
  if (n === undefined) return undefined
  return (Math.round(Math.min(n, Math.max(2, n * 0.2)) * 10) / 10).toFixed(1)
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
