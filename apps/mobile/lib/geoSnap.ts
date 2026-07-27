/**
 * Grid-snap a GPS fix before it leaves the device.
 *
 * Three things fall out of one 15-line function:
 *  1. **Privacy.** We ask the Worker about a 25 m cell, not the rider's exact doorstep.
 *  2. **Edge cacheability.** Raw coordinates jitter by metres between readings, so
 *     `/v1/nearby?lat=…&lng=…` was a fresh cache key on nearly every request. Snapped, a whole
 *     street corner shares one key — which is what lets the Worker's 30 s cache actually bind.
 *  3. **Offline.** The TanStack Query cache is keyed on the fix too, so unsnapped coordinates
 *     meant a persisted Nearby result could essentially never be replayed (WP0-3).
 *
 * 25 m is well inside the accuracy of a phone fix in an urban canyon like Hong Kong, and small
 * relative to the 500 m nearby radius, so it does not change which stops come back.
 *
 * This is WP2-6, landed early because WP0-3's offline acceptance needs it. It is pure and
 * clock-free by design; Wave 2 moves it into `packages/core` unchanged.
 */

/** Metres per degree of latitude (WGS84 mean). Longitude scales by cos(lat). */
const M_PER_DEG_LAT = 111_320

/** Default cell edge. See the note above for why 25 m. */
export const SNAP_GRID_M = 25

export interface Fix {
  lat: number
  lng: number
}

/** Snap a fix to the centre of its `gridM` cell. Deterministic: same cell → same output. */
export function snapFix({ lat, lng }: Fix, gridM: number = SNAP_GRID_M): Fix {
  const latStep = gridM / M_PER_DEG_LAT
  // Longitude degrees shrink towards the poles; use the *snapped* latitude so the cell width is
  // itself a function of the cell, not of the raw fix — otherwise neighbouring readings inside
  // one cell could still land on different longitudes.
  const snappedLat = Math.round(lat / latStep) * latStep
  const lngStep = gridM / (M_PER_DEG_LAT * Math.max(0.01, Math.cos((snappedLat * Math.PI) / 180)))
  const snappedLng = Math.round(lng / lngStep) * lngStep
  // Six decimals ≈ 0.1 m: enough to be lossless here, and it keeps the URL (and the cache key)
  // short and stable instead of carrying float noise.
  return { lat: round6(snappedLat), lng: round6(snappedLng) }
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6
