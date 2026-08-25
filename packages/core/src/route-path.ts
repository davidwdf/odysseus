import type { LatLng } from './types'

// The route-line resolver (WP-M1 of docs/proposals/06, ADR-152/153).
//
// The Transport Department publishes road-following route lines on the CSDI portal — `Bus Route`
// and `Green Minibus Route` — keyed on `ROUTE_ID`, which is the consolidated dataset's `gtfsId`.
// Fetching them is the edge's job (`/v1/route/:id/path`). Deciding **which** line is this route's,
// **which way round** it runs, and **where it starts and ends** is a domain rule, so it lives here
// and is pinned by `spec/route-path.spec.json` rather than being re-derived per platform.
//
// ## Why this is not just "download the line with the matching id"
//
// Two traps, both measured on the real data (docs/research/07 §4), both of which silently produce a
// map that looks plausible and is wrong:
//
//   1. **`ROUTE_SEQ` (1/2) is not outbound/inbound.** hkbus hit this too (their issue #14) and it
//      swaps some routes. Their fix compares one point — the line's first vertex against the
//      direction's first stop — which decides a whole route on a terminus where both directions
//      often board within 40 m of each other.
//   2. **A short-working scores the same as the parent route it runs along**, because the
//      short-working's stops all lie on the parent's line. No scoring function fixes that; it is the
//      wrong question.
//
// So the rule here is: **score by coverage, orient by the rider's own stop order, then trim to the
// rider's own terminals.** After trimming it stops mattering which variant won — the drawn line is
// the road the rider's stops sit on, bounded by the rider's own first and last stop — and no line
// can draw a tail past the terminus on screen.
//
// ## Units and projection
//
// Distances are metres via a **local equirectangular projection** about the route's own mean
// latitude. Over a Hong Kong route (< 60 km) the error against the haversine is far below the
// tolerances here, and unlike haversine it gives a usable planar point-to-segment projection, which
// the trim step needs. This is deliberately *not* `geo.ts`'s contract: that one rounds to the
// nearest 10 m because ADR-008 forbids fake precision in a rider-facing distance. Nothing here is
// rider-facing — these are internal fits, and rounding them would move the line.

/** Mean earth radius, metres. Same constant `geo.ts` uses. */
const R = 6_371_000

/**
 * Reject a candidate whose mean stop-to-line distance exceeds this.
 *
 * Calibrated against measured fits rather than chosen: a correct line scores **8–10 m**, the same
 * route's *opposite* direction **42–70 m**, and an outright wrong route **432 m**. 100 m sits in
 * the wide gap between "a real line, imperfectly surveyed" and "not this route", and exists to
 * guard the operator+number fallback (`matchedBy: 'routeNumber'`), which can match several
 * `ROUTE_ID`s — NLB route 1 matches five.
 *
 * It is NOT a direction test. A route whose only available line runs the other way still scores
 * well under this and is then oriented by `orientToStops`.
 */
export const ROUTE_PATH_REJECT_METRES = 100

/** A `[longitude, latitude]` vertex — GeoJSON order, which is what CSDI returns. */
export type PathPoint = readonly [number, number]

/** One CSDI feature, already flattened from `MultiLineString` into a single vertex run. */
export interface RoutePathCandidate {
  /** CSDI `ROUTE_ID`, as a string. */
  id: string
  /** CSDI `ROUTE_SEQ` (1 or 2). Carried for diagnostics only — **never** read as a direction. */
  seq?: number
  /** How this candidate was found. `'routeNumber'` candidates are the ambiguous ones. */
  matchedBy?: 'gtfsId' | 'routeNumber'
  line: readonly PathPoint[]
}

export interface ResolvedRoutePath {
  id: string
  seq?: number
  matchedBy: 'gtfsId' | 'routeNumber'
  /** The chosen line, oriented to the rider's stop order and trimmed to their terminals. */
  path: PathPoint[]
  /** Mean distance from the route's stops to the chosen line, metres — the fit that won. */
  fitMetres: number
  /** True when the candidate's vertices ran opposite to the rider's stop order and were reversed. */
  reversed: boolean
  /** Vertices dropped from each end by the trim. Useful for spotting a mis-picked variant. */
  trimmedStart: number
  trimmedEnd: number
}

