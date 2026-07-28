import { describe, expect, it } from 'vitest'
import corpus from '../spec/geo-snap.spec.json'
import { haversineMeters } from '../src/geo'
import { type Fix, SNAP_GRID_M, snapFix } from '../src/geo-snap'
import { specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/geo-snap.spec.json.

/** The corpus's float convention, per component. See ../spec/geo-snap.spec.json's `doc` for why the
 *  tolerance here is tight where `geo.spec.json`'s is not: the output is quantized to six decimals,
 *  so anything outside it is a whole quantum out — a different cell, and a different cache key. */
interface ApproxFix {
  lat: number
  lng: number
  tolerance: number
}

/** JSON `null` → the language's absent value, at the boundary (see ./corpus.ts). A row with
 *  `gridM: null` is a caller that takes the 25 m default, which is every caller in the app. */
const cases = specCases<{ fix: Fix; gridM: number | null }, ApproxFix>(corpus, 'snapFix')

describe('geo-snap#snapFix', () => {
  for (const c of cases) {
    it(c.name, () => {
      const got = snapFix(c.args.fix, c.args.gridM ?? undefined)
      expect(Math.abs(got.lat - c.expect.lat)).toBeLessThanOrEqual(c.expect.tolerance)
      expect(Math.abs(got.lng - c.expect.lng)).toBeLessThanOrEqual(c.expect.tolerance)
    })
  }

  it('is idempotent for every row — a snapped fix snaps to itself', () => {
    // A property over every row rather than a value, so it belongs here and not in the corpus (one
    // row does state it as data, for a porter reading the JSON alone). This is the property the
    // cache key depends on: the app re-derives the key from a *stored* fix on every cold start, so
    // a second snap that moved would refetch instead of replaying.
    for (const c of cases) {
      const gridM = c.args.gridM ?? undefined
      const once = snapFix(c.args.fix, gridM)
      expect(snapFix(once, gridM)).toEqual(once)
    }
  })

  it('never moves a fix further than half a cell diagonal', () => {
    // Sweeps the Hong Kong bounding box rather than naming coordinates: the bound is what makes 25 m
    // safe to claim, and a rule that held at twelve chosen points but not between them would still
    // be wrong. Measured with this package's own distance rule, whose sphere differs from the snap's
    // flat 111320 m/deg by about a tenth of a percent — hence the half-metre of slack.
    const halfDiagonal = (SNAP_GRID_M * Math.SQRT2) / 2
    for (let i = 0; i < 200; i++) {
      const fix = { lat: 22.15 + i * 0.002, lng: 113.9 + i * 0.0027 }
      expect(haversineMeters(fix, snapFix(fix))).toBeLessThanOrEqual(halfDiagonal + 0.5)
    }
  })

  it('produces at most six decimals, so the fix stays short in a URL', () => {
    // The snapped fix is a query parameter and a cache key. Float noise in the twelfth decimal would
    // be invisible on screen and fatal to both, so the quantization is asserted over the sweep, not
    // just over the rows.
    for (let i = 0; i < 200; i++) {
      const { lat, lng } = snapFix({ lat: 22.15 + i * 0.002, lng: 113.9 + i * 0.0027 })
      expect(String(lat).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6)
      expect(String(lng).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6)
    }
  })
})
