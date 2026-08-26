import type { LatLng, MarkerStop, RoutePath } from '@nextbus/core'
import { boundsOf, centreOf, focusZoom, routeMarkers, routePathView } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { MAP_COLOR } from '@nextbus/ui'
import { type Map as MapLibreMap, Marker } from 'maplibre-gl'
import { useEffect, useMemo, useState } from 'react'
import { mapProvider } from '../adapters/mapProvider'
import { useAppearance } from '../lib/appearance'
import { useLocale } from '../providers/LocaleProvider'
import { MapView } from './MapView'
import { routeChevronImage } from './routeChevronImage'
import { routeMarkerElement } from './routeMarkerElement'

const SOURCE = 'route-line'
const CASING_LAYER = 'route-line-casing'
const LINE_LAYER = 'route-line-fill'
const CHEVRON_LAYER = 'route-line-direction'
const CHEVRON_IMAGE = 'route-chevron'
/**
 * Distance between direction marks, in pixels along the rendered line.
 *
 * Round 5 settled *"spaced between stops"*, which a mockup could do because it placed each mark by arc
 * length on an SVG path it owned. MapLibre spaces symbols itself and has no notion of where the stops
 * are, so this is the same intent expressed in the engine's vocabulary.
 *
 * **60, chosen by counting rather than by taste.** The value is in *tile* pixels, not screen pixels, so
 * it does not mean what it appears to: at the zoom a whole route is framed at, 110 put four marks on an
 * 8 km route — technically present and useless as a direction cue. Sampling the drawn symbols at 110 /
 * 60 / 35 / 20 gave roughly 4 / 8 / 10 / 20 marks; 8 is about one per three stops, which reads as a
 * current along the line rather than a row of arrows.
 */
