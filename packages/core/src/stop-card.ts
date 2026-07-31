// The compact stop card — the thing Nearby and Favourites are both lists of — as a rule over the
// canonical model rather than as a React tree.
//
// WHY THIS MODULE EXISTS AT ALL, since the code it holds was working where it was
// Wave 4 (`docs/proposals/03` WP4-1) asks for a second renderer of one screen whose acceptance is
// *"lines of new logic outside `.tsx` and adapters: **zero**"*. That was unachievable, because six
// derivations lived inside `apps/mobile`'s components and were reachable only by rendering:
//
//   · the list's order                          app/(tabs)/index.tsx:95
//   · the `maxRows` cap and the "+N more" count  components/StopRow.tsx:98–101
//   · the caption's parts, order and separators  components/StopRow.tsx:104–111
//   · destination-else-remark as the headline    components/StopRow.tsx:40,52
//   · the route number and its fallback          components/StopRow.tsx:30–32
//   · the name split into label + code           components/StopName.tsx
//
// A second renderer had two options for each: re-implement it, or read the JSX and guess. Both
// produce two declarations of one rule, which is the drift this plan exists to eliminate — and a
// re-implementation would have *passed* a byte-identity check on the day it was written while
// proving the opposite of the thesis. So they move here first, under the copy-then-corpus-then-delete
// method Wave 2 used, and the corpus becomes the golden both renderers are measured against.
//
// WHY IT IS `stop-card` AND NOT `nearby`
// Favourites renders the same card through the same component. Naming the module after one of its two
// callers would have been wrong within the week. `nearbyView` — the ordering — is the part that really
// is Nearby's own.
//
// THE LINE THIS MODULE HOLDS
// `core` owns the rule, `i18n` owns the word (ADR-054). So the *count* of hidden routes is computed
// here and the phrase "+3 more" is not: `t(locale, 'moreRoutes', { n })` stays in the view, because
// it is a plural rule in an ICU catalogue. The caption, by contrast, *is* composed here — its parts
// are already kernel functions (`formatBearing`, `formatDistance`, `formatWalk`) and what a renderer
// would otherwise have to re-guess is their order and the two different separators between them.
//
// Nothing here reads a clock, a device or a locale it was not handed — the property that makes the
// package hand-portable at all (ADR-051).

import { type EtaReadout, etaLineKey, etaReadout, type RemarkView, remarkView } from './eta'
import { formatBearing, formatDistance, formatWalk } from './geo'
import { parseRouteId } from './ids'
import { CLIENT_POLICY_DEFAULTS } from './policy'
import { splitStopCode, titleCaseName } from './stop-name'
import type { Eta, I18nText, Locale, NearbyStop, OperatorId } from './types'

// `@spec <module>#<export>` below means: that export's behaviour is pinned by the language-neutral
// JSON corpus at `../spec/<module>.spec.json`, group `<export>`. These are **domain rules** — the one
// kind of change no schema can generate (ADR-052 context, kind 2), so they are hand-ported to Swift
// and Kotlin and the corpus is the only thing keeping the ports equal.
// `scripts/check-spec-coverage.mjs` fails a tagged export with no corpus **and** a corpus with no tag.

/** A stop name split for display: the name proper, and the operator's own stop code if it carried
 *  one. Two fields rather than one string because they render at different sizes (ADR-034) — which
 *  is a layout decision, and therefore the renderer's, so the kernel hands over both halves and
 *  expresses no opinion about the gap between them. */
export interface StopCardName {
  /** The name, title-cased for display. CJK passes through unchanged. */
  label: string
  /** The trailing parenthesised code ("ST311"), absent when the name carried none. */
  code?: string
}

/** One route's row within a card: which line, where it is headed, and how long until it arrives.
 *  Extends `EtaReadout` so the Place screen's row and this one are the same three fields derived by
 *  the same function — they had been two hand-written copies. */
export interface StopCardRow extends EtaReadout {
  routeId: string
  operator: OperatorId
  /** The number on the chip — the whole id when it cannot be parsed, so an unreadable id still shows
   *  the rider something rather than an empty chip. */
  routeNo: string
  /** "→ Causeway Bay". The destination when the feed gave one, else the remark standing in for it.
   *  Absent when the feed supplied neither. */
  headline?: string
  /** The remark as its own line — only when it is *not* already standing in as the headline, so the
   *  same words never appear twice in one row. */
  remark?: RemarkView
}

/** A whole card: a heading, a caption and the route rows under it. */
export interface StopCardView {
  stopId: string
  name: StopCardName
  /** The caption under the name: a compass direction for a merged place, then distance · walk.
   *  Empty when the card has neither — Favourites passes no distance. */
  caption: string
  /** Passed through so a renderer can choose the compass arrow over the generic pin. Data presence,
   *  not styling: which glyph is the renderer's business, but *whether there is a direction to draw*
   *  is the model's. */
  bearingDeg?: number
  rows: StopCardRow[]
  /** Routes at this place beyond the rows shown — the "+N more" count. Zero means no affordance. */
  remaining: number
}

