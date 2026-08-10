import {
  type EtaLabelParts,
  type EtaUrgency,
  estimateChildFare,
  estimateElderlyFare,
  etaLabelParts,
  etaUrgency,
  etaView,
  fareRange,
  fareStages,
  formatFare,
  formatFareRange,
  formatHeadway,
  formatJourney,
  formatServiceHours,
  isStale,
} from './eta'
import { formatDistance, routeDistanceM } from './geo'
import { formatFavoriteRouteKey, memberStopIds } from './ids'
import { CLIENT_POLICY_DEFAULTS } from './policy'
import { type BusMarker, inferBusMarkers } from './route-position'
import { displayName, type StopCardName } from './stop-card'
import { isCircular, splitStopCode, stripCircular, titleCaseName } from './stop-name'
import type {
  Eta,
  EtaReport,
  FreqPattern,
  I18nText,
  Locale,
  OperatorId,
  ResolvedClientPolicy,
  RouteDetail,
  RouteServiceInfo,
  ServiceDayType,
} from './types'

// The rules the route-detail screen used to hold inline. They are judgements about what a rider is
// told — which arrivals count, which bus is worth a token, what the two ends of a route are called —
// so they are the kind of thing that has to be hand-ported to Swift and Kotlin rather than generated
// from a schema (ADR-052 context, kind 2). Living in a `.tsx` file made them invisible to every
// platform but this one.
//
// `@spec <module>#<export>` below means: that export's behaviour is pinned by the language-neutral
// JSON corpus at `../spec/<module>.spec.json`, group `<export>`. Change a rule and you edit the
// corpus; every platform's suite then goes red until it has been ported.
// `scripts/check-spec-coverage.mjs` fails a tagged export with no corpus **and** a corpus with no tag.

/**
 * Does a route-sequence stop id refer to the stop we opened this route from?
 *
 * `memberStopIds` handles a merged same-kerb place id (`P:<a>+<b>+…`, any number of members) by
 * yielding its poles, and a lone pole id by yielding itself — so there is no place/pole branch
 * here at all. Grammar: `@nextbus/core/ids`.
 *
 * @spec route-detail#isOriginStop
 */
export function isOriginStop(routeStopId: string, origin?: string): boolean {
  if (!origin) return false
  return memberStopIds(origin).includes(routeStopId)
}

/**
 * Upcoming (not-yet-departed) arrivals at a stop, capped at `maxArrivals`.
 *
 * Order is the feed's, not ours: the operators publish soonest-first and the rest of the app
 * (`dedupeEtas`, the soonest-arrival scan behind the bus tokens) already reads `arrivals[0]` as the
 * next bus. Sorting here would hide a feed that had stopped doing that from the one place a rider
 * would notice it.
 *
 * The cap is the served `ClientPolicy.maxArrivals` (ADR-053), defaulting to the shipped value. It was
 * a module constant here until Wave 3, which was already one improvement on the `.slice(0, 3)` that
 * lived in the screen — but it still meant the number could only change in a store release, while two
 * other screens answered the same question differently.
 *
 * @spec route-detail#upcoming
 */
export function upcoming(
  arrivals: string[] | undefined,
  now: number,
  maxArrivals: number = CLIENT_POLICY_DEFAULTS.maxArrivals,
): string[] {
  return (arrivals ?? []).filter((a) => !etaView(a, now).hasDeparted).slice(0, maxArrivals)
}

/**
 * How soon a bus at the origin must be leaving before it earns a token on the rail.
 *
 * Every journey on this route starts at stop 0, so the origin *always* has a bus sitting on it —
 * the feed reports the next departure long before anyone boards it. Drawn faithfully, that is a
 * token permanently parked on the first node: not information, just furniture, and worse, it reads
 * as a bus the rider could catch. Two minutes is the point at which "there is a bus at the
 * terminus" turns into "a bus is about to leave", which is the only version of the fact a rider can
 * act on. It is a judgement about honest presentation (ADR-008), not a property of the data, so it
 * is named and pinned rather than inlined as a constant nobody can find.
 */
export const ORIGIN_BUS_DEPARTS_WITHIN_SEC = 120

/**
 * The markers worth drawing on the rail: every inferred bus except one still parked at the origin.
 *
 * `markers` and `soonest` must be the same pair passed to `inferBusMarkers` — the suppression reads
 * stop 0's arrival to decide about stop 0's marker, so two different arrays would let the rail show
 * a bus judged against somebody else's clock reading.
 *
 * A marker at index 0 with **no** arrival behind it cannot come out of `inferBusMarkers` (it only
 * emits a marker where a live reading exists), but it is suppressed anyway: there is no departure
 * time, so there is nothing to be within two minutes of, and inventing a token from an absent
 * reading is the failure this whole rule is about.
 *
 * @spec route-detail#visibleBusMarkers
 */
export function visibleBusMarkers(
  markers: BusMarker[],
  soonest: Array<string | null>,
  now: number,
): BusMarker[] {
  return markers.filter((m) => {
    if (m.toIndex !== 0) return true
    const first = soonest[0]
    if (!first) return false
    return etaView(first, now).seconds <= ORIGIN_BUS_DEPARTS_WITHIN_SEC
  })
}

/** A route's own end labels, as the payload carries them. Structural, so a `Route` satisfies it. */
export interface RouteEnds {
  origin: I18nText
  destination: I18nText
}

/**
 * The far end of a route as the header should announce it: a terminus to name, or a loop to
 * describe. A circular route has no second terminus — `via` is the turnaround place, and the caller
 * wraps it in its own words (`circularVia` in `@nextbus/i18n`), because the kernel holds no prose.
 */
export type RouteTerminus = { kind: 'terminus'; name: string } | { kind: 'circular'; via: string }

/** Both ends of a route, ready for the header card. `origin` is the boarding terminus. */
export interface RouteHeaderNames {
  origin: string
  destination: RouteTerminus
}

