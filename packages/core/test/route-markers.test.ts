import { describe, expect, it } from 'vitest'
import corpus from '../spec/route-markers.spec.json'
import {
  KERB_OFFSET_DEG,
  type MarkerStop,
  routeMarkers,
  type StopMarker,
} from '../src/route-markers'
import { specCases } from './corpus'

/** Degrees. Three orders finer than a marker could show — see the corpus `doc`. */
const BEARING_TOLERANCE = 1e-4

describe('route-markers#routeMarkers', () => {
  for (const c of specCases<{ stops: MarkerStop[] }, StopMarker[]>(corpus, 'routeMarkers')) {
    it(c.name, () => {
      const actual = routeMarkers(c.args.stops)
      expect(actual.map((m) => ({ index: m.index, kind: m.kind }))).toEqual(
        c.expect.map((e) => ({ index: e.index, kind: e.kind })),
      )
      // Bearings compared with a tolerance, never equality: no two languages' `atan2` agree to the
      // last bit, and the corpus says so in its own `doc`.
      actual.forEach((m, i) => {
        expect(Math.abs(m.bearing - (c.expect[i] as StopMarker).bearing)).toBeLessThanOrEqual(
          BEARING_TOLERANCE,
        )
      })
    })
  }

  it('marks exactly one glyph per stop, in the order it was given', () => {
    // A property rather than a value, and the one thing no single row above can state: a caller joins
    // these back to its own rows by `index`, so a dropped, added or reordered marker would put a
    // terminus square on an intermediate stop with nothing failing.
    for (const c of specCases<{ stops: MarkerStop[] }, StopMarker[]>(corpus, 'routeMarkers')) {
      const markers = routeMarkers(c.args.stops)
      expect(markers).toHaveLength(c.args.stops.length)
      expect(markers.map((m) => m.index)).toEqual(c.args.stops.map((_, i) => i))
    }
  })

  it('offsets to the left of travel, which is the kerb a Hong Kong rider boards from', () => {
    // The constant's *meaning*, asserted where a reader will see it. Bearings are clockwise from
    // north, so a quarter-turn left is negative; a port that flipped the sign would put every marker
    // on the opposite kerb — uniformly, which is exactly how the mockup's version of this bug looked
    // consistent and was consistently wrong (`docs/proposals/06 §8d`).
    expect(KERB_OFFSET_DEG).toBe(-90)
    const northbound = 0
    expect((northbound + KERB_OFFSET_DEG + 360) % 360).toBe(270) // due west — the left kerb
    const eastbound = 90
    expect((eastbound + KERB_OFFSET_DEG + 360) % 360).toBe(0) // due north — again the left kerb
  })
})
