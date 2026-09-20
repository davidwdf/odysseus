import { boundsOf, type LatLng, locationMark } from '@nextbus/core'
import type { GeoFix } from '@nextbus/ports'
import { MAP_COLOR } from '@nextbus/ui'
import { type Map as MapLibreMap, Marker } from 'maplibre-gl'
import { useEffect, useMemo, useState } from 'react'
import { useLocale } from '../providers/LocaleProvider'
import { MapControls } from './MapControls'
import { MapView } from './MapView'
import { cameraPadding } from './mapCamera'
import { riderMarkElement } from './riderMarkElement'

/** Victoria Harbour. The camera of last resort, and never seen with a fix — see `centre` below. */
const HONG_KONG: LatLng = { lat: 22.3193, lng: 114.1694 }

/** One place on the map: where it is, what it is called, and whether the rider saved something there. */
export interface MapPlace {
  id: string
  location: LatLng
  name: string
  saved: boolean
}

/**
 * **The places around a rider, on a map** — Home's base layer (ADR-183).
 *
 * ## It is a composition, not a generalisation
 *
 * The obvious move was to widen `RouteMap` until Home could use it. That would have been wrong:
 * `RouteMap` is 700 lines of *route* — a road-following polyline with a casing and direction chevrons,
 * markers that know their sequence number and whether they are a terminus, a focus that scrolls a list.
 * None of it is a place near a rider. What the two actually share is `MapView` (the engine, the tiles,
 * the dark-mode raster paint, the attribution) and `cameraPadding`, and both were already separable.
 * Widening would have produced one component with two modes and a prop for every difference.
 *
 * ## Both of `RouteMap`'s camera traps are carried over deliberately
 *
 * They are written down there at length because each cost real time, and a second map is exactly where
 * they would be re-learnt:
 *
 * 1. **The inset is depended on as two numbers, never as the object.** A caller passes
 *    `visibleInset={{ bottom: sheetFraction }}` as a literal, which is a fresh object every render — so
 *    depending on it re-ran the framing on every ETA tick and every frame of a sheet drag, snapping the
 *    camera back inside one frame. The symptom is not a flickering map; it is a map that **cannot be
 *    panned at all.**
 * 2. **`moved` is a guard, not just an optimisation.** Once a rider has moved the camera it is theirs
 *    until they hand it back. The inset legitimately changes when they drag the sheet, and re-framing
 *    then would discard the pan they had just made.
 *
 * ## The markers are DOM, and the rider's mark is the kernel's
 *
 * A DOM `Marker` carries a real accessible name where a canvas symbol carries none — the same reason
 * `RouteMap`'s stop markers are DOM. `locationMark` decides dart-or-dot from the heading sources in
 * their settled precedence (ADR-049 / `proposals/06 §6b`); this places what it is handed and re-takes
 * nothing.
 */
