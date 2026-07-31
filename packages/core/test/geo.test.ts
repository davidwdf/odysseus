import { describe, expect, it } from 'vitest'
import corpus from '../spec/geo.spec.json'
import {
  bearingOctant,
  bearingOctantDeg,
  formatBearing,
  formatDistance,
  formatWalk,
  formatWalkRange,
  haversineMeters,
  initialBearingDeg,
  routeDistanceM,
  walkMinutes,
} from '../src/geo'
import type { LatLng, Locale } from '../src/types'
import { type Approx, type ApproxDeg, specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/geo.spec.json.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

/** The corpus states a tolerance per row; see ./corpus.ts for why floats are compared this way. */
function expectApprox(actual: number, e: Approx) {
  expect(Math.abs(actual - e.meters)).toBeLessThanOrEqual(e.tolerance)
}

/** The same, in degrees. */
function expectApproxDeg(actual: number, e: ApproxDeg) {
  expect(Math.abs(actual - e.degrees)).toBeLessThanOrEqual(e.tolerance)
}

describe('geo#haversineMeters', () => {
  for (const c of cases<{ a: LatLng; b: LatLng }, Approx>('haversineMeters')) {
    it(c.name, () => {
      expectApprox(haversineMeters(c.args.a, c.args.b), c.expect)
    })
  }

  it('is symmetric — swapping the points cannot change the distance', () => {
    // Not a corpus row: it is a property over every row rather than a value, so it belongs in the
    // suite. A port that mixed up a sign would still satisfy the rows above for some inputs.
    for (const c of cases<{ a: LatLng; b: LatLng }, Approx>('haversineMeters')) {
      expect(haversineMeters(c.args.b, c.args.a)).toBeCloseTo(
        haversineMeters(c.args.a, c.args.b),
        9,
      )
    }
  })
})

describe('geo#routeDistanceM', () => {
  for (const c of cases<{ points: LatLng[] }, Approx>('routeDistanceM')) {
    it(c.name, () => {
      expectApprox(routeDistanceM(c.args.points), c.expect)
    })
  }
})

describe('geo#walkMinutes', () => {
  for (const c of cases<{ distanceM: number }, number>('walkMinutes')) {
    it(c.name, () => {
      expect(walkMinutes(c.args.distanceM)).toBe(c.expect)
    })
  }
})

describe('geo#formatDistance', () => {
  for (const c of cases<{ distanceM: number }, string>('formatDistance')) {
    it(c.name, () => {
      expect(formatDistance(c.args.distanceM)).toBe(c.expect)
    })
  }
})

describe('geo#formatWalk', () => {
  for (const c of cases<{ distanceM: number; locale: Locale }, string>('formatWalk')) {
    it(c.name, () => {
      expect(formatWalk(c.args.distanceM, c.args.locale)).toBe(c.expect)
    })
  }
})

describe('geo#bearingOctant', () => {
  for (const c of cases<{ deg: number }, number>('bearingOctant')) {
    it(c.name, () => {
      expect(bearingOctant(c.args.deg)).toBe(c.expect)
    })
  }

  it('bearingOctantDeg is the octant expressed as a rotation', () => {
    // Not a corpus row: it is a restatement of the row above, and the property worth asserting is
    // that the two cannot part company — which is a relationship, not a value.
    for (const c of cases<{ deg: number }, number>('bearingOctant'))
      expect(bearingOctantDeg(c.args.deg)).toBe(c.expect * 45)
  })
})

describe('geo#initialBearingDeg', () => {
  for (const c of cases<{ a: LatLng; b: LatLng }, ApproxDeg>('initialBearingDeg')) {
    it(c.name, () => {
      expectApproxDeg(initialBearingDeg(c.args.a, c.args.b), c.expect)
    })
  }

  it('is in 0–360 for every ordered pair of every row', () => {
    // A property, not a value. The `+ 360` normalisation is the half a port drops, and it only shows
    // up on a westward bearing — so this sweeps every pair in the corpus in BOTH directions rather
    // than trusting that the one westward row is the only place it matters.
    for (const c of cases<{ a: LatLng; b: LatLng }, ApproxDeg>('initialBearingDeg'))
      for (const [a, b] of [
        [c.args.a, c.args.b],
        [c.args.b, c.args.a],
      ] as const) {
        const deg = initialBearingDeg(a, b)
        expect(deg).toBeGreaterThanOrEqual(0)
        expect(deg).toBeLessThan(360)
      }
  })

  it('matches the bearing the dataset pipeline computes, to the last bit', () => {
    // `buildPlaces` (`@nextbus/data-normalize`) held the only implementation of this until WP5-10 and
    // now calls this one. Its bearings feed `BEARING_SPREAD_CAP_DEG`, which decides which poles merge
    // into a place — so a last-bit difference could silently rebuild the whole dataset under a new
    // hash. This is the pipeline's expression, transcribed here, compared with `Object.is` rather than
    // `toBeCloseTo`: "close enough" is exactly what would not be caught.
    const toRad = (deg: number): number => (deg * Math.PI) / 180
    const pipeline = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const lat1r = toRad(lat1)
      const lat2r = toRad(lat2)
      const dLng = toRad(lng2 - lng1)
      const y = Math.sin(dLng) * Math.cos(lat2r)
      const x =
        Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng)
      return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
    }
    for (const c of cases<{ a: LatLng; b: LatLng }, ApproxDeg>('initialBearingDeg'))
      expect(
        Object.is(
          initialBearingDeg(c.args.a, c.args.b),
          pipeline(c.args.a.lat, c.args.a.lng, c.args.b.lat, c.args.b.lng),
        ),
      ).toBe(true)
  })
})