/** What a card is built from: exactly the data the wire supplies, and nothing derived. */
export interface StopCardInput {
  stop: { id: string; name: I18nText; bearingDeg?: number }
  /** Straight-line metres. Omitted where distance is irrelevant (Favourites), which hides the
   *  distance half of the caption. */
  distanceM?: number
  /** The place's readings, soonest first — one per line per boarding pole since WP5-9, so a line
   *  boarding at two kerbs appears twice. The card collapses them to one row per line; see
   *  `stopCardView`. */
  etas: readonly Eta[]
  /** True total **rider lines** (operator + number + direction) serving the place, from the static
   *  index. Omitted by callers that have no such total, where the lines among the fetched readings
   *  are the best available answer. */
  routeCount?: number
}

/** The clock, locale and served numbers a card needs — all explicit, none measured here. */
export interface StopCardOptions {
  locale: Locale
  now: number
  policy?: Pick<
    typeof CLIENT_POLICY_DEFAULTS,
    'dueUnderSec' | 'warnUnderSec' | 'staleAfterMs' | 'maxRows'
  >
}

/**
 * One stop card, fully derived.
 *
 * **The cap and the count are computed together, in one place.** They have to be: `remaining` is the
 * honest total minus the rows actually shown, so a caller that pre-sliced its list before handing it
 * over got `4 − 4 = 0` and the affordance vanished. That was a real, shipped bug in Favourites
 * (WP3-4 found it), and it was possible only because the two halves of one rule sat in different
 * files. Here the slice and the subtraction cannot disagree.
 *
 * **Why a row may carry no remark even when the ETA has one.** Two distinct cases, deliberately
 * collapsed to one absent field because a renderer treats them identically: the remark is already
 * serving as the headline (the feed sent no destination), so repeating it below would print the same
 * words twice; or its text is empty in the active locale, which the operators' feeds do produce.
 *
 * `routeCount` absent falls back to the number of rider lines among the readings, which is what a
 * caller with no static total can honestly claim — never a silent filter.
 *
 * **A compact card's row is a rider line at this PLACE, and since WP5-9 that has to be said out loud.**
 * `/v1/etas` and `/v1/nearby` now publish one reading per line *per boarding pole* — a place is N poles
 * (ADR-042) and the Place screen shows a row per kerb, which is the honest answer there because that
 * screen prints a heading per kerb. This card has no such heading: two rows reading `68K → Julimount
 * Garden` with two times would ask a rider to choose between them and give them nothing to choose
 * with, which is the same failure `poleSideOctants` declines to commit one screen over. So the
 * readings are collapsed to one row per line, keeping the soonest, and the kerb stays a Place-detail
 * fact.
 *
 * That collapse is also what keeps the "+N more" count true, and it is the part that would have gone
 * quietly wrong: `routeCount` is the number of distinct rider *lines* serving the place (the dataset
 * counts `operator|route|bound` across every pole), so subtracting rows counted per *pole* from it
 * understates what is hidden — 5 lines, 4 rows of which two are one line at two kerbs, and the card
 * says "+1 more" while two whole lines are missing. One unit on both sides of the subtraction, or the
 * affordance lies.
 *
 * @spec stop-card#stopCardView
 */
export function stopCardView(input: StopCardInput, opts: StopCardOptions): StopCardView {
  const policy = opts.policy ?? CLIENT_POLICY_DEFAULTS
  const lines = soonestPerLine(input.etas)
  const shown = lines.slice(0, policy.maxRows)
  const total = input.routeCount ?? lines.length
  return {
    stopId: input.stop.id,
    name: displayName(input.stop.name[opts.locale]),
    caption: stopCardCaption(input.distanceM, input.stop.bearingDeg, opts.locale),
    bearingDeg: input.stop.bearingDeg,
    rows: shown.map((eta) => stopCardRow(eta, opts.locale, opts.now, policy)),
    remaining: Math.max(0, total - shown.length),
  }
}

/**
 * One reading per rider line, in the order they arrived — the compact card's row unit.
 *
 * **First wins, and that is not laziness: it is the same assumption the cap already makes.** The cap
 * takes the first `maxRows` readings, so every producer of this list serves it soonest-first —
 * `/v1/nearby`'s schema says so, `stopArrivals` sorts, `applyLiveEtasToNearby` sorts, and Favourites
 * sorts before it calls. Keeping the first sighting therefore keeps the soonest bus of the line, and
 * doing it by parsing timestamps here would add a second answer to a question this module has already
 * answered once.
 *
 * Not `dedupeEtas`: that rule is the *wire's* unit (a line at one pole) and this is the *card's* (a
 * line at this place). They agree on the line and differ on the kerb, deliberately, so calling either
 * one from the other would erase the distinction WP5-9 exists to draw.
 */