/** Full stop name, cleaned for display: the trailing operator stop code split off, title-cased. */
function cleanStopName(name: string): string {
  return titleCaseName(splitStopCode(name).label)
}

/**
 * The two ends of a route, for the header card.
 *
 * Prefers the **stop list's** first and last names over the route's own `origin`/`destination`
 * labels: upstream abbreviates those to fit an LED sign ("CENTRAL (EXCHANGE SQ)" becomes "CENTRAL"),
 * so the stop names are the richer, truer answer whenever the sequence has loaded. The route labels
 * are the fallback that keeps the header from flashing empty on the way there — and both are
 * title-cased, but only a *stop* name has a code to split off, which is why they are cleaned
 * differently.
 *
 * Circular routes loop back to where they started, so the first and last stops are the same place
 * and a faithful "A → A" tells the rider nothing. The loop is flagged in the destination name
 * itself, HK-style ("TAI KOK TSUI (CIRCULAR)" / "大角咀(循環線)"), so we detect it there and hand
 * back the turnaround place for a "Circular via …" line instead (ADR-046).
 *
 * The marker is read from the **English** name whatever the display locale, because it is the one
 * field the three feeds spell consistently. That is a real exposure, not a tidy assumption: upstream
 * ships GMB circulars with a blank `en`, and the corpus pins what the rider then sees.
 *
 * @spec route-detail#routeTerminusNames
 */
export function routeTerminusNames(
  stopNames: I18nText[],
  route: RouteEnds | undefined,
  locale: Locale,
): RouteHeaderNames {
  const first = stopNames[0]
  const last = stopNames[stopNames.length - 1]
  const origin = first
    ? cleanStopName(first[locale])
    : route
      ? titleCaseName(route.origin[locale])
      : ''
  if (route && isCircular(route.destination.en))
    return {
      origin,
      destination: {
        kind: 'circular',
        via: titleCaseName(stripCircular(route.destination[locale])),
      },
    }
  const name = last
    ? cleanStopName(last[locale])
    : route
      ? titleCaseName(route.destination[locale])
      : ''
  return { origin, destination: { kind: 'terminus', name } }
}

// ── The whole screen, in one call (WP6-6) ──────────────────────────────────────────────────────
//
// Everything above is a *rule*; `routeDetailView` is the **composition** of those rules into the thing a
// renderer draws — the same move WP4-0 made for `stopCardView`, WP6-3a for `placeDetailView` and WP6-5a for
// `searchView`, and for the same reason: until now the composition lived in `apps/mobile/app/route/[id].tsx`
// and two leaf components, reachable only by rendering a React tree, so a second renderer could only
// re-implement it and a re-implementation looks right on the day it is written.
//
// **Sixteen decisions, which is the most any screen in this app has held.** `proposals/04` picked Place
// detail as *"the most domain rules in the app"* and Place detail had nine; this screen has:
//
//   1. which row is the boarding anchor — and that a direction flip **drops** it, because the reverse
//      serves the opposite kerbs and the stop the rider arrived at is not on it;
//   2. each row's soonest *upcoming* arrival, which is what the bus inference is fed;
//   3. which inferred buses earn a token (`visibleBusMarkers` over that same array);
//   4. **where each token sits** — on a node, or midway along the segment leading into one — including the
//      rule that an origin bus is always on the node, because stop 0 has no segment leading into it;
//   5. the sectional fare span across the boarding stops;
//   6. which rows are the rider's saved routes *at that pole*;
//   7. what the two ends of the route are called, and whether it is a loop;
//   8. what the header reads at rest and once collapsed — two compositions that lived in `RouteHeader`;
//   9. each row's display name, code split off and title-cased;
//  10. each row's arrivals, capped by served policy, with their readouts;
//  11. first/last, which decide whether the rail draws a connector above or below;
//  12. the straight-line route distance;
//  13. the tapped stop's name for the action sheet — which was `titleCaseName(splitStopCode(…).label)`, a
//      **second spelling of `displayName`'s answer in the same file** (see `RouteStopRowView.name`);
//  14. which static facts exist, in what order, and the fare's fallback from a span to the origin fare;
//  15. whether a reverse direction exists at all, which is the toggle's whole existence;
//  16. what a bus token is *called* — see `RailBus.label`, which is the finding this row turned up.
//
// **Words the kernel composes with are injected, never imported** (ADR-054: core owns the rule, i18n owns
// the word) — the same shape `PlaceDetailLabels` uses.

/** Which static fact a pill carries. `stops` is a navigation affordance, never a sheet (ADR-044). */
export type RouteFactKey = 'fare' | 'freq' | 'hours' | 'stops'

/** One pill in the static-facts strip: the fact it names, its value, and an optional qualifier. */
export interface RouteFact {
  key: RouteFactKey
  /** Ready to print — "$13.4 → $6.9", "every 10 – 25 min", "05:30 – 00:15", "24 stops". */
  value: string
  /** The holiday fare, where upstream publishes a different one. Never a second pill. */
  note?: string
}

/** One arrival slot on a stop row. */
export interface RouteStopArrival {
  /**
   * The arrival's own timestamp. **Never displayed** — it is the identity a renderer keys the slot on, so
   * a bus keeps its place when the round refreshes rather than the third time sliding into the first
   * slot's box. The RN row already keyed on it; declaring it here is what stops the DOM row keying on an
   * array index and getting a different animation for the same data.
   */
  iso: string
  /** The figure and its unit, or the status word — never a fabricated sub-minute number (ADR-008). */
  label: EtaLabelParts
  /** What it means. A renderer maps this to its own colour system; it is never a colour. */
  urgency: EtaUrgency
  /** Old enough to say so. Shared by every slot on the row, because staleness is the *board's*. */
  stale: boolean
}

