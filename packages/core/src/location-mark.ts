/**
 * **How to draw the rider's own position** — a dart when we know which way they are facing, a dot when
 * we do not (`docs/proposals/06 §6b`).
 *
 * ## The dot is not a degraded dart
 *
 * It is the correct mark for *"here, facing unknown"*, and getting that backwards is the whole risk in
 * this rule. A dart is a **direction claim**; one pointing north because north is the default is the
 * same class of lie as a client-side per-second countdown (ADR-008), and it is worse in one way — a
 * rider standing at a bus stop working out which way to walk will *act* on it, immediately, and a
 * countdown at least fails visibly.
 *
 * ## Why there are two sources and why the weaker one is the fallback
 *
 * They answer different questions:
 *
 * - **Compass** (`DeviceOrientationEvent.webkitCompassHeading`, `CLHeading` on iOS) — *which way is the
 *   rider facing*. That is the question someone standing still at a kerb is actually asking. It needs
 *   an explicit, gesture-triggered permission on iOS 13+ and is absent on most desktop browsers.
 * - **Course over ground** (`GeolocationPosition.coords.heading`) — *which way are they moving*. A
 *   different question with a good enough answer while they are moving, which is the only time it has
 *   one: it is `null` when stationary, which is exactly what a rider waiting at a stop produces.
 *
 * So the fallback is the **weaker signal, not the more common one**, and the order matters because of
 * it: a rider who grants compass permission and then stands still keeps their dart, where course alone
 * would drop them to a dot the moment they stopped walking.
 *
 * ## What a rider is never told
 *
 * Which source produced the heading. Both are the same claim — *this is the way you are facing* — at
 * different confidences, and drawing two kinds of dart would invent a distinction nobody can act on.
 */

import type { LatLng } from './types'

/** What to draw for the rider's position. */
export type LocationMark =
  /** A direction is known. `bearing` is degrees clockwise from north. */
  | { kind: 'dart'; bearing: number }
  /** No direction. Not a failure — the honest mark for a position with no heading attached. */
  | { kind: 'dot' }

/** The two heading sources, as a platform hands them over. Either may be absent. */
export interface HeadingSources {
  /**
   * True compass heading, where the platform has one and the rider has permitted it. Degrees
   * clockwise from north.
   */
  compassDeg?: number | null
  /** Course over ground from the position fix. `null` when stationary, which is the common case. */
  courseDeg?: number | null
}

/**
 * Which mark to draw, from whichever heading sources are available.
 *
 * **A value outside 0–360 is normalised, not rejected.** Platforms differ: `CLHeading` is already
 * 0–360, `deviceorientation`'s `alpha` is counted the other way on some Android builds and adapters
 * correct it by subtracting, which can land at −5. Normalising here means an adapter's arithmetic
 * cannot produce a mark pointing at nothing, and it is one line against a bug that would be invisible
 * on the platform that did not have it.
 *
 * **`NaN` and infinities are treated as no answer at all**, because they *are* one — a sensor that has
 * not settled, or a division nobody guarded. A dart at `NaN°` renders as a mark pointing north on some
 * engines and vanishes on others, and both are worse than a dot.
 *
 * @spec location-mark#locationMark
 */
export function locationMark(sources: HeadingSources): LocationMark {
  const compass = usable(sources.compassDeg)
  if (compass !== undefined) return { kind: 'dart', bearing: compass }
  const course = usable(sources.courseDeg)
  if (course !== undefined) return { kind: 'dart', bearing: course }
  return { kind: 'dot' }
}

function usable(deg: number | null | undefined): number | undefined {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return undefined
  // **A bearing already in range is returned untouched**, which is not an optimisation. Running 44.2
  // through `((deg % 360) + 360) % 360` yields 44.19999999999999 — two floating-point operations that
  // cannot be exact in binary — so normalising unconditionally would silently perturb every ordinary
  // reading to make two out-of-range ones tidy. The corpus caught it: the `course-over-ground` row
  // uses 44.2 precisely because a round number would have hidden this.
  if (deg >= 0 && deg < 360) return deg
  return ((deg % 360) + 360) % 360
}

/**
 * The radius, in metres, to draw around a fix — or `undefined` where drawing one would say less than
 * drawing nothing.
 *
 * **A circle is a claim about uncertainty, and a wrong one is worse than none.** Two cases where it is
 * wrong: a platform that reports no accuracy at all (nothing to draw), and one that reports an accuracy
 * so coarse the circle would cover the whole screen — a desktop browser geolocating by IP routinely
 * answers tens of kilometres, and a circle that size tells a rider nothing except that the app is
 * confused. Above {@link ACCURACY_USELESS_M} the honest output is the mark alone.
 *
 * The floor matters for the opposite reason: a 3 m circle is smaller than the dot drawn on top of it,
 * so it reads as a rendering artefact rather than as precision. Below {@link ACCURACY_FLOOR_M} there
 * is nothing useful to show either.
 *
 * @spec location-mark#accuracyRadiusM
 */
export function accuracyRadiusM(accuracyM: number | null | undefined): number | undefined {
  if (accuracyM === null || accuracyM === undefined || !Number.isFinite(accuracyM)) return undefined
  if (accuracyM < ACCURACY_FLOOR_M || accuracyM > ACCURACY_USELESS_M) return undefined
  return accuracyM
}

/** Below this, the circle is smaller than the mark on top of it and reads as an artefact. */
export const ACCURACY_FLOOR_M = 8

/**
 * Above this, the circle is a statement that we do not know where the rider is — which is true, and
 * better said by not drawing one. 2 km is roughly the point at which the circle exceeds a whole-route
 * view and stops being a feature of the map at all.
 */
export const ACCURACY_USELESS_M = 2_000

/** A fix with whatever the platform could tell us about it. */
export interface LocatedRider {
  at: LatLng
  accuracyM?: number | null
}
