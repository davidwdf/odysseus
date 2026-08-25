import type { LatLng } from './types'

// Web Mercator (EPSG:3857) tile maths, moved out of `apps/mobile/components/MiniMap.tsx` by WP2-4
// of docs/proposals/03. `packages/ports/src/tile-source.ts` already promised this move: the XYZ
// conventions are stated there, the arithmetic that implements them belongs here, so iOS and
// Android frame a stop the same way instead of each re-deriving it against its own map SDK.
//
// **Why a module of its own rather than `geo.ts`.** Both are "maps maths", which is exactly the
// trap. `geo.ts` is a *distance and walk-time* contract — metres over the ground, rounded to the
// nearest 10 because ADR-008 forbids fake precision. This file is a *projection*: unrounded pixels
// on a flat 256·2^z world, where rounding at all would move a pin. One corpus per file keeps those
// two rounding conventions from being read as one.
//
// **Which of MiniMap's numbers came with the maths.** The framing decisions are here whenever they
// are expressed as a *number* — the 100 m minimum span a lone stop is framed to, the 70 % of the
// viewport a place's poles must fit inside, the z19 cap, the fallback zoom before layout has
// measured a width. Those decide *what ground the rider sees* and a native renderer has to make the
// same call, so they are rule, not layout. What stayed in the component is everything expressed as
// *layout*: which tiles to lay down as `<Image>`s, dot sizes, the label chip that flips above a dot
// when a pole sits directly below. A MapKit or MapLibre port throws all of that away and keeps this.
//
// The zoom bounds are a parameter, not a constant, because they belong to the tile source (LandsD
// serves z10–20 and 404s outside it — ADR-049). `packages/core` may not import `@nextbus/ports`
// (ADR-051), and it does not need to: `TileSource` satisfies `ZoomRange` structurally, so a caller
// passes its source straight in.
//
// Floats here are compared against `spec/mercator.spec.json` with a per-row `tolerance`, never for
// equality — see that file's `doc` for the rounding convention a port must follow.

/** Edge of one tile in pixels. 256 is not free-floating: it is baked into `metresPerPixel`'s
 *  156 543.033 92 (the equatorial circumference over 256) and into every XYZ tile URL we build. */
export const TILE_SIZE = 256

/** The zoom window a tile source serves. A structural subset of `TileSource` (`@nextbus/ports`),
 *  which the kernel may not import — see the header. */
export interface ZoomRange {
  minZoom: number
  maxZoom: number
}

/** What {@link tileZoomPlan} decides: which levels to fetch, and how big to draw a base tile. */
export interface TileZoomPlan {
  /** Level to request BASE tiles from. Overzoomed on a hi-DPI screen. */
  base: number
  /** Level to request LABEL tiles from. **Never** overzoomed — see {@link tileZoomPlan}. */
  label: number
  /** Multiplier a base tile is drawn at: `2 ** (zoom - base)`. Below 1 on a hi-DPI screen. */
  scale: number
}

/** The smallest lat/lng box containing a set of points. Named by compass edge rather than
 *  min/max because every mapping engine's `fitBounds` is, and a south/north mix-up is silent. */
export interface LatLngBounds {
  south: number
  west: number
  north: number
  east: number
}

/**
 * The box a set of points fits in — the framing a route line asks its map for.
 *
 * Lives here rather than in the renderer that wanted it because a bounding box is a *number the
 * renderer would otherwise compute*, and two renderers computing it separately is how they drift
 * (ADR-068). It is also not as obvious as it looks: it is deliberately **not** antimeridian-aware.
 * The honest span of a set of points crossing 180° is the short way round, and this returns the long
 * way; Hong Kong is at 114° E and no bus route we serve comes within 60° of the seam, so the
 * correct-here answer is the simple one, stated rather than assumed.
 *
 * `undefined` for no points: an empty set has no box, and returning a degenerate one at 0,0 would
 * frame a map on the Gulf of Guinea.
 *
 * @spec mercator#boundsOf
 */
export function boundsOf(points: readonly LatLng[]): LatLngBounds | undefined {
  const first = points[0]
  if (!first) return undefined
  let { lat: south, lng: west } = first
  let north = south
  let east = west
  for (const p of points) {
    if (p.lat < south) south = p.lat
    if (p.lat > north) north = p.lat
    if (p.lng < west) west = p.lng
    if (p.lng > east) east = p.lng
  }
  return { south, west, north, east }
}