/** One stop on the vertical schematic. */
export interface RouteStopRowView {
  seq: number
  /**
   * The **raw** pole id this row names — the key a favourite is saved under (ADR-042), the target of
   * `?pole=` when the rider opens the place, and the id `saved` was tested against.
   */
  stopId: string
  /**
   * The stop's name, title-cased with its printed code split off (ADR-034).
   *
   * `name.label` is also what the action sheet's title is: the RN screen computed that separately as
   * `titleCaseName(splitStopCode(s.stop.name[locale]).label)`, which is `displayName`'s definition
   * inlined — one answer written twice, eleven lines apart, in the file that also passed the *other*
   * spelling to the row. Neither was wrong; that is precisely the problem, because the day one of them
   * grows a rule the other does not is the day the sheet and the row disagree about a stop's name.
   */
  name: StopCardName
  /** Up to `policy.maxArrivals` upcoming readouts, soonest first. Empty when there is no reading. */
  arrivals: RouteStopArrival[]
  /**
   * Boarding fare here, HK$ decimal string, **as the wire carries it** — compared, never displayed.
   *
   * Two fields for one thing, and each has a job the other cannot do: `fareStages` groups contiguous runs
   * by comparing this value, so it must stay the raw decimal, while `fareLabel` is what a rider reads. It is
   * the same split `RouteStopArrival` makes between `iso` (an identity) and `label` (a reading), and the
   * same one `poleNameKey` makes with its *"compared, never displayed"*.
   */
  fare?: string
  /**
   * The printed fare, `$` and all — `formatFare`'s answer.
   *
   * The prefix is a composition, and a composition is exactly what the kernel owns: `RouteFact.value`
   * already arrives formatted for the same reason. It also makes the row projectable, which the raw value is
   * not: a spec cannot express `formatFare`, so a projection reading `fare` would expect `18.9` where every
   * renderer draws `$18.9` — a divergence the spec would report against both of them.
   */
  fareLabel?: string
  /** The stop the rider opened this route from, so the row is emphasised and scrolled to. */
  here: boolean
  /** First / last in the sequence — which rail connectors this row draws. */
  first: boolean
  last: boolean
  /** This route, saved at this pole (ADR-042) — the node gets a star. */
  saved: boolean
  /**
   * **We could not ask about this kerb** — so an empty `arrivals` here is not "no bus due" (ADR-116).
   *
   * Absent in every case but one: a live route watch asks each of the route's 13–41 poles separately, so
   * one board can refuse while the rest answer, and `applyLiveEtasToRouteDetail` puts that pole in the
   * payload's `failed`. The server never populates it — a route is fetched in one upstream call, which is
   * what `liveArrivals` says once for the whole screen — so on an HTTP-only render this is always absent.
   *
   * A row and not the screen, deliberately: `liveArrivals` cannot express "38 of 41 answered" and would
   * have to choose between claiming the screen has no times (false for 38 rows) and saying nothing (false
   * for 3). It is the same distinction `StopCardView.incomplete` (ADR-077) and `routeStopBoard`'s
   * `incomplete` (ADR-115) already draw, at the one granularity a live round actually has.
   */
  incomplete?: boolean
}

/**
 * A bus on the rail, positioned by stop index rather than by pixel.
 *
 * **Which node a bus is at is content; where that node is on screen is geometry.** That line is what
 * lets one declaration serve a 52 px RN rail and a DOM list whose rows measure themselves: the kernel
 * says *"between stops 7 and 8"* and each renderer turns that into a y.
 */
export type RailBus =
  | {
      kind: 'node'
      /** The stop it is standing at. */
      index: number
      label: string
    }
  | {
      kind: 'segment'
      /** The stop behind it and the stop ahead — it is drawn midway between their nodes. */
      from: number
      to: number
      label: string
    }

/**
 * What the collapsing header announces, at both of its sizes.
 *
 * Both label strings are composed **here** rather than in the header component, and the reason is the
 * one this repo keeps re-learning: a `→` between two names is a composition, and the RN header held two
 * of them (`${origin} → ${destination}` at rest, `→ ${destination}` collapsed) with a circular branch
 * over each. A second renderer would have arrived at four plausible variants of two strings.
 */
export interface RouteJourneyHeader {
  operator: OperatorId
  routeNo: string
  /** The boarding terminus, title-cased. */
  origin: string
  /** The far end, as a finished sentence: a terminus name, or the caller's "Circular via …" line. */
  destination: string
  /** A loop: no second terminus to name, and no direction toggle (ADR-046). */
  circular: boolean
  /** What the header reads at rest. */
  label: string
  /** …and once collapsed, where one line fits. */
  collapsedLabel: string
  /**
   * The opposite direction's route id, where the dataset carries one.
   *
   * Absent **is** the answer to "should there be a toggle" — the RN screen spelled that
   * `canReverse={!!reverse}` beside a separate `flip` closure reading the id, so the control's existence
   * and the id it navigates to were two facts a renderer could get out of step. One field, and a renderer
   * that has nothing to flip to draws nothing.
   */
  reverseId?: string
}

/**
 * One board's readings, as row slots — the **one** place a route arrival is turned into text.
 *
 * Private on purpose and shared by two callers: every stop row on the schematic, and the board the action
 * sheet fetches on demand for a single stop (`routeStopBoard`). The sheet's own docblock records what
 * happens when this sort of thing is written twice — `displayName` was inlined eleven lines from its own
 * call and the sheet and the row could have disagreed about a stop's *name*. A time is worse: they would
 * disagree about a bus.
 *
 * Staleness is the **board's**, not the arrival's: one `dataTimestamp` per board, so every slot dims
 * together. A per-slot answer would make the third time look fresher than the first.
 */