interface Local {
  x: number
  y: number
}

/** Project to local metres. `cos0` is the cosine of the reference latitude, computed once by the
 *  caller — the whole point of the local projection is that it is one multiply per point. */
function toLocal(p: LatLng, cos0: number): Local {
  return { x: (p.lng * Math.PI * R * cos0) / 180, y: (p.lat * Math.PI * R) / 180 }
}

function pointToLocal(p: PathPoint, cos0: number): Local {
  return { x: (p[0] * Math.PI * R * cos0) / 180, y: (p[1] * Math.PI * R) / 180 }
}

/** Distance from `p` to segment `a→b`, plus where along it the foot lands (`t` in 0..1). */
function distanceToSegment(p: Local, a: Local, b: Local): { distance: number; t: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { distance: Math.hypot(p.x - a.x, p.y - a.y), t: 0 }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return { distance: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t }
}

/** Where a point lands on a polyline: which segment, how far along it, and how far away. */
export interface PathProjection {
  /** Index of the segment's first vertex. */
  index: number
  /** Position along that segment, 0..1. */
  t: number
  distanceMetres: number
}

/**
 * The nearest point on `line` to `p`. Returns `null` for a line with fewer than two vertices —
 * a single point is not a path and callers must not draw one.
 *
 * @spec route-path#nearestOnPath
 */
export function nearestOnPath(line: readonly PathPoint[], p: LatLng): PathProjection | null {
  if (line.length < 2) return null
  const lat0 = p.lat
  const cos0 = Math.cos((lat0 * Math.PI) / 180)
  const q = toLocal(p, cos0)
  let best: PathProjection | null = null
  for (let i = 0; i < line.length - 1; i++) {
    const a = pointToLocal(line[i] as PathPoint, cos0)
    const b = pointToLocal(line[i + 1] as PathPoint, cos0)
    const { distance, t } = distanceToSegment(q, a, b)
    if (!best || distance < best.distanceMetres) best = { index: i, t, distanceMetres: distance }
  }
  return best
}

/**
 * Mean distance, in metres, from every stop to the nearest point on `line` — the score that picks a
 * candidate.
 *
 * **What it can and cannot tell apart.** It separates a route's two directions decisively when they
 * run on different roads (measured on KMB 101: 8.6 m against 41.9 m) and rejects a wrong route by a
 * factor of fifty. It *cannot* separate a short-working from the parent it runs along, because the
 * short-working's stops lie on the parent's line and score identically. That is not a defect to tune
 * out — it is why `resolveRoutePath` trims.
 *
 * Returns `Infinity` for an empty stop list or a degenerate line, so a caller comparing candidates
 * never picks one on missing evidence.
 *
 * @spec route-path#meanStopToLineMetres
 */
export function meanStopToLineMetres(stops: readonly LatLng[], line: readonly PathPoint[]): number {
  if (stops.length === 0 || line.length < 2) return Number.POSITIVE_INFINITY
  const lat0 = stops.reduce((a, s) => a + s.lat, 0) / stops.length
  const cos0 = Math.cos((lat0 * Math.PI) / 180)
  const segments: Array<[Local, Local]> = []
  for (let i = 0; i < line.length - 1; i++) {
    segments.push([
      pointToLocal(line[i] as PathPoint, cos0),
      pointToLocal(line[i + 1] as PathPoint, cos0),
    ])
  }
  let total = 0
  for (const stop of stops) {
    const q = toLocal(stop, cos0)
    let min = Number.POSITIVE_INFINITY
    for (const [a, b] of segments) {
      const d = distanceToSegment(q, a, b).distance
      if (d < min) min = d
    }
    total += min
  }
  return total / stops.length
}

/**
 * Reverse `line` when it runs against the rider's stop order.
 *
 * This — not `ROUTE_SEQ` — is what makes a direction correct, and it is why arrowheads drawn along
 * the returned path point the way the bus actually goes. It compares where the **first** and
 * **last** stop land along the line; if the first lands later, the vertices are the other way round.
 *
 * @spec route-path#orientToStops
 */
