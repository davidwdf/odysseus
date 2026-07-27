import { describe, expect, it } from 'vitest'
import { type Fix, SNAP_GRID_M, snapFix } from './geoSnap'

const HK = { lat: 22.3193, lng: 114.1694 }
const M_PER_DEG_LAT = 111_320

/** Great-circle-ish distance, good enough at these scales. */
function metresBetween(a: Fix, b: Fix): number {
  const dLat = (a.lat - b.lat) * M_PER_DEG_LAT
  const dLng = (a.lng - b.lng) * M_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dLat, dLng)
}

describe('snapFix', () => {
  it('collapses nearby jittery readings onto one cell', () => {
    // A stationary phone drifts by a few metres between readings; those must share a key.
    const readings: Fix[] = [
      HK,
      { lat: HK.lat + 0.00002, lng: HK.lng - 0.00003 },
      { lat: HK.lat - 0.00001, lng: HK.lng + 0.00002 },
    ]
    const keys = new Set(readings.map((r) => JSON.stringify(snapFix(r))))
    expect(keys.size).toBe(1)
  })

  it('never moves a fix further than half a cell diagonal', () => {
    const halfDiagonal = (SNAP_GRID_M * Math.SQRT2) / 2
    for (let i = 0; i < 200; i++) {
      const fix = { lat: 22.15 + i * 0.002, lng: 113.9 + i * 0.0027 }
      expect(metresBetween(fix, snapFix(fix))).toBeLessThanOrEqual(halfDiagonal + 0.5)
    }
  })

  it('is idempotent — snapping a snapped fix is a no-op', () => {
    const once = snapFix(HK)
    expect(snapFix(once)).toEqual(once)
  })

  it('still separates fixes a block apart', () => {
    // ~100 m north: different cell, so a real move still refetches.
    const moved = { lat: HK.lat + 100 / M_PER_DEG_LAT, lng: HK.lng }
    expect(snapFix(moved)).not.toEqual(snapFix(HK))
  })

  it('produces short, stable numbers for use in a URL', () => {
    const { lat, lng } = snapFix(HK)
    expect(String(lat).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6)
    expect(String(lng).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6)
  })
})