function arrivalsFrom(
  eta: Eta | null | undefined,
  now: number,
  locale: Locale,
  policy: ResolvedClientPolicy,
): RouteStopArrival[] {
  const stale = eta ? isStale(eta, now, policy.staleAfterMs) : false
  return upcoming(eta?.arrivals, now, policy.maxArrivals).map((iso) => ({
    iso,
    label: etaLabelParts(iso, now, locale, policy.dueUnderSec),
    urgency: etaUrgency(iso, now, policy),
    stale,
  }))
}

/**
 * This route's next arrivals at **one** pole, read out of that pole's own board.
 *
 * The Route screen shows per-stop times for KMB and LWB only, because those are the operators with a bulk
 * route-eta feed; on Citybus and GMB `liveArrivals` is `perStopOnly` and every row is blank (ADR-114). Their
 * *per-pole* boards answer perfectly well though, so a rider who taps one stop can be told about that stop —
 * which is what the action sheet does, for the cost of one call about the thing they just asked about.
 *
 * Three decisions, and they are here rather than in a renderer because two renderers would answer the third
 * one differently:
 *
 *  1. **The formatting is the row's**, via `arrivalsFrom`, so a time in the sheet reads exactly as it would
 *     in the list.
 *  2. **`incomplete` is `failed`'s**, not an empty list's. A pole whose board did not answer has no readings
 *     *and* nothing due, and those are different sentences (ADR-077). Without this the sheet would say "no
 *     bus due" about a board that refused us — the same conflation ADR-114 just removed one level up.
 *  3. **Which reading belongs to this pole.** A board is requested for a pole and the server may resolve
 *     that id to a *place* whose alias table promotes it (ADR-042), so a report can carry two readings for
 *     one route at two kerbs — and on a schematic those are different rows. So: the reading whose `stopId`
 *     matches exactly, or — when the route has exactly one reading in the report — that one, because a
 *     single reading is unambiguously the answer to the question we asked. Never a guess between two.
 *
 * @spec route-detail#routeStopBoard
 */
export function routeStopBoard(
  report: EtaReport | undefined,
  opts: {
    poleId: string
    routeId: string
    now: number
    locale: Locale
    policy?: ResolvedClientPolicy
  },
): { arrivals: RouteStopArrival[]; incomplete: boolean } {
  const policy = opts.policy ?? CLIENT_POLICY_DEFAULTS
  if (report === undefined) return { arrivals: [], incomplete: false }
  const forRoute = report.etas.filter((e) => e.routeId === opts.routeId)
  const exact = forRoute.find((e) => e.stopId === opts.poleId)
  const only = forRoute.length === 1 ? forRoute[0] : undefined
  const eta = exact ?? only
  return {
    arrivals: arrivalsFrom(eta, opts.now, opts.locale, policy),
    // Named for the pole we asked about, so a place-wide failure list does not make one kerb's silence
    // look like an outage at another.
    incomplete: (report.failed ?? []).some((f) => f.stopId === opts.poleId),
  }
}

/** What a renderer needs to draw the Route screen, with nothing left to decide. */
export interface RouteDetailView {
  header: RouteJourneyHeader
  /** The static-facts strip, in pill order. Empty when the payload carries no service block at all. */
  facts: RouteFact[]
  /** The schematic, in sequence order. */
  stops: RouteStopRowView[]
  /** The buses on the rail, in route order. */
  buses: RailBus[]
  /**
   * Where the boarding row is, or `-1`.
   *
   * A renderer needs the index and not only the row's own `here` flag, because the *second beat* of
   * ADR-043's reveal is a scroll to it — and "which row to scroll to" is a question about the list, not
   * about a row. `-1` is the ordinary state, not an error: the screen is reachable from search, from a
   * saved route and from a deep link, and it is also what a **flip** produces.
   */
  hereIndex: number
  /**
   * Straight-line-through-stops distance in metres, `0` when the sequence is too short to have one.
   *
   * Explicitly an estimate — there are no polylines upstream (ADR-044) — and it is the kernel's because
   * the alternative is two renderers summing the same haversines in two languages.
   */
  distanceM: number
  /**
   * Whether the per-stop readings on this schematic are a complete answer, and if not, why not (ADR-114).
   *
   * **`'answered'` where the wire says nothing**, which is the one piece of work this field does rather
   * than merely restating `RouteDetail.liveArrivals`: the wire omits the field when there is nothing to
   * report (the convention `failed` set — *"every board answered" and "we have nothing to say" should not
   * be the same bytes*), and a spec's `oneOf` discriminant has to be **total** or it throws. Turning
   * absence into a named arm here is what lets `route-detail.spec.json` declare all three.
   *
   * Every stop having `eta: null` is not a statement that no bus is due — it is also what a route nobody
   * asked about looks like, and telling those apart is the whole of this field. A renderer says it **once
   * for the screen**, never per row: a rider cannot act on *which* rows, and 34 copies of one sentence is
   * not more honest than one.
   */
  liveArrivals: 'answered' | 'unavailable' | 'perStopOnly'
}

/** The words this view composes with, supplied by the caller's catalogue. */
export interface RouteDetailLabels {
  /** The whole "N stops" phrase, not the noun — the plural rule is the catalogue's (ADR-054). */
  stopCount: (n: number) => string
  /** The qualifier on a holiday fare, e.g. "hol". */
  holiday: string
  /** The whole circular-destination line, given the turnaround place. */
  circularVia: (place: string) => string
  /**
   * What a bus token is called, given the stop it is heading to.
   *
   * **This label is the finding of WP6-6, and it came out of the spec format rather than out of the
   * screen.** A component spec's vocabulary is *text*; a bus token is a disc with a glyph in it, so the
   * conformance walker cannot see one at all. The honest fix is not to exempt the tokens — it is that a
   * graphic carrying information a rider acts on needs an accessible name, which ADR-075 puts squarely on
   * the identity side (*"every element's role and its label content"*). `BusToken` had none:
   * `pointerEvents` is `none`, there is no `accessibilityLabel`, and the screen's signature element was
   * invisible to a screen reader. Naming it makes it projectable *and* closes the accessibility hole,
   * which is the same fix.
   */
  busApproaching: (stop: string) => string
  /** …and the same for one standing at a stop, which is a different fact and a different sentence. */
  busAtStop: (stop: string) => string
}