function soonestPerLine(etas: readonly Eta[]): Eta[] {
  const byLine = new Map<string, Eta>()
  for (const eta of etas) {
    const line = etaLineKey(eta)
    if (!byLine.has(line)) byLine.set(line, eta)
  }
  return [...byLine.values()]
}

/**
 * A stop name, ready to display: title-cased, with the operator's own pole code split off.
 *
 * Two operations in a fixed order, and the order is the rule — `titleCaseName` runs on the label
 * *after* the code is removed, so a code like `ST311` is never lower-cased on its way through. Doing
 * it the other way round produces "St311", which is the kind of difference that survives review.
 *
 * The single declaration of how a bus-stop name is rendered anywhere in the product (ADR-034). It had
 * been inside `components/StopName.tsx`, where the route screen and the search screen each reached it
 * only by rendering that component — so a second renderer had to reimplement it, and any caller that
 * wanted the label without the JSX reimplemented it too.
 *
 * @spec stop-card#displayName
 */
export function displayName(name: string): StopCardName {
  const { label, code } = splitStopCode(name)
  return { label: titleCaseName(label), code }
}

/**
 * The caption under a stop name: compass direction, then distance · walk.
 *
 * Two different separators, and they are not interchangeable. `' · '` joins distance to its walk time
 * because they are two readings of one thing; `'  ·  '` — wider — separates the direction from that
 * pair, because they are different kinds of fact. A renderer re-deriving this would have got a
 * plausible caption with the wrong rhythm, and nothing would have failed.
 *
 * Either part may be absent: a lone stop has no mean bearing (ADR-042), and Favourites shows no
 * distance. Both absent yields `''`, which is the signal to draw no caption line at all.
 *
 * @spec stop-card#stopCardCaption
 */
export function stopCardCaption(
  distanceM: number | undefined,
  bearingDeg: number | undefined,
  locale: Locale,
): string {
  const parts: string[] = []
  if (bearingDeg !== undefined) parts.push(formatBearing(bearingDeg, locale))
  if (distanceM !== undefined)
    parts.push(`${formatDistance(distanceM)} · ${formatWalk(distanceM, locale)}`)
  return parts.join('  ·  ')
}

/** One route row. Not exported: it is `stopCardView`'s inner loop, and a caller that wanted a single
 *  row would be re-implementing the cap that gives rows their meaning. Its behaviour is pinned
 *  through `stopCardView`'s corpus group, where the rows appear in context. */
function stopCardRow(
  eta: Eta,
  locale: Locale,
  now: number,
  policy: NonNullable<StopCardOptions['policy']>,
): StopCardRow {
  // **Blank collapses to absent, and that is load-bearing rather than tidy.** Upstream really does
  // send an empty `en` — this package carries required corpus rows for it — and every decision below
  // was written as a truthiness test in JSX, so `''` behaved as "no destination" and fell through to
  // the remark. Comparing against `undefined` instead would silently change that on a real feed.
  const destination = eta.destination?.[locale] || undefined
  const remark = remarkView(eta.remark, locale, eta.remarkKind)
  // The destination is title-cased; a remark standing in for one is not. Not an oversight: stop and
  // place names arrive ALL-CAPS from the operators and `titleCaseName` exists to repair them, whereas
  // a remark is already prose the operator wrote for a rider to read.
  const headline = destination === undefined ? remark?.text : titleCaseName(destination)
  return {
    routeId: eta.routeId,
    operator: eta.operator,
    routeNo: parseRouteId(eta.routeId)?.routeNo ?? eta.routeId,
    headline,
    // Its own line only when it is not already the headline — otherwise the same words print twice.
    remark: destination === undefined ? undefined : remark,
    ...etaReadout(eta, locale, now, policy),
  }
}

/**
 * Nearby's list: every stop card, nearest first.
 *
 * The sort is a rule, not a formality. The wire does not promise an order — `/v1/nearby`'s schema
 * describes `distanceM` and says nothing about sequence — so a renderer that iterated the response as
 * received would produce a *different list* from this one, and only sometimes. That is the failure
 * mode a byte-identity check is for, and the reason the ordering had to leave the screen.
 *
 * Sorted on a copy: the response belongs to the query cache, and sorting it in place mutates a value
 * other observers hold.
 *
 * @spec stop-card#nearbyView
 */
export function nearbyView(stops: readonly NearbyStop[], opts: StopCardOptions): StopCardView[] {
  return [...stops].sort((a, b) => a.distanceM - b.distanceM).map((n) => stopCardView(n, opts))
}