const CHEVRON_SPACING = 60

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
  focusedIndex,
  onSelectStop,
  className,
  style,
}: {
  /** The edge's answer. `undefined` means it has not arrived — see `pending`. */
  path: RoutePath | undefined
  /** True while the answer is in flight. Not the same as an answer of “no line”. */
  pending: boolean
  /** The route's stops in travel order — the sketch's raw material, and the map's framing. */
  stops: readonly MarkerStop[]
  /** The stop the rider has focused, by index. The camera goes there; the marker grows. */
  focusedIndex?: number | undefined
  /** A marker was tapped. The screen decides what that means — here it is only reported. */
  onSelectStop?: ((index: number) => void) | undefined
  className?: string
  /** Inline geometry — the sticky offset, which is a layout value the screen owns (ADR-112). */
  style?: React.CSSProperties
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
    return routePathView(
      path?.available ?? false,
      line,
      stops.map((s) => s.location),
    )
  }, [path, pending, stops])

  const drawn = presentation && presentation.kind !== 'none' ? presentation.line : undefined

  // What glyph each stop gets and which way it faces — a kernel rule, corpus-pinned (ADR-068), and
  // **computed by the screen**, which also shapes the rail nodes from it. Passed in rather than
  // recomputed so the map and the list cannot end up saying different things about one stop.
  const markers = useMemo(() => routeMarkers(stops), [stops])

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

  /**
   * **Which way the bus goes**, as a repeating mark along the line (§8d).
   *
   * A `symbol-placement: 'line'` layer rather than marks this component positions: MapLibre already
   * knows the line's screen geometry at every zoom, and re-deriving it here to place arrows would be
   * the mockup's `getPointAtLength` machinery rewritten against an engine that does not need it.
   *
   * **The direction is real, and it is `orientToStops` that makes it so** (ADR-152). MapLibre rotates
   * each icon to the local vertex order; the edge has already reversed the surveyed line where it ran
   * against the stop sequence, so vertex order *is* travel order. Without that step this layer would
   * point half the network's routes backwards, and it would look completely deliberate.
   *
   * ⚠️ **Round 5's bend avoidance is not reproduced.** The mockup slid each mark along its slot to the
   * straightest spot it could reach and dropped it if even that was a corner; MapLibre places symbols
   * on its own schedule and exposes no such hook. In practice its own collision handling covers the
   * worst of it — a mark on a tight bend is rotated, not mangled — and the alternative is owning
   * placement, which is the thing this layer exists to avoid. Recorded rather than quietly dropped.
   */
  useEffect(() => {
    if (!map || !drawn?.length) return
    const casing = mode === 'dark' ? MAP_COLOR.routeCasingInverted : MAP_COLOR.routeCasing
    const image = routeChevronImage(casing, window.devicePixelRatio || 1)
    // Re-added rather than recoloured: `icon-color` only applies to SDF images, and an SDF would mean
    // a build step for a two-stroke glyph. Removing first because `addImage` throws on a duplicate id.
    if (map.hasImage(CHEVRON_IMAGE)) map.removeImage(CHEVRON_IMAGE)
    map.addImage(CHEVRON_IMAGE, image, { pixelRatio: window.devicePixelRatio || 1 })
    if (!map.getLayer(CHEVRON_LAYER)) {
      map.addLayer({
        id: CHEVRON_LAYER,
        type: 'symbol',
        source: SOURCE,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': CHEVRON_SPACING,
          'icon-image': CHEVRON_IMAGE,
          'icon-rotation-alignment': 'map',
          // Overlap allowed, padding zero: these are a texture along one line, and letting MapLibre
          // drop them for collisions would thin the marks out exactly where the route bends most —
          // which is where a rider most wants to know which way it goes.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
    }
    return () => {
      if (map.getLayer(CHEVRON_LAYER)) map.removeLayer(CHEVRON_LAYER)
      if (map.hasImage(CHEVRON_IMAGE)) map.removeImage(CHEVRON_IMAGE)
    }
  }, [map, drawn, mode])

  /**
   * The markers, rebuilt whenever what they say changes.
   *
   * `Marker` owns its own DOM and its own projection, so these are created imperatively and torn down
   * together — cheap at a route's 13–41 stops, and the alternative (diffing 41 markers to move one
   * selection) buys nothing at this size while adding a second place for the selected index to live.
   *
   * Deliberately keyed on `presentation` as well as `markers`: a route whose answer is `none` renders
   * no map at all, so its markers must go with it rather than outliving the map they were anchored to.
   */
  useEffect(() => {
    if (!map || presentation?.kind === undefined || presentation.kind === 'none') return
    const dark = mode === 'dark'
    const placed = markers.map((marker) => {
      const stop = stops[marker.index] as MarkerStop
      const { element, offset } = routeMarkerElement({
        kind: marker.kind,
        bearing: marker.bearing,
        name: stop.name,
        locale,
        dark,
        selected: marker.index === focusedIndex,
        onSelect: () => onSelectStop?.(marker.index),
      })
      return new Marker({ element, offset })
        .setLngLat([stop.location.lng, stop.location.lat])
        .addTo(map)
    })
    return () => {
      for (const m of placed) m.remove()
    }
  }, [map, markers, stops, locale, mode, focusedIndex, onSelectStop, presentation?.kind])

  /**
   * Fly to the focused stop — §8d's *"tap a stop row focuses it on the map"*, and the whole of what
   * survived M6 (`proposals/06 §6b`).
   *
   * `flyTo` rather than `jumpTo` because the rider asked for this one: the arc is what connects where
   * they were looking to where they are now, and a cut would leave them re-reading the map to find out
   * what moved. `essential: true` so it still happens under *prefers-reduced-motion* — MapLibre would
   * otherwise skip the animation, which here would silently become a jump rather than no motion, and a
   * rider who asked to see a stop should see it either way.
   *
   * There is **no pan-to-suspend and no recentre affordance**, and that is the point of closing M6: the
   * camera only ever moves because a rider tapped something, so nothing is fighting them for it.
   */
  useEffect(() => {
    if (!map || focusedIndex === undefined) return
    const stop = stops[focusedIndex]
    if (!stop) return
    map.flyTo({
      center: [stop.location.lng, stop.location.lat],
      // The source's own range, not a compiled-in ceiling: LandsD answers 404 above z20 and the
      // map would render as a hole rather than a coarser map (ADR-049).
      zoom: focusZoom(map.getZoom(), mapProvider),
      essential: true,
    })
  }, [map, focusedIndex, stops])

  // Nothing to show and nothing coming: no map. A basemap with no line on it is not a route screen's
  // job, and reserving space for a line that will never arrive is worse than the absence.
  if (presentation?.kind === 'none') return null

  // The camera for the one frame before `fitBounds` runs. `HONG_KONG` only when there is no line at
  // all to read a centre from, which on this branch means a sketch of nothing — unreachable today,
  // and cheaper to answer than to prove impossible.
  const centre = bounds ? centreOf(bounds) : HONG_KONG

  return (
    <figure className={className} style={style} aria-label={t(locale, 'routePathLabel')}>
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