export interface RouteDetailOptions {
  locale: Locale
  /** The clock, as an explicit argument — every readout below is derived against it. */
  now: number
  policy?: ResolvedClientPolicy
  labels: RouteDetailLabels
  /**
   * The stop the rider opened this route from, if any. May be a merged `P:` place id, in which case any
   * of its poles anchors the screen (`isOriginStop`).
   */
  arrivedFromStop?: string
  /**
   * True once the rider has flipped direction, which **drops the anchor**.
   *
   * A separate flag rather than "did `arrivedFromStop` match anything", because the two are different
   * facts and the difference is visible: a route whose reverse happens to serve the same pole would
   * otherwise keep an anchor that no longer means what it meant. Once flipped, the stop the rider
   * arrived at belongs to the direction they left.
   */
  flipped?: boolean
  /** The rider's saved route-at-stop keys, verbatim from the store. */
  savedRouteKeys?: readonly string[]
}

/**
 * The Route screen's content, derived once.
 *
 * @spec route-detail#routeDetailView
 */
export function routeDetailView(detail: RouteDetail, opts: RouteDetailOptions): RouteDetailView {
  const { locale, now, labels } = opts
  const policy = opts.policy ?? CLIENT_POLICY_DEFAULTS
  const { route, stops } = detail

  const ends = routeTerminusNames(
    stops.map((s) => s.stop.name),
    route,
    locale,
  )
  // Narrowed on the union itself rather than on a `circular` boolean, so the two cannot drift apart: the
  // flag and the sentence are read from one discriminant.
  const far = ends.destination
  const circular = far.kind === 'circular'
  const destination = far.kind === 'circular' ? labels.circularVia(far.via) : far.name

  // The anchor, and the flip that drops it. `-1` for "no anchor" is the value the reveal's second beat
  // already tests against, kept rather than an `undefined` a renderer would have to remember to check.
  const hereIndex =
    opts.flipped === true
      ? -1
      : stops.findIndex((s) => isOriginStop(s.stop.id, opts.arrivedFromStop))

  const saved = new Set(opts.savedRouteKeys ?? [])
  // The kerbs the round could not ask about, as a set, so a 41-row walk is not 41 array scans. Read from
  // the payload rather than passed in as an option: it arrives on the same document the readings do, which
  // is what keeps a failure from outliving the round that produced it (`applyLiveEtasToRouteDetail`).
  const refused = new Set((detail.failed ?? []).map((f) => f.stopId))
  const rows: RouteStopRowView[] = stops.map((s, i) => {
    return {
      seq: s.seq,
      stopId: s.stop.id,
      name: displayName(s.stop.name[locale]),
      arrivals: arrivalsFrom(s.eta, now, locale, policy),
      ...(s.fare === undefined ? {} : { fare: s.fare, fareLabel: formatFare(s.fare) }),
      here: i === hereIndex,
      first: i === 0,
      last: i === stops.length - 1,
      saved: saved.has(formatFavoriteRouteKey(s.stop.id, route.id)),
      // Only when true, so an HTTP-only render is byte-identical to what it always was — which is what the
      // 18 existing corpus rows and both renderers' 19 projected states are measured against.
      ...(refused.has(s.stop.id) ? { incomplete: true } : {}),
    }
  })

  // The bus inference and its suppression read the **same** array, which is `visibleBusMarkers`' own
  // documented requirement: two different arrays would let the rail show a bus judged against somebody
  // else's clock reading. Composing them here is what makes that unrestatable.
  const soonest = stops.map((s) => upcoming(s.eta?.arrivals, now, policy.maxArrivals)[0] ?? null)
  const byTarget = new Map(
    visibleBusMarkers(inferBusMarkers(soonest, now), soonest, now).map((m) => [m.toIndex, m]),
  )
  // Walked over the **rows** rather than over the markers, which is what puts the tokens in route order
  // and — the reason it is written this way — leaves no dead branch. Mapping the markers instead needs a
  // `rows[m.toIndex] === undefined` guard to get a name to label the token with, and that arm is
  // unreachable by construction: `inferBusMarkers` only ever emits an index of the array it was handed.
  // The 100 % branch threshold refuses an unreachable arm, correctly — it is the same finding as
  // WP6-3a's `?? []`, and the same shape fixes it, because here "no marker for this row" is the
  // ordinary case.
  const buses = rows.flatMap((row, i) => {
    const marker = byTarget.get(i)
    return marker === undefined ? [] : [railBus(marker, row.name.label, labels)]
  })

  return {
    header: {
      operator: route.operator,
      routeNo: route.routeNo,
      origin: ends.origin,
      destination,
      circular,
      // A loop's far end is already a sentence about the whole journey ("Circular via Tai Kok Tsui"), so
      // pointing an arrow at it would read as travelling *to* the loop rather than around it.
      label: circular ? destination : `${ends.origin} ${JOURNEY_ARROW} ${destination}`,
      collapsedLabel: circular ? destination : `${JOURNEY_ARROW} ${destination}`,
      ...(detail.reverse === undefined ? {} : { reverseId: detail.reverse.id }),
    },
    facts: routeFacts(route.service, stops, locale, labels),
    stops: rows,
    buses,
    hereIndex,
    distanceM: routeDistanceM(stops.map((s) => s.stop.location)),
    // Absence is an answer here and it is the *good* one — see the field's own note. `?? 'answered'` is
    // therefore not a defensive default; it is the wire's convention being read.
    liveArrivals: detail.liveArrivals ?? 'answered',
  }
}