export function orientToStops(
  line: readonly PathPoint[],
  first: LatLng,
  last: LatLng,
): { line: PathPoint[]; reversed: boolean } {
  const a = nearestOnPath(line, first)
  const b = nearestOnPath(line, last)
  if (!a || !b) return { line: [...line], reversed: false }
  const posA = a.index + a.t
  const posB = b.index + b.t
  if (posA <= posB) return { line: [...line], reversed: false }
  return { line: [...line].reverse(), reversed: true }
}

/**
 * Cut `line` down to the stretch between the rider's first and last stop.
 *
 * The line is assumed already oriented (`orientToStops`). Both ends are cut **at the projection**,
 * not at the nearest vertex, so a terminus part-way along a segment does not leave a stub. A
 * circular route — where both terminals project to nearly the same place — keeps the whole line
 * rather than collapsing to nothing.
 *
 * @spec route-path#trimPathToStops
 */
export function trimPathToStops(
  line: readonly PathPoint[],
  first: LatLng,
  last: LatLng,
): { path: PathPoint[]; trimmedStart: number; trimmedEnd: number } {
  const whole = { path: [...line], trimmedStart: 0, trimmedEnd: 0 }
  if (line.length < 2) return whole
  const a = nearestOnPath(line, first)
  const b = nearestOnPath(line, last)
  if (!a || !b) return whole
  const posA = a.index + a.t
  const posB = b.index + b.t
  // A circular route projects both terminals to the same place; trimming there would erase it.
  if (posB - posA < 1) return whole

  const at = (proj: PathProjection): PathPoint => {
    const p = line[proj.index] as PathPoint
    const q = line[proj.index + 1] as PathPoint
    return [p[0] + (q[0] - p[0]) * proj.t, p[1] + (q[1] - p[1]) * proj.t]
  }
  const middle = line.slice(a.index + 1, b.index + 1)
  const path: PathPoint[] = [at(a), ...middle, at(b)]
  return { path, trimmedStart: a.index + 1, trimmedEnd: line.length - 1 - b.index }
}

/**
 * Pick this route's line from the candidates, orient it, and trim it to the route's own terminals.
 *
 * Returns `null` when there is no usable candidate — no candidates at all, fewer than two stops, or
 * a best fit worse than `rejectMetres`. **`null` is an ordinary answer, not an error:** about 7% of
 * bus and minibus route-directions have no line, and they are overwhelmingly racecourse, school and
 * peak-hour variants the TD does not separately register. What a screen draws instead is a design
 * decision recorded in docs/proposals/06 §5, not this function's business.
 *
 * @spec route-path#resolveRoutePath
 */
export function resolveRoutePath(
  stops: readonly LatLng[],
  candidates: readonly RoutePathCandidate[],
  options?: { rejectMetres?: number },
): ResolvedRoutePath | null {
  const rejectMetres = options?.rejectMetres ?? ROUTE_PATH_REJECT_METRES
  if (stops.length < 2 || candidates.length === 0) return null

  let best: { candidate: RoutePathCandidate; fit: number } | null = null
  for (const candidate of candidates) {
    const fit = meanStopToLineMetres(stops, candidate.line)
    if (!Number.isFinite(fit)) continue
    if (!best || fit < best.fit) best = { candidate, fit }
  }
  if (!best || best.fit > rejectMetres) return null

  const first = stops[0] as LatLng
  const last = stops[stops.length - 1] as LatLng
  const oriented = orientToStops(best.candidate.line, first, last)
  const trimmed = trimPathToStops(oriented.line, first, last)
  return {
    id: best.candidate.id,
    seq: best.candidate.seq,
    matchedBy: best.candidate.matchedBy ?? 'gtfsId',
    path: trimmed.path,
    fitMetres: best.fit,
    reversed: oriented.reversed,
    trimmedStart: trimmed.trimmedStart,
    trimmedEnd: trimmed.trimmedEnd,
  }
}
