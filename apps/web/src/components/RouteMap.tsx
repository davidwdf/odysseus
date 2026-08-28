import type { LatLng, MarkerStop, RoutePath } from '@nextbus/core'
import {
  accuracyRadiusM,
  boundsOf,
  centreOf,
  focusZoom,
  locationMark,
  metresPerPixel,
  routeMarkers,
  routePathView,
} from '@nextbus/core'
import { t } from '@nextbus/i18n'
import type { GeoFix } from '@nextbus/ports'
import { MAP_COLOR } from '@nextbus/ui'
import { type Map as MapLibreMap, Marker } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { mapProvider } from '../adapters/mapProvider'
import { useAppearance } from '../lib/appearance'
import { useLocale } from '../providers/LocaleProvider'
import { MapControls } from './MapControls'
import { MapView } from './MapView'
import { riderMarkElement } from './riderMarkElement'
import { routeChevronImage } from './routeChevronImage'
import { routeMarkerElement, setMarkerSelected } from './routeMarkerElement'

const SOURCE = 'route-line'
const CASING_LAYER = 'route-line-casing'
const LINE_LAYER = 'route-line-fill'
const CHEVRON_LAYER = 'route-line-direction'
const ACCURACY_SOURCE = 'rider-accuracy'
const ACCURACY_LAYER = 'rider-accuracy-fill'
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

/**
 * The camera's padding, in pixels, from the fractions of the map that something else is covering.
 *
 * A base inset on every side so a route never runs to the very edge, plus whatever the sheet and the
 * floating chrome are hiding. MapLibre applies this to `fitBounds` and `flyTo` alike, which is what
 * makes "centred" mean centred in the part a rider can actually see.
 */
function cameraPadding(
  map: MapLibreMap,
  inset: { top?: number; bottom?: number } | undefined,
): { top: number; bottom: number; left: number; right: number } {
  const height = map.getContainer().clientHeight
  return {
    top: EDGE_PADDING + (inset?.top ?? 0) * height,
    bottom: EDGE_PADDING + (inset?.bottom ?? 0) * height,
    left: EDGE_PADDING,
    right: EDGE_PADDING,
  }
}

/** Breathing room on every side, so a terminus marker is never half off the screen. */
const EDGE_PADDING = 28

/**
 * **The map fills whatever it is given.** It was a fixed 220 px strip until the shell landed
 * (`proposals/06 §8`); now it is the screen's base layer and its height is the container's. The
 * placeholder matches, so a route whose geometry is still in flight reserves exactly the space the
 * map will take rather than a guess at it.
 */