/**
 * The glyph between two ends of a journey.
 *
 * A direction marker rather than a word, so it is not in the catalogue — the same literal `StopRow` and
 * Search's route rows use. It is a constant here because both header labels contain it and the two must
 * agree: the collapsed label is the resting one with its origin removed, and nothing else.
 */
const JOURNEY_ARROW = '→'

/**
 * A marker, placed and named.
 *
 * The **origin exception** is the one rule here a renderer would plausibly get wrong, and the RN screen
 * spelled it `m.atStop || m.toIndex === 0`: stop 0 has no segment leading into it, so a bus heading to it
 * has nowhere to be but on the node. `visibleBusMarkers` has already decided *whether* an origin bus is
 * drawn at all (it must be nearly leaving — `ORIGIN_BUS_DEPARTS_WITHIN_SEC`); this decides only where the
 * one that survived goes.
 */
function railBus(marker: BusMarker, name: string, labels: RouteDetailLabels): RailBus {
  if (marker.atStop || marker.toIndex === 0) {
    return { kind: 'node', index: marker.toIndex, label: labels.busAtStop(name) }
  }
  return {
    kind: 'segment',
    from: marker.toIndex - 1,
    to: marker.toIndex,
    label: labels.busApproaching(name),
  }
}

/**
 * The static-facts strip: fare · frequency · hours · stop count, in that order, skipping what the
 * dataset does not carry (ADR-036, the **Static** honesty tier).
 *
 * Three decisions that were inside `RouteMeta.tsx`, where a second renderer would have had to find them:
 *
 *  · **the fare falls back from the sectional span to the origin's full fare.** A route whose stops carry
 *    no per-stop fares still has one number worth printing, and the span is framed dearest → cheapest
 *    because boarding later costs less — `formatFareRange`'s own rule;
 *  · **the holiday fare is a note on the fare pill, never a pill of its own**, and only where upstream
 *    published a different one;
 *  · **no service block at all means no strip**, which is a real state: the dataset has routes with no
 *    service facts and a strip of nothing is furniture.
 *
 * Whole-route journey time is deliberately absent (`service.journeyMin` exists): it is an origin→terminus
 * figure with little to say to a rider boarding mid-route, and it is shown in the overview sheet instead.
 */
function routeFacts(
  service: RouteServiceInfo | undefined,
  stops: RouteDetail['stops'],
  locale: Locale,
  labels: RouteDetailLabels,
): RouteFact[] {
  if (service === undefined) return []
  const span = fareRange(stops.map((s) => s.fare))
  const fare = span
    ? formatFareRange(span)
    : service.fareFull
      ? formatFare(service.fareFull)
      : undefined
  const facts: RouteFact[] = []
  if (fare !== undefined) {
    facts.push({
      key: 'fare',
      value: fare,
      ...(service.fareFullHoliday === undefined
        ? {}
        : { note: `${formatFare(service.fareFullHoliday)} ${labels.holiday}` }),
    })
  }
  if (service.headway !== undefined) {
    facts.push({ key: 'freq', value: formatHeadway(service.headway, locale) })
  }
  if (service.hours !== undefined) {
    facts.push({ key: 'hours', value: formatServiceHours(service.hours) })
  }
  // A route with **no stops** gets no count pill rather than a "0 stops" one, which is the RN strip's
  // behaviour (`if (stopCount)`) preserved: zero stops is a broken payload, and printing it as a fact
  // states a route length we do not believe.
  if (stops.length > 0) facts.push({ key: 'stops', value: labels.stopCount(stops.length) })
  return facts
}

// ── The four fact sheets (WP6-6c) ──────────────────────────────────────────────────────────────
//
// `routeDetailView` hoisted the *strip*; these are the four surfaces a pill opens (ADR-044), and they were
// the last derivation left on this screen — 397 lines of `RouteFactSheets.tsx`, and the reason that file was
// deliberately absent from `check-no-derivation`'s `POLICED` list until now.
//
// Eight decisions lived there, and the pattern is the wave's: each looks like formatting and each is a
// judgement about what a rider is told.

/** Which pill opened a sheet. The same four keys the strip carries, so a renderer switches once. */
export type RouteFactSheetKind = RouteFactKey

/** Which passenger class a concession figure is for. **A name, not a word** (ADR-054). */
export type ConcessionClass = 'child' | 'elderly'

/** Which whole-route figure a stat row states. A name, so the caller picks both word and glyph. */
export type RouteStatKind = 'stops' | 'journey' | 'distance'

/** One concession figure on a fare stage — an estimate, and printed as one. */
export interface ConcessionFigure {
  class: ConcessionClass
  /**
   * The figure, `~` and `$` included.
   *
   * **The tilde is part of the content, not a decoration a renderer adds.** These are policy-derived
   * estimates rather than route data (ADR-044), and ADR-008 forbids presenting an estimate as a reading —
   * so the mark that says so is composed here, where it cannot be dropped by one renderer.
   */
  fare: string
}

/** One step of the sectional fare, dearest first. */
export interface FareStageRow {
  /** The stops this price covers, 1-based and inclusive. `fromSeq` is also the row's identity. */
  fromSeq: number
  toSeq: number
  /** The adult fare, printed. */
  fare: string
  /** Where a rider boards to pay it — the stop's display name, the same one the schematic shows. */
  boardingStop: string
  /** How far the price carries them, e.g. "12 stops" — the caller's plural rule, the kernel's count. */
  covers: string
  /** The estimates for this price. **Empty where the fare cannot be parsed**, never zeroed. */
  concessions: ConcessionFigure[]
}

/** One whole-route figure behind the stop-count pill. */
export interface RouteStatRow {
  stat: RouteStatKind
  value: string
  /**
   * True where the figure is an explicit estimate, so a renderer must say so.
   *
   * The route distance is a straight-line sum through the stops — there are no polylines upstream — and the
   * journey time is the dataset's own origin→terminus figure. One is a guess and one is not, and a renderer
   * that treated them alike would either over- or under-claim. It is a flag rather than a `~` in the string
   * because the *caveat* is a whole sentence the catalogue owns, where the `~` on a concession fare is a
   * mark inside a figure.
   */
  estimate: boolean
}

