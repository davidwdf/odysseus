import type { LatLng, RoutePath } from '@nextbus/core'
import { boundsOf, centreOf, routePathView } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { MAP_COLOR } from '@nextbus/ui'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useMemo, useState } from 'react'
import { useAppearance } from '../lib/appearance'
import { useLocale } from '../providers/LocaleProvider'
import { MapView } from './MapView'

const SOURCE = 'route-line'
const CASING_LAYER = 'route-line-casing'
const LINE_LAYER = 'route-line-fill'

/** The strip's height, shared with the placeholder so an arriving line does not move the list. */
const HEIGHT = 220

/** Victoria Harbour. The camera of last resort, and never seen in practice — see `centre` below. */
const HONG_KONG: LatLng = { lat: 22.3193, lng: 114.1694 }

/**
 * A route's geography: the road it follows (ADR-152/154).
 *
 * **What is drawn is a kernel decision, not this component's.** `routePathView` returns one of three
 * answers — the surveyed road, an honest sketch, or nothing — and the reason the third exists is that
 * the obvious fallback lies: hkbus.app joins the ordered stops with straight lines whenever geometry
 * is missing, unmarked, which for KMB 101R draws a bus crossing Victoria Harbour through the water.
 * Under rule 3 (ADR-008) that is the cartographic twin of a fake countdown.
 *
 * So a sketch is **dashed** and says so in words. The dash is the whole point: it is the difference
 * between “this is the road” and “these are the stops, in order”, and it is why nothing else on this
 * map is ever dashed.
 *
 * **`pending` is separate from the answer, and must be.** `routePathView(false, …)` means *asked and
 * told no*, which for a dense urban route is a legitimate `approximate`. Feeding it a query that has
 * not resolved would flash a dashed sketch for every route on the way to its real line — the honest
 * fallback used as a loading state, which is exactly the confidence trick the fallback exists to
 * avoid. So while the answer is in flight this draws a placeholder of the same height and no line.
 *
 * ## Colours come in pairs, and that is not decoration
 *
 * The basemap inverts in dark mode and the overlay does not (`MapView`, ADR-049), so a line dark
 * enough to read on paper is invisible on the inverted map. `MAP_COLOR.route`/`routeInverted` and
 * `routeCasing`/`routeCasingInverted` are that pair; the casing is what separates the line from the
 * tiles in either mode.
 *
 * Markers, direction chevrons and tap-to-focus are **M7**, not this row: `docs/proposals/06 §8d`
 * settles what a tap means, and drawing selectable markers before that is settled would ship an
 * interaction no spec covers.
 */
