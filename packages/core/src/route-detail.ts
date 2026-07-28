import { etaView } from './eta'
import { memberStopIds } from './ids'
import { CLIENT_POLICY_DEFAULTS } from './policy'
import type { BusMarker } from './route-position'
import { isCircular, splitStopCode, stripCircular, titleCaseName } from './stop-name'
import type { I18nText, Locale } from './types'

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