/** One day's frequency bands. */
export interface FreqDayRow {
  /** What this day is called — a named type, or the running days composed from the mask. */
  day: string
  bands: Array<{
    /** The band's span, e.g. "07:00 – 09:30". */
    hours: string
    /** Its headway, e.g. "every 4 min". */
    headway: string
  }>
}

/** One day's first and last departure. */
export interface HoursDayRow {
  day: string
  first: string
  last: string
}

/** What a renderer needs to draw one fact sheet, with nothing left to decide. */
export type RouteFactSheetView =
  | {
      kind: 'fare'
      /** Dearest (origin) first, which is the order sectional fares step down in. */
      stages: FareStageRow[]
      /**
       * Which concession classes the legend explains, or empty for no legend at all.
       *
       * **Empty is a real state**: a GMB route whose fares upstream publishes as a non-numeric string has no
       * estimate to make, and a legend keyed to figures that are not on screen is worse than none. The RN
       * sheet spelled this `stages.some((st) => estimateChildFare(st.fare) && estimateElderlyFare(st.fare))`,
       * which is a decision about what a rider is shown rather than a formatting step.
       */
      concessions: ConcessionClass[]
    }
  | {
      kind: 'freq'
      /** Per day type, where the dataset carries a frequency table. */
      days: FreqDayRow[]
      /** The coarse range the pill shows, as the fallback when it does not. Absent when neither exists. */
      headway?: string
    }
  | {
      kind: 'hours'
      days: HoursDayRow[]
      /** The coarse span, as the fallback. Absent when neither exists. */
      span?: string
    }
  | { kind: 'stops'; stats: RouteStatRow[] }

/** The words this view composes with, supplied by the caller's catalogue. */
export interface RouteFactLabels {
  /** The whole "N stops" phrase — the plural rule is the catalogue's (ADR-054). */
  stopCount: (n: number) => string
  /**
   * The seven short day names, **Sunday first**, matching `FreqPattern.days`' documented order.
   *
   * A list rather than seven getters, because what the kernel does with them is **join a subset** — and that
   * join, separator and all, is the composition worth owning: the RN sheet did it with
   * `.map(...).filter(Boolean).join(' · ')`, which is three renderer decisions (which days, in what order,
   * with what between them) for one answer.
   */
  dayNames: readonly string[]
  /** A named day type, or the fallback for a mask that names none. */
  day: (kind: ServiceDayType | 'other') => string
}

// There is deliberately **no** `concession` label here, and the absence is the ADR-054 line drawn tightly: the
// kernel decides *which* passenger classes have a figure and *what that figure reads* (the `~` and the `$`),
// and it never joins their names to anything — so the word stays in each renderer's own table beside the glyph
// it belongs with. It was in this interface for one draft, unused, and `noUnusedFunctionParameters` said so.

export interface RouteFactSheetOptions {
  locale: Locale
  labels: RouteFactLabels
}

/**
 * One fact sheet's content, derived once.
 *
 * Takes the same `RouteDetail` payload the screen already has plus the view it already computed, because two
 * of the four sheets are about the **stop list** (the fare timeline's boarding names, the stop count) and two
 * are about the **service block**. Handing over the view rather than re-deriving from the payload is what
 * keeps the fare timeline naming its stages exactly as the schematic above it does — the failure WP6-6a found
 * when this file built a third list of its own.
 *
 * @spec route-detail#routeFactSheet
 */
export function routeFactSheet(
  kind: RouteFactSheetKind,
  view: RouteDetailView,
  service: RouteServiceInfo | undefined,
  opts: RouteFactSheetOptions,
): RouteFactSheetView {
  const { locale, labels } = opts
  if (kind === 'fare') return fareSheet(view, labels)
  if (kind === 'freq') return freqSheet(service, locale, labels)
  if (kind === 'hours') return hoursSheet(service, labels)
  return { kind: 'stops', stats: routeStats(view, service, locale) }
}

function fareSheet(view: RouteDetailView, labels: RouteFactLabels): RouteFactSheetView {
  // The **raw** fares, which is why `RouteStopRowView` keeps both: `fareStages` groups contiguous runs by
  // comparing the decimal, and `fareLabel` is what is printed.
  const rows = view.stops
  const byPosition = new Map(fareStages(rows.map((row) => row.fare)).map((s) => [s.fromSeq, s]))
  // **Walked over the rows, and the stage looked up by POSITION rather than by `seq`.** Two reasons, and the
  // second is a bug this shape closes. `fareStages` numbers its stages from the *array* it was handed
  // (`fromSeq` is `index + 1`), while a row's `seq` is what the **wire** numbered it — the two agree on every
  // payload seen so far and a route whose sequence did not start at 1 would make them differ, at which point
  // a `find` by `seq` would name no stop at all and the timeline would print blank headings. And walking the
  // rows leaves no dead branch: "this row does not start a stage" is the ordinary case, where a `find` with a
  // `?? ''` fallback has an arm no payload can reach — the same finding as WP6-3a's `?? []`.
  const stages = rows.flatMap((row, index) => {
    const stage = byPosition.get(index + 1)
    if (stage === undefined) return []
    return [
      {
        fromSeq: stage.fromSeq,
        toSeq: stage.toSeq,
        fare: formatFare(stage.fare),
        // The name from the row itself, so the timeline and the schematic cannot name one stop two ways.
        boardingStop: row.name.label,
        covers: labels.stopCount(stage.toSeq - stage.fromSeq + 1),
        concessions: concessionFigures(stage.fare),
      },
    ]
  })
  // The legend explains exactly the classes that appear, which is what makes it honest: a class with no
  // figure anywhere on screen has nothing to explain.
  const classes = new Set(stages.flatMap((stage) => stage.concessions.map((c) => c.class)))
  return {
    kind: 'fare',
    stages,
    concessions: CONCESSION_CLASSES.filter((klass) => classes.has(klass)),
  }
}