describe('geo#formatWalkRange', () => {
  for (const c of cases<{ minDistanceM: number; maxDistanceM: number; locale: Locale }, string>(
    'formatWalkRange',
  )) {
    it(c.name, () => {
      expect(formatWalkRange(c.args.minDistanceM, c.args.maxDistanceM, c.args.locale)).toBe(
        c.expect,
      )
    })
  }
})

describe('geo#formatBearing', () => {
  for (const c of cases<{ deg: number; locale: Locale }, string>('formatBearing')) {
    it(c.name, () => {
      expect(formatBearing(c.args.deg, c.args.locale)).toBe(c.expect)
    })
  }

  it('never returns an empty label for any finite bearing', () => {
    // A property, not a value: the octant lookup is `labels[octant] ?? ''`, so a modulo mistake
    // degrades to a blank direction cue rather than a crash — the failure a per-row corpus would
    // only catch at the exact degrees it happens to name. This sweeps the whole circle.
    for (let deg = -720; deg <= 720; deg += 0.5) {
      expect(formatBearing(deg, 'en')).not.toBe('')
    }
  })

  // The two remaining branches in this function are its defensive fallbacks. Neither is expressible
  // as a corpus row — one needs a value outside the `Locale` union, the other needs NaN, and JSON has
  // no NaN — but both are reachable in production, so they are asserted here rather than waved
  // through with a lowered coverage threshold.

  it('falls back to the English labels for a locale outside the union', () => {
    // Not hypothetical: ADR-052 marks `Locale` `x-unknown-tolerant`, precisely because the server may
    // one day send a locale an installed client has never heard of, and `core` does no runtime
    // validation (`types.js` emits `export {};`). So an unknown locale really can reach this lookup.
    // Falling back to English beats returning nothing, and this pins that choice.
    expect(formatBearing(45, 'de' as Locale)).toBe('Northeast-bound')
  })

  it('KNOWN DEFECT: a NaN bearing silently produces an empty label', () => {
    // `Stop.bearingDeg` is optional and is a *mean* of the bearings through a place, so an empty or
    // malformed set produces NaN, which flows through `% 360` and `Math.round` untouched and indexes
    // the label table with NaN. The rider then sees a place with a blank direction cue instead of the
    // NE-vs-SW hint that is the whole point of ADR-042's bearing. Asserted as-is so every platform
    // behaves alike; the fix is to reject a non-finite bearing at the boundary and show no cue
    // deliberately, and it would turn this test red.
    expect(formatBearing(Number.NaN, 'en')).toBe('')
  })
})