const FILL = 'h-full w-full'

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
  boardingIndex,
  onSelectStop,
  rider,
  visibleInset,
  onInteract,
  controlLabels,
  className,
}: {
  /** The edge's answer. `undefined` means it has not arrived — see `pending`. */
  path: RoutePath | undefined
  /** True while the answer is in flight. Not the same as an answer of “no line”. */
  pending: boolean
  /** The route's stops in travel order — the sketch's raw material, and the map's framing. */
  stops: readonly MarkerStop[]
  /** The stop the rider has focused, by index. The camera goes there; the marker grows. */
  focusedIndex?: number | undefined
  /** The stop they arrived from, by index — marked inside rather than by growing. */
  boardingIndex?: number | undefined
  /** A marker was tapped. The screen decides what that means — here it is only reported. */
  onSelectStop?: ((index: number) => void) | undefined
  /** The rider's own position, if they have granted it. `undefined` means no mark is drawn. */
  rider?: { fix?: GeoFix; compassDeg?: number } | undefined
  /**
   * How much of the map is **covered by something else**, as fractions of its height — the sheet at
   * the bottom, the floating chrome at the top.
   *
   * Every camera move is inset by it, which is the difference between "centred" and "centred where
   * the rider can see". Without it a full-bleed map frames the route behind the sheet, and a rider
   * looking at the visible half sees the top of their route and nothing else.
   */
  visibleInset?: { top?: number; bottom?: number } | undefined
  /** The rider touched the map. The screen uses it to collapse its chrome; the map itself does not care. */
  onInteract?: (() => void) | undefined
  /** Names for the two floating controls — this component owns *when* they appear, not what they say. */
  controlLabels: { recentre: string; locate: string }
  className?: string
}) {
  const locale = useLocale()
  const mode = useAppearance()
  // State, not a ref: adding the line is an effect that must re-run when the map arrives, and a ref
  // assignment does not re-render. Getting this wrong loses the line whenever the geometry resolves
  // before the style loads — which, with `staleTime: Infinity`, is every visit after the first.
  const [map, setMap] = useState<MapLibreMap | null>(null)
  /**
   * Whether the rider has moved the camera away from the opening frame.
   *
   * Gates the recentre control: before they have moved it, "show the whole route" is what they are
   * already looking at, and a button that does nothing is a button that teaches them not to press it.
   */
  const [moved, setMoved] = useState(false)
  /** The placed marker elements, so selection can be moved between them without replacing any. */
  const markerElements = useRef<HTMLElement[]>([])
  // The focused stop as a REF as well as a value: the placement effect has to apply the current
  // selection to markers it has just created, and reading it through a ref is what keeps it out of
  // that effect's dependencies — which is the whole point, since depending on it is what used to
  // rebuild all 25 markers on every tap.
  const focusedRef = useRef(focusedIndex)
  focusedRef.current = focusedIndex
  // Destructured so the effects below depend on the two VALUES rather than on the wrapper, which
  // `useRiderPosition` rebuilds every render — depending on the object would tear down and re-place
  // the rider's mark on every arrival tick.
  const riderFix = rider?.fix
  const riderCompass = rider?.compassDeg

  /**
   * A rider touching the map is the screen's cue to get its chrome out of the way — reported rather
   * than acted on, because this component has no opinion about anybody's header.
   *
   * **`originalEvent` is what makes it the rider's**, and leaving it out was a real bug: `fitBounds`
   * fires `zoomstart` too, so the opening frame collapsed the card before anybody had touched
   * anything. MapLibre attaches the DOM event that caused a camera move and attaches nothing when the
   * app caused it, so the guard is exact rather than a heuristic — and it also covers the flight a
   * stop tap starts, which must not count as the rider dismissing the header either.
   */
  useEffect(() => {
    if (!map || !onInteract) return
    const fromRider = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent !== undefined) onInteract()
    }
    map.on('dragstart', fromRider)
    map.on('zoomstart', fromRider)
    return () => {
      map.off('dragstart', fromRider)
      map.off('zoomstart', fromRider)
    }
  }, [map, onInteract])

  useEffect(() => {
    if (!map) return
    // Rider-driven only, by the same `originalEvent` test the chrome collapse uses: our own `fitBounds`
    // and `flyTo` must not make the recentre control appear, or it would be offered from the first
    // frame and mean nothing.
    const moveEnd = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent !== undefined) setMoved(true)
    }
    map.on('dragend', moveEnd)
    map.on('zoomend', moveEnd)
    return () => {
      map.off('dragend', moveEnd)
      map.off('zoomend', moveEnd)
    }
  }, [map])

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

  /**
   * What glyph each stop gets, **where it is anchored**, and which way it faces — a kernel rule,
   * corpus-pinned (ADR-068).
   *
   * Given the drawn line, so each stop is projected onto it. A stop's published coordinate is beside
   * the road — often 10–20 m off — which is invisible at a whole-route zoom and scatters the markers
   * off the line at street level, where the kerb offset stops meaning anything because there is no
   * kerb under it. Anchoring at the projection is what keeps them on the road at **every** zoom, which
   * is what the mockups did.
   *
   * The screen calls the same rule without a line to shape the rail's sequence nodes: it needs only
   * `kind`, and the fallback answers that identically.
   */
  const markers = useMemo(() => routeMarkers(stops, drawn), [stops, drawn])

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
      padding: cameraPadding(map, visibleInset),
      animate: false,
    })
  }, [map, bounds, visibleInset])

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
   *
   * **`focusedIndex` is deliberately not a dependency**, and it is read through `focusedRef` so that
   * stays true. Listing it would rebuild all 25 markers on every tap, which is what made a selected
   * marker *appear* at its larger size rather than grow into it — the pop this effect's split was made
   * to remove. Selection is the next effect's job; this one only needs to know where selection stands
   * at the moment it creates an element.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `focusedIndex` is read via a ref, on purpose — see above
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
      return (
        new Marker({ element, offset })
          // `marker.at`, not `stop.location` — the kernel has already put this on the line.
          .setLngLat([marker.at.lng, marker.at.lat])
          .addTo(map)
      )
    })
    markerElements.current = placed.map((m) => m.getElement())
    // Markers created while a stop is already focused start selected — otherwise a re-place (a locale
    // change, an appearance flip) would silently drop the rider's selection.
    for (const [index, el] of markerElements.current.entries()) {
      setMarkerSelected(el, index === focusedRef.current)
    }
    return () => {
      for (const m of placed) m.remove()
      markerElements.current = []
    }
  }, [map, markers, stops, locale, mode, boardingIndex, onSelectStop, presentation?.kind])

  /**
   * Move the selection between markers that are already on the map, so CSS can ease the scale.
   *
   * A separate effect from the one that places them, and that separation *is* the fix: placing depends
   * on the geometry and the appearance, selecting depends on which stop the rider tapped, and folding
   * the second into the first made every tap a teardown of the whole set.
   */
  useEffect(() => {
    for (const [index, el] of markerElements.current.entries()) {
      setMarkerSelected(el, index === focusedIndex)
    }
  }, [focusedIndex])

  /**
   * **The rider's own position**, and the circle of uncertainty around it (M5, `proposals/06 §6b`).
   *
   * Both are kernel answers: `locationMark` decides dart-or-dot from the two heading sources in their
   * settled precedence, and `accuracyRadiusM` decides whether a circle says anything at all. Neither
   * is re-taken here — this places what it is handed.
   *
   * The mark is a DOM `Marker` for the same reasons the stop markers are: it carries a real accessible
   * name, and a canvas symbol would carry none. The **circle is a layer**, because it is measured in
   * metres and has to grow and shrink with the zoom — a DOM element sized in pixels would claim a
   * different accuracy at every zoom level, which is the opposite of what it is for.
   */
  useEffect(() => {
    if (!map || !riderFix) return
    const mark = locationMark({ compassDeg: riderCompass, courseDeg: riderFix.headingDeg })
    const marker = new Marker({ element: riderMarkElement(mark, locale) })
      .setLngLat([riderFix.lng, riderFix.lat])
      .addTo(map)
    return () => {
      marker.remove()
    }
  }, [map, riderFix, riderCompass, locale])

  useEffect(() => {
    if (!map) return
    const radius = accuracyRadiusM(riderFix?.accuracyM)
    const fix = riderFix
    if (!fix || radius === undefined) {
      if (map.getLayer(ACCURACY_LAYER)) map.removeLayer(ACCURACY_LAYER)
      if (map.getSource(ACCURACY_SOURCE)) map.removeSource(ACCURACY_SOURCE)
      return
    }
    const data = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: [fix.lng, fix.lat] },
    }
    const existing = map.getSource(ACCURACY_SOURCE)
    if (existing && 'setData' in existing) {
      ;(existing as { setData: (d: unknown) => void }).setData(data)
    } else {
      map.addSource(ACCURACY_SOURCE, { type: 'geojson', data })
      map.addLayer(
        {
          id: ACCURACY_LAYER,
          type: 'circle',
          source: ACCURACY_SOURCE,
          paint: {
            'circle-color': MAP_COLOR.riderAccuracy,
            'circle-opacity': 0.16,
            'circle-stroke-color': MAP_COLOR.riderAccuracy,
            'circle-stroke-opacity': 0.35,
            'circle-stroke-width': 1,
            'circle-radius': 1,
          },
        },
        // Beneath the route line: the circle is context for the rider's mark, and a translucent disc
        // over the line would tint the one thing the screen is actually about.
        CASING_LAYER,
      )
    }
    // `circle-radius` is PIXELS, so the metres have to be converted at the current zoom and redone
    // whenever it changes — which is the whole reason this is a layer rather than a sized DOM element.
    // `metresPerPixel` is the kernel's, at the fix's own latitude.
    const resize = () => {
      const perPixel = metresPerPixel(fix.lat, map.getZoom())
      map.setPaintProperty(ACCURACY_LAYER, 'circle-radius', radius / perPixel)
    }
    resize()
    map.on('zoom', resize)
    return () => {
      map.off('zoom', resize)
    }
  }, [map, riderFix])

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
      padding: cameraPadding(map, visibleInset),
      center: [stop.location.lng, stop.location.lat],
      // The source's own range, not a compiled-in ceiling: LandsD answers 404 above z20 and the
      // map would render as a hole rather than a coarser map (ADR-049).
      zoom: focusZoom(map.getZoom(), mapProvider),
      essential: true,
    })
  }, [map, focusedIndex, stops, visibleInset])

  // Nothing to show and nothing coming: no map. A basemap with no line on it is not a route screen's
  // job, and reserving space for a line that will never arrive is worse than the absence.
  if (presentation?.kind === 'none') return null

  // The camera for the one frame before `fitBounds` runs. `HONG_KONG` only when there is no line at
  // all to read a centre from, which on this branch means a sketch of nothing — unreachable today,
  // and cheaper to answer than to prove impossible.
  const centre = bounds ? centreOf(bounds) : HONG_KONG

  return (
    <figure className={`${className ?? ''} m-0`} aria-label={t(locale, 'routePathLabel')}>
      {presentation ? (
        <MapView centre={centre} zoom={13} className={FILL} onReady={setMap} />
      ) : (
        <div className={`${FILL} animate-pulse bg-surface-2`} aria-hidden="true" />
      )}
      <MapControls
        bottom={(visibleInset?.bottom ?? 0) * (map?.getContainer().clientHeight ?? 0)}
        recentreLabel={controlLabels.recentre}
        locateLabel={controlLabels.locate}
        onRecentre={
          map && bounds && moved
            ? () => {
                map.fitBounds([bounds.west, bounds.south, bounds.east, bounds.north], {
                  padding: cameraPadding(map, visibleInset),
                })
                setMoved(false)
              }
            : undefined
        }
        onLocate={
          map && riderFix
            ? () => {
                map.flyTo({
                  center: [riderFix.lng, riderFix.lat],
                  zoom: focusZoom(map.getZoom(), mapProvider),
                  padding: cameraPadding(map, visibleInset),
                  essential: true,
                })
                setMoved(true)
              }
            : undefined
        }
      />
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