export function RouteMap({
  path,
  pending,
  stops,
  className,
}: {
  /** The edge's answer. `undefined` means it has not arrived — see `pending`. */
  path: RoutePath | undefined
  /** True while the answer is in flight. Not the same as an answer of “no line”. */
  pending: boolean
  /** The route's stops in travel order — the sketch's raw material, and the map's framing. */
  stops: readonly LatLng[]
  className?: string
}) {
  const locale = useLocale()
  const mode = useAppearance()
  // State, not a ref: adding the line is an effect that must re-run when the map arrives, and a ref
  // assignment does not re-render. Getting this wrong loses the line whenever the geometry resolves
  // before the style loads — which, with `staleTime: Infinity`, is every visit after the first.
  const [map, setMap] = useState<MapLibreMap | null>(null)

  const presentation = useMemo(() => {
    if (pending) return undefined
    // The wire carries `number[][]` and the kernel wants `[lng, lat]` pairs. Converted rather than
    // cast: the contract constrains the length with `.length(2)`, which Zod cannot express in the
    // inferred TYPE, so a cast would assert something the compiler is right to doubt. A vertex that
    // is not a pair is dropped rather than drawn — a malformed upstream should shorten the line,
    // never bend it. (This is also the one place the two coordinate orders meet: the wire is GeoJSON
    // `[lng, lat]`, the reverse of `LatLng` everywhere else, which the schema documents.)
    const line = (path?.path ?? []).flatMap((c) =>
      c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number'
        ? [[c[0], c[1]] as [number, number]]
        : [],
    )
    return routePathView(path?.available ?? false, line, stops)
  }, [path, pending, stops])

  const drawn = presentation && presentation.kind !== 'none' ? presentation.line : undefined

  // The line's extent and its middle, from the kernel. Both are *numbers a renderer would otherwise
  // compute*, which is the thing two renderers do differently (ADR-068) — so `boundsOf`/`centreOf`
  // are corpus-pinned in `@nextbus/core` and this only translates the result into MapLibre's
  // vocabulary. The `.map` is the coordinate-order swap and nothing else: the line is GeoJSON
  // `[lng, lat]`, the kernel's points are `{ lat, lng }`.
  const bounds = useMemo(
    () => (drawn ? boundsOf(drawn.map((c) => ({ lat: c[1], lng: c[0] }))) : undefined),
    [drawn],
  )

  // Frame the whole route, once per line. `fitBounds` rather than a centre and a zoom because the
  // right zoom is a property of the route: KMB 1 is 8 km and 6C is 40, and a fixed zoom shows the
  // second one as a fragment. `animate: false` — this is the opening view, not a movement.
  useEffect(() => {
    if (!map || !bounds) return
    map.fitBounds([bounds.west, bounds.south, bounds.east, bounds.north], {
      padding: 28,
      animate: false,
    })
  }, [map, bounds])

  // Draw (or redraw) the line. Adding the source once and setting its data afterwards — rather than
  // removing and re-adding layers — is what keeps a redraw from flickering the whole overlay.
  useEffect(() => {
    if (!map) return
    const data = {
      type: 'FeatureCollection' as const,
      features: drawn?.length
        ? [
            {
              type: 'Feature' as const,
              properties: {},
              geometry: {
                type: 'LineString' as const,
                coordinates: drawn.map((c) => [c[0], c[1]]),
              },
            },
          ]
        : [],
    }

    const existing = map.getSource(SOURCE)
    if (existing && 'setData' in existing) {
      ;(existing as { setData: (d: unknown) => void }).setData(data)
      return
    }
    map.addSource(SOURCE, { type: 'geojson', data })
    map.addLayer({
      id: CASING_LAYER,
      type: 'line',
      source: SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 8.4, 'line-opacity': 0.9 },
    })
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 5 },
    })
  }, [map, drawn])

  // Colour and dash are properties of the ANSWER and of the appearance, so they are set apart from
  // the geometry: a route whose real line arrives after a sketch was drawn must stop being dashed,
  // and a rider who flips to dark at sunset must not lose the line, without either rebuilding it.
  useEffect(() => {
    if (!map?.getLayer(LINE_LAYER)) return
    const dark = mode === 'dark'
    map.setPaintProperty(
      CASING_LAYER,
      'line-color',
      dark ? MAP_COLOR.routeCasingInverted : MAP_COLOR.routeCasing,
    )
    map.setPaintProperty(LINE_LAYER, 'line-color', dark ? MAP_COLOR.routeInverted : MAP_COLOR.route)
    // `[1]` is MapLibre's way of saying “solid”: a one-entry array is an unbroken dash.
    map.setPaintProperty(
      LINE_LAYER,
      'line-dasharray',
      presentation?.kind === 'approximate' ? [2, 1.6] : [1],
    )
    // No `drawn` here, though the layers it creates are what this paints. React runs a commit's
    // effects in declaration order, so the effect above has already created them by the time this
    // one runs — and on every later change `map` is unchanged, so listing `drawn` would only
    // re-set four properties to the values they already hold.
  }, [map, mode, presentation?.kind])

  // Nothing to show and nothing coming: no map. A basemap with no line on it is not a route screen's
  // job, and reserving space for a line that will never arrive is worse than the absence.
  if (presentation?.kind === 'none') return null

  // The camera for the one frame before `fitBounds` runs. `HONG_KONG` only when there is no line at
  // all to read a centre from, which on this branch means a sketch of nothing — unreachable today,
  // and cheaper to answer than to prove impossible.
  const centre = bounds ? centreOf(bounds) : HONG_KONG

  return (
    <figure className={className} aria-label={t(locale, 'routePathLabel')}>
      {presentation ? (
        <MapView
          centre={centre}
          zoom={13}
          className="w-full overflow-hidden rounded-md"
          style={{ height: HEIGHT }}
          onReady={setMap}
        />
      ) : (
        <div
          className="w-full animate-pulse rounded-md bg-surface-2"
          style={{ height: HEIGHT }}
          aria-hidden="true"
        />
      )}
      {presentation?.kind === 'approximate' ? (
        // Said ONCE, at the screen level — the same shape as the freshness notice (ADR-133/150), and
        // for the same reason: the fact is about the whole line, so a per-segment cue would draw one
        // fact hundreds of times.
        <figcaption className="pt-1 text-caption text-muted">
          {t(locale, 'routePathApproximate')}
        </figcaption>
      ) : null}
    </figure>
  )
}
