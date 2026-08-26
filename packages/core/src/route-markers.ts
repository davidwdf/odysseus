import { initialBearingDeg } from './geo'
import type { LatLng } from './types'

/**
 * **What glyph a stop gets on the map, and which way it faces** (`docs/proposals/06 §8d`).
 *
 * A route's stops are not interchangeable, and a map that drew them as one repeated dot would throw
 * away the two distinctions a rider actually uses. Where the route *ends* answers "am I looking at the
 * right direction of this service"; where it meets other routes answers "can I change here". Both are
 * in the data already and neither survives a uniform marker.
 *
 * ## Why this is a kernel rule and not a renderer's styling
 *
 * Every value here is *a decision or a number a renderer would otherwise compute*, which is the exact
 * class ADR-068 says two renderers get differently. "The first and last stops are termini" sounds like
 * it needs no pinning until a circular route makes first and last the same pole; the bearing at a stop
 * is trigonometry with sign conventions that are easy to get subtly wrong once and consistently wrong
 * everywhere. `check-no-derivation` would reject both in a component, and it would be right to.
 *
 * ## What is deliberately NOT here
 *
 * **The offset itself.** This returns the direction of travel and the shipping rule for which side to
 * sit on; how far to nudge the glyph is presentation, and it must be, because the honest distance is
 * zoom-dependent. A kerb is a real place ~5 m from the centreline, which is a sub-pixel move at the
 * zoom a whole route is framed at and a visible one at street level. Baking metres into the data would
 * pick one of those and be wrong at the other; a renderer offsetting by pixels along `bearing` is right
 * at both.
 */

/** Which glyph a stop is drawn as. Three kinds, because the data supports exactly three claims. */
export type StopMarkerKind =
  /** An end of the line — drawn as a square. Both ends of an ordinary route; see the circular note. */
  | 'terminus'
  /** A bus-bus interchange, where a rider can change to another route — drawn as a hexagon. */
  | 'interchange'
  /** Every other stop — a circle. */
  | 'stop'

/**
 * **Which side of the road a rider boards from, as a signed quarter-turn from the travel bearing.**
 *
 * `-90` is the rider's left. Hong Kong drives on the left, so a stop for *this* direction of travel is
 * on the left kerb, and a marker nudged that way says which side to wait on without a word — the
 * cartographic version of what ADR-080 answers in prose when two poles are a metre apart.
 *
 * A named constant rather than a literal `-90` in a renderer because it is a **fact about the
 * territory**, and the first thing that would need changing if this app ever ran anywhere that drives
 * on the right. It is also the sign convention: bearings here are clockwise from north, so subtracting
 * turns left.
 */
export const KERB_OFFSET_DEG = -90

/** One stop's marker: what it is, and the direction of travel through it. */
export interface StopMarker {
  /** Index into the stops that were passed in, so a caller can join back to its own rows. */
  index: number
  kind: StopMarkerKind
  /**
   * Direction of travel at this stop, degrees clockwise from north. Add {@link KERB_OFFSET_DEG} for
   * the direction to nudge the glyph in. `0` where the route has no length to take a direction from.
   */
  bearing: number
}

/** What {@link routeMarkers} needs to know about a stop: where it is, and what it is called. */
export interface MarkerStop {
  location: LatLng
  /** The stop's display name, in any locale — only the Latin `BBI` token is read. */
  name: string
}

/**
 * Matches the `BBI` that upstream puts in an interchange's name, e.g. *"Tsim Sha Tsui BBI"*.
 *
 * **Word-bounded, and case-sensitively upper.** `BBI` is an abbreviation the operators print in Latin
 * letters in every locale, so it survives translation and is safe to match on — but a bare `includes`
 * would also fire on any name containing those three letters in sequence, and the boundary is what
 * keeps it a token rather than a substring. Deliberately not localised: there is no Chinese equivalent
 * in the feed to match, so a zh name identifies its interchange with the same Latin `BBI` or not at all.
 */
const BBI = /\bBBI\b/

/**
 * The marker for each stop on a route, in the order they were given.
 *
 * ## Termini, and the circular route that makes them interesting
 *
 * The first and last stops are the ends of the line. On a circular route they are the **same place**
 * (ADR-046 — a loop has no second terminus), and both are still marked: a rider looking at the map
 * needs to see that the route begins and ends there, and drawing only one would make a loop look like
 * it stops halfway. The pair being co-located is a property of the route, not something to hide.
 *
 * A terminus that is *also* an interchange stays a terminus. The end of the line is the stronger claim
 * — it is what tells a rider they are looking at the right direction of the service — and a glyph can
 * only say one thing.
 *
 * ## Bearing comes from the STOPS, not from the surveyed line
 *
 * A central difference: the direction from the previous stop to the next one, which smooths the corner
 * a stop often sits on. At the ends there is only one neighbour, so it is a forward or backward
 * difference.
 *
 * Using the stops rather than the line is a deliberate approximation and the cheaper half of a real
 * trade. The surveyed line would give the true road direction at the kerb, but only by projecting each
 * stop onto it — a nearest-segment search per stop — and the line is a **second request** that arrives
 * later than the stop list (ADR-152), so markers would either wait for it or move once it landed.
 * Stop-to-stop is stable, available immediately, and identical on the `approximate` arm where the line
 * *is* the stops. The error it admits is a marker on the wrong side of a hairpin, which is rarer than
 * the flicker the accurate version would cost.
 *
 * Two stops at the same coordinates yield `0` rather than a bearing invented from nothing, and so does
 * a route too short to have a direction at all.
 *
 * @spec route-markers#routeMarkers
 */
export function routeMarkers(stops: readonly MarkerStop[]): StopMarker[] {
  return stops.map((stop, index) => {
    // The widest pair this stop has: its neighbours where it has two, and **itself** where it is an
    // end. Falling back to `stop` rather than clamping the index is what removes the impossible
    // `undefined` branch a clamp leaves behind — the callback's own `stop` is the one value here the
    // compiler already knows exists, and an end whose pair is `(stop, next)` is the same forward
    // difference a clamp produced.
    const from = stops[index - 1] ?? stop
    const to = stops[index + 1] ?? stop
    return {
      index,
      kind: kindOf(stop, index, stops.length),
      bearing: bearingBetween(from.location, to.location),
    }
  })
}

function kindOf(stop: MarkerStop, index: number, count: number): StopMarkerKind {
  if (index === 0 || index === count - 1) return 'terminus'
  return BBI.test(stop.name) ? 'interchange' : 'stop'
}

function bearingBetween(from: LatLng, to: LatLng): number {
  // Identical coordinates have no direction, and `atan2(0, 0)` is `0` — which is *north*, a direction
  // we would be inventing. Answering 0 anyway is not a contradiction: it is the same "no direction"
  // a one-stop route gets, and a caller drawing a kerb offset from it nudges consistently for a pair
  // of stops that are in the same place to begin with.
  if (from.lat === to.lat && from.lng === to.lng) return 0
  return initialBearingDeg(from, to)
}