/**
 * The middle of a box, as a point — the camera an engine opens on before it is told to fit.
 *
 * The midpoint in **degrees**, not the Mercator midpoint: an engine's `center` is a lat/lng, and at
 * Hong Kong's latitude over a route's span the two differ by metres. The distinction matters enough
 * to name because {@link latToWorldY} exists two functions away and using it here would be wrong.
 *
 * @spec mercator#centreOf
 */
export function centreOf(bounds: LatLngBounds): LatLng {
  return { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 }
}

/** Width of the whole world in pixels at `zoom` — the `scale` every projection below multiplies by.
 *
 * @spec mercator#worldScale
 */
export function worldScale(zoom: number): number {
  return TILE_SIZE * 2 ** zoom
}

/** Longitude → x in world pixels. Linear, so it is only ever a sign or an off-by-half mistake:
 *  −180° is x=0, the prime meridian is the centre, +180° is x=scale.
 *
 * @spec mercator#lngToWorldX
 */
export function lngToWorldX(lng: number, scale: number): number {
  return ((lng + 180) / 360) * scale
}

/** Latitude → y in world pixels, y counted **from the north** (the OSM/Google convention, not
 *  TMS's flipped y). The log term is what makes it Mercator rather than a plate carrée, and it is
 *  the half a port is most likely to get subtly wrong — hence the equator identity in the corpus.
 *
 * @spec mercator#latToWorldY
 */