export function PlacesMap({
  places,
  rider,
  visibleInset,
  onSelectPlace,
  onInteract,
  controlLabels,
  className,
}: {
  places: readonly MapPlace[]
  rider?: { fix?: GeoFix; compassDeg?: number } | undefined
  /** Fractions of the map height that the sheet and the floating chrome are covering. */
  visibleInset?: { top?: number; bottom?: number } | undefined
  onSelectPlace?: ((id: string) => void) | undefined
  /** Fired on a rider-driven gesture only, so a screen can collapse its chrome. */
  onInteract?: (() => void) | undefined
  controlLabels: { locate: string }
  className?: string
}) {
  const locale = useLocale()
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [moved, setMoved] = useState(false)

  // **Read as two numbers, never as the object.** See trap 1 above.
  const insetTop = visibleInset?.top ?? 0
  const insetBottom = visibleInset?.bottom ?? 0

  const riderFix = rider?.fix
  const riderCompass = rider?.compassDeg

  /**
   * **`places` must be content-stable, and the caller is what makes it so.**
   *
   * A live round rebuilds the board every cadence with the same coordinates in it, so an array that is
   * merely *equal* re-frames the camera every thirty seconds and undoes a rider's pan on a clock —
   * which is the bug `useStableValue` was written for, measured on the route screen before it existed.
   * The first draft of this file dodged it by joining the coordinates into a signature string; that is
   * a second copy of the value, kept in step by hand, and `check-no-derivation` was right to object.
   * `Home` wraps what it passes; this depends on the array itself and says why.
   */
  const bounds = useMemo(() => boundsOf(places.map((p) => p.location)), [places])

  /** The first frame's centre. `HONG_KONG` only before anything is known — never seen with a fix. */
  const centre = riderFix ?? places[0]?.location ?? HONG_KONG

  /** A rider-driven gesture, told apart from our own `fitBounds` by `originalEvent`. */
  useEffect(() => {
    if (!map) return
    const onMove = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return
      setMoved(true)
      onInteract?.()
    }
    map.on('dragstart', onMove)
    map.on('zoomstart', onMove)
    return () => {
      map.off('dragstart', onMove)
      map.off('zoomstart', onMove)
    }
  }, [map, onInteract])

  /** Frame every place, inset by whatever the sheet is covering. See both traps above. */
  useEffect(() => {
    if (!map || !bounds || moved) return
    map.fitBounds([bounds.west, bounds.south, bounds.east, bounds.north], {
      padding: cameraPadding(map, { top: insetTop, bottom: insetBottom }),
      animate: false,
    })
  }, [map, bounds, insetTop, insetBottom, moved])

  /** A marker per place. Rebuilt when the set changes, which on this screen is rare. */
  useEffect(() => {
    if (!map) return
    const markers = places.map((place) => {
      const element = placeMarkElement(place)
      if (onSelectPlace) {
        element.addEventListener('click', (event) => {
          // The map is under a sheet; a marker tap must not also be read as a map gesture.
          event.stopPropagation()
          onSelectPlace(place.id)
        })
      }
      return new Marker({ element }).setLngLat([place.location.lng, place.location.lat]).addTo(map)
    })
    return () => {
      for (const marker of markers) marker.remove()
    }
  }, [map, places, onSelectPlace])

  /** The rider's own mark. `locationMark` decides its shape; this places it. */
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

  return (
    <div className={className}>
      <MapView centre={centre} zoom={15} onReady={setMap} className="h-full w-full" />
      {/* Only once the rider has taken the camera — a control that hands back a view they never left is
          the thing `RouteMap`'s own note records the owner reporting as broken. */}
      {moved ? (
        <MapControls
          locateLabel={controlLabels.locate}
          onLocate={() => setMoved(false)}
          // In CSS pixels, which is what the control wants — the inset is a fraction of the map, and
          // the map is the viewport here.
          bottom={insetBottom * (map?.getContainer().clientHeight ?? 0)}
        />
      ) : null}
    </div>
  )
}

/**
 * A place's mark: a disc, punched out of the map rather than resting on it.
 *
 * The same construction `routeMarkerElement` argues for — fill with the casing colour and stroke with
 * the line's, so the mark reads as a hole in the basemap rather than a bead on top of it — and the same
 * heavy stroke, because a hairline reads as a thin ring around a separate object over dense tiles.
 *
 * **A saved place is the accent, not a third colour.** `--accent` is ink on light and paper on dark, so
 * it inverts with the map and stays the one mark on screen that means *yours*. It is drawn larger as
 * well as darker: colour alone is never the carrier (docs/09 §2).
 */
function placeMarkElement(place: MapPlace): HTMLElement {
  const size = place.saved ? 18 : 14
  const host = document.createElement('button')
  host.type = 'button'
  host.className = 'place-marker'
  host.setAttribute('aria-label', place.name)
  host.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;padding:0;cursor:pointer;border:3.2px solid ${
    place.saved ? 'rgb(var(--accent))' : MAP_COLOR.route
  };background:${MAP_COLOR.routeCasing};`
  return host
}
