import { describe, expect, it } from 'vitest'
import corpus from '../spec/mercator.spec.json'
import {
  clampZoom,
  fitZoom,
  latToWorldY,
  lngToWorldX,
  metresPerPixel,
  tileZoomPlan,
  worldScale,
  type ZoomRange,
} from '../src/mercator'
import type { LatLng } from '../src/types'
import { specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/mercator.spec.json.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

/**
 * A float row of this corpus. Deliberately not `Approx` from ./corpus.ts: that one names its field
 * `meters` because `geo` only ever measures ground, whereas these groups return world pixels *and*
 * metres per pixel. One field named for what it is — a value in the unit its group's `doc` states —
 * beats a second unit-specific interface, and a native suite reads the same two keys either way.
 */
interface ApproxValue {
  value: number
  tolerance: number
}

/** The corpus states a tolerance per row; see ./corpus.ts for why floats are compared this way. */
function expectApprox(actual: number, e: ApproxValue) {
  expect(Math.abs(actual - e.value)).toBeLessThanOrEqual(e.tolerance)
}

describe('mercator#worldScale', () => {
  for (const c of cases<{ zoom: number }, ApproxValue>('worldScale')) {
    it(c.name, () => {
      expectApprox(worldScale(c.args.zoom), c.expect)
    })
  }
})

describe('mercator#lngToWorldX', () => {
  for (const c of cases<{ lng: number; scale: number }, ApproxValue>('lngToWorldX')) {
    it(c.name, () => {
      expectApprox(lngToWorldX(c.args.lng, c.args.scale), c.expect)
    })
  }
})

describe('mercator#latToWorldY', () => {
  for (const c of cases<{ lat: number; scale: number }, ApproxValue>('latToWorldY')) {
    it(c.name, () => {
      expectApprox(latToWorldY(c.args.lat, c.args.scale), c.expect)
    })
  }

  it('is monotonic southward across Hong Kong', () => {
    // A property over the whole territory rather than a value, so it belongs here and not in the
    // corpus: y must increase as latitude falls. A flipped axis (TMS's y, the single most common
    // porting mistake) satisfies the equator row and reverses this one.
    const scale = worldScale(16)
    let previous = Number.NEGATIVE_INFINITY
    for (let lat = 22.56; lat >= 22.14; lat -= 0.01) {
      const y = latToWorldY(lat, scale)
      expect(y).toBeGreaterThan(previous)
      previous = y
    }
  })
})

describe('mercator#metresPerPixel', () => {
  for (const c of cases<{ lat: number; zoom: number }, ApproxValue>('metresPerPixel')) {
    it(c.name, () => {
      expectApprox(metresPerPixel(c.args.lat, c.args.zoom), c.expect)
    })
  }
})

describe('mercator#clampZoom', () => {
  for (const c of cases<{ zoom: number; zooms: ZoomRange }, number>('clampZoom')) {
    it(c.name, () => {
      expect(clampZoom(c.args.zoom, c.args.zooms)).toBe(c.expect)
    })
  }
})

describe('mercator#fitZoom', () => {
  for (const c of cases<
    { points: LatLng[]; widthPx: number; heightPx: number; zooms: ZoomRange },
    number
  >('fitZoom')) {
    it(c.name, () => {
      expect(fitZoom(c.args.points, c.args.widthPx, c.args.heightPx, c.args.zooms)).toBe(c.expect)
    })
  }

  it('never returns a zoom the source cannot serve', () => {
    // The invariant the corpus rows only sample. `MiniMap` clamps the result anyway, so a violation
    // here would not show as a hole in the map — it would show as the clamp quietly doing the
    // framing, which is the bug that hides its own cause.
    const zooms: ZoomRange = { minZoom: 10, maxZoom: 20 }
    for (const c of cases<
      { points: LatLng[]; widthPx: number; heightPx: number; zooms: ZoomRange },
      number
    >('fitZoom')) {
      const z = fitZoom(c.args.points, c.args.widthPx, c.args.heightPx, zooms)
      expect(z).toBeGreaterThanOrEqual(zooms.minZoom)
      expect(z).toBeLessThanOrEqual(zooms.maxZoom)
    }
  })
})

describe('tileZoomPlan', () => {
  interface Args {
    zoom: number
    devicePixelRatio: number
    zooms: ZoomRange
  }
  interface Expected {
    base: number
    label: number
    scale: number
    tolerance: number
  }
  for (const c of cases<Args, Expected>('tileZoomPlan')) {
    it(c.name, () => {
      const actual = tileZoomPlan(c.args.zoom, c.args.devicePixelRatio, c.args.zooms)
      // Levels are integers and compare exactly; only `scale` is a float.
      expect(actual.base).toBe(c.expect.base)
      expect(actual.label).toBe(c.expect.label)
      expect(Math.abs(actual.scale - c.expect.scale)).toBeLessThanOrEqual(c.expect.tolerance)
      // The invariant the two levels exist to preserve: labels are never deeper than the base.
      expect(actual.label).toBeLessThanOrEqual(actual.base)
    })
  }
})