export function latToWorldY(lat: number, scale: number): number {
  const s = Math.sin((lat * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale
}

/** Ground metres per screen pixel at a zoom and latitude (256 px tiles). The `cos(lat)` is the
 *  Mercator stretch: at Hong Kong's 22°N a pixel covers ~7 % less ground than the constant alone
 *  says, which is enough to move a lone stop a zoom step.
 *
 * @spec mercator#metresPerPixel
 */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

/** Hold a zoom inside what the source actually serves. Outside it LandsD 404s and the map renders
 *  as a hole, so this is a licence-shaped clamp, not a tidiness one (ADR-049).
 *
 * @spec mercator#clampZoom
 */
export function clampZoom(zoom: number, zooms: ZoomRange): number {
  return Math.min(zooms.maxZoom, Math.max(zooms.minZoom, zoom))
}

/**
 * How a raster basemap should be requested at a given zoom on a given screen — the base level, the
 * label level, and the scale a base tile is drawn at.
 *
 * **Why the two levels differ, and why this is a rule rather than a renderer's business.** A raster
 * source that serves only 256 px tiles (LandsD does; there is no `@2x`) is upscaled on a DPR-2 screen
 * and looks soft. Requesting the tile one zoom deeper and drawing it at half size restores true 2×
 * density. But the *labels* must NOT be overzoomed: LandsD bakes label size into the raster, so a
 * label tile from one level deeper arrives with a denser, half-size label set — sharper text that is
 * harder to read, which is a worse trade than the softness it cures. The base carries no text, so it
 * loses nothing. Splitting them is only possible because the labels are a separate service, which is
 * the same property ADR-049 relies on for per-locale labels.
 *
 * A native renderer with a real map engine expresses this differently (MapLibre's `tileSize`), but it
 * has to make the same call, which is why the numbers live here rather than in a component.
 *
 * `devicePixelRatio` is clamped to 2: no raster source we use has a level worth fetching beyond that,
 * and a 3× phone would otherwise ask for two extra levels and 16× the tiles for no visible gain.
 *
 * @spec mercator#tileZoomPlan
 */
export function tileZoomPlan(
  zoom: number,
  devicePixelRatio: number,
  zooms: ZoomRange,
): TileZoomPlan {
  const dpr = Math.max(1, Math.min(2, devicePixelRatio))
  const overzoom = Math.round(Math.log2(dpr))
  const nominal = Math.round(zoom)
  const base = clampZoom(nominal + overzoom, zooms)
  return { base, label: clampZoom(nominal, zooms), scale: 2 ** (zoom - base) }
}

/** Framing zoom before layout has measured a width. Nothing is drawn in that pass — the tile loop
 *  is skipped at width 0 — so this only has to be a sane first render. */
const DEFAULT_ZOOM = 16

/**
 * **Minimum** ground a single-pin map must show across. 100 m is just under what z19 covers on a
 * ~390 px phone, so a lone stop lands on the same z19 a real place's poles do — the two read at
 * exactly one scale — and steps down only on a genuinely narrow viewport. Close enough to see which
 * side of the road the pin is on, which is why we took LandsD's dense cartography (ADR-049).
 *
 * The corpus records that the shipped constant misses that intent by ~1 m at the width the
 * component is actually handed (`mercator#fitZoom:lone-stop-on-a-390px-phone-frames-a-step-wider`).
 */
const SINGLE_PIN_MIN_SPAN_M = 100

/** Never frame tighter than z19 even where the source serves z20: LandsD's z20 is an upscale of the
 *  same survey, so it buys no detail and only makes the pin's ~10 m GPS error look like precision. */
const FRAME_MAX_Z = 19

/** A place's poles must fit inside this fraction of the viewport, so a pin near the edge is not
 *  half-clipped by its own dot and label chip. */
const FIT_FRACTION = 0.7

/** Floor of the multi-pin search. Not `zooms.minZoom` — see `fitZoom`. */
const MULTI_PIN_FLOOR_Z = 12

/** Highest zoom whose viewport still shows at least `metres` of ground across. Framing a lone stop
 *  by metres rather than by a zoom constant is what makes a phone and a tablet agree: a fixed zoom
 *  covers far more ground on the wider one. */
function zoomForSpan(metres: number, widthPx: number, lat: number, zooms: ZoomRange): number {
  for (let z = Math.min(FRAME_MAX_Z, zooms.maxZoom); z > zooms.minZoom; z--) {
    if (widthPx * metresPerPixel(lat, z) >= metres) return z
  }
  return zooms.minZoom
}

/**
 * Highest zoom that frames every point — **one rule for a lone stop and for a place's poles**.
 *
 * The two halves used to disagree: a single pin took a flat z16 while a multi-pole place fitted its
 * bounding box and landed at 18–19, eight times the ground per axis. So every GMB stand and most
 * Citybus stops rendered visibly wider than the multi-pole stop next door, for no reason a rider
 * could see. A lone stop now goes through `SINGLE_PIN_MIN_SPAN_M` instead, which is the same
 * question asked of a zero-extent bounding box.
 *
 * Two floors survive that unification, and the asymmetry is deliberate only in the sense that
 * nobody has been able to reach it: the multi-pin search stops at `MULTI_PIN_FLOOR_Z` and returns
 * it even though that zoom was already rejected, where the single-pin path steps all the way to
 * `zooms.minZoom`. Reaching it needs poles ~9 km apart, and ADR-042 clustering caps a place at tens
 * of metres. The corpus pins it (`points-kilometres-apart-stop-at-the-multi-pin-floor`) so a port
 * copies today's behaviour rather than inventing a third one.
 *
 * @spec mercator#fitZoom
 */
export function fitZoom(
  points: readonly LatLng[],
  widthPx: number,
  heightPx: number,
  zooms: ZoomRange,
): number {
  if (widthPx <= 0) return DEFAULT_ZOOM
  // Hong Kong's latitude, for the width-to-metres conversion when there is nothing to read one
  // from. The map still has a centre to draw at that point; only the scale is unanswerable.
  const lat = points[0]?.lat ?? 22.3
  if (points.length < 2) return zoomForSpan(SINGLE_PIN_MIN_SPAN_M, widthPx, lat, zooms)
  const minLat = Math.min(...points.map((p) => p.lat))
  const maxLat = Math.max(...points.map((p) => p.lat))
  const minLng = Math.min(...points.map((p) => p.lng))
  const maxLng = Math.max(...points.map((p) => p.lng))
  for (let z = Math.min(FRAME_MAX_Z, zooms.maxZoom); z > MULTI_PIN_FLOOR_Z - 1; z--) {
    const scale = worldScale(z)
    const spanX = Math.abs(lngToWorldX(maxLng, scale) - lngToWorldX(minLng, scale))
    const spanY = Math.abs(latToWorldY(maxLat, scale) - latToWorldY(minLat, scale))
    if (spanX <= widthPx * FIT_FRACTION && spanY <= heightPx * FIT_FRACTION) return z
  }
  return MULTI_PIN_FLOOR_Z
}