/** In legend order, which is the order the figures appear on a stage. */
const CONCESSION_CLASSES: readonly ConcessionClass[] = ['child', 'elderly']

/**
 * The two estimates for one adult fare, or an empty list where the fare cannot be priced.
 */
function concessionFigures(adultFare: string): ConcessionFigure[] {
  // `fareStages` admits this fare on a **looser** test than the estimators apply, so the earlier
  // both-always-resolve claim was wrong. `fareStages` keeps any `f` where `Number(f)` is not NaN — which
  // lets a whitespace-only cell (`Number(' ')` is 0) or an `Infinity`-valued string survive as a stage —
  // while `estimateChildFare`/`estimateElderlyFare` route through `parseFareOrUndefined`, which trims and
  // demands `Number.isFinite`. A per-stop `fare` is an unvalidated wire string (ADR-052 decision 2), so
  // those inputs are reachable, not hypothetical, and a cast to `string` would print the literal
  // `~$undefined`. Absent must stay absent (ADR-008): a stage we cannot price for a concession gets **no**
  // figure, which is exactly what `FareStageRow.concessions` documents. Both come from one parse, so it is
  // both-or-neither and the corpus's `[0, 2]`-per-stage property still holds — with `0` now reachable.
  const child = estimateChildFare(adultFare)
  const elderly = estimateElderlyFare(adultFare)
  if (child === undefined || elderly === undefined) return []
  return [
    { class: 'child', fare: `~${formatFare(child)}` },
    { class: 'elderly', fare: `~${formatFare(elderly)}` },
  ]
}

function freqSheet(
  service: RouteServiceInfo | undefined,
  locale: Locale,
  labels: RouteFactLabels,
): RouteFactSheetView {
  const days = (service?.patterns ?? []).map((pattern) => ({
    day: dayLabel(pattern, labels),
    bands: pattern.bands.map((band) => ({
      hours: formatServiceHours({ start: band.start, end: band.end }),
      // A band has one headway, not a range, so it is formatted as a degenerate range rather than with a
      // second rule — which is what keeps "every 4 min" here and "every 4 – 12 min" on the pill in one voice.
      headway: formatHeadway({ min: band.headwayMin, max: band.headwayMin }, locale),
    })),
  }))
  return {
    kind: 'freq',
    days,
    // The coarse range only where there is no table to show instead. Both absent is a real state: the pill
    // that opened this sheet exists on the stop count, so a route with no frequency data can still be here.
    ...(days.length > 0 || service?.headway === undefined
      ? {}
      : { headway: formatHeadway(service.headway, locale) }),
  }
}

function hoursSheet(
  service: RouteServiceInfo | undefined,
  labels: RouteFactLabels,
): RouteFactSheetView {
  const days = (service?.patterns ?? []).map((pattern) => ({
    day: dayLabel(pattern, labels),
    first: pattern.first,
    last: pattern.last,
  }))
  return {
    kind: 'hours',
    days,
    ...(days.length > 0 || service?.hours === undefined
      ? {}
      : { span: formatServiceHours(service.hours) }),
  }
}

/**
 * The whole-route figures, each present only where the dataset supports it.
 *
 * The stop count is always there (it is what the pill counted); the journey time only where upstream
 * published one; the distance only where the sequence had enough coordinates to have one. `journeyMin` of
 * zero is treated as absent, which is the RN sheet's `journeyMin ?` truthiness preserved: a route that
 * takes no time is a broken row, not a fast bus.
 */
function routeStats(
  view: RouteDetailView,
  service: RouteServiceInfo | undefined,
  locale: Locale,
): RouteStatRow[] {
  // The count is a **bare number** here, not "34 stops": the row beside it already says "Stops", where the
  // strip's pill has no label of its own and therefore carries the whole phrase. Same datum, two honest
  // readings — which is why `labels.stopCount` is not consulted on this sheet.
  const stats: RouteStatRow[] = [
    { stat: 'stops', value: String(view.stops.length), estimate: false },
  ]
  const journeyMin = service?.journeyMin
  if (journeyMin !== undefined && journeyMin > 0) {
    // `formatJourney` already carries its own "~" (or 約 / 约), because "about 62 min" is how the figure is
    // said rather than a caveat about it. `estimate` is still true: the *sentence* under it is the caveat.
    stats.push({ stat: 'journey', value: formatJourney(journeyMin, locale), estimate: true })
  }
  if (view.distanceM > 0) {
    stats.push({ stat: 'distance', value: `~${formatDistance(view.distanceM)}`, estimate: true })
  }
  return stats
}

/**
 * What a frequency or hours row calls its day.
 *
 * The four named types are a lookup; the fifth is the composition. `dayType: 'other'` means the dataset
 * carries a day mask that matches none of them, and the honest answer is to name the days it runs —
 * **Sunday-first, in the mask's own order, joined with the app's separator** — falling back to the generic
 * word only when the mask names nothing at all. Three decisions (which days, in what order, with what
 * between them) that were a `.map().filter().join(' · ')` in a renderer.
 */
function dayLabel(pattern: FreqPattern, labels: RouteFactLabels): string {
  if (pattern.dayType !== 'other') return labels.day(pattern.dayType)
  const running = pattern.days.flatMap((runs, index) => {
    const name = labels.dayNames[index]
    return runs && name !== undefined ? [name] : []
  })
  return running.length > 0 ? running.join(DAY_SEPARATOR) : labels.day('other')
}

/** The separator between running days. The same `' · '` the app uses to bind two readings of one thing. */
const DAY_SEPARATOR = ' · '
