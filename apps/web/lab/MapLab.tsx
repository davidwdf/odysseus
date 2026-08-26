import { displayName, type MarkerStop, type RoutePath } from '@nextbus/core'
import { useEffect, useState } from 'react'
import { dataSource } from '../src/adapters/datasource'
import { landsdMapProvider } from '../src/adapters/mapProvider'
import { MapView } from '../src/components/MapView'
import { RouteMap } from '../src/components/RouteMap'

/**
 * The interactive basemap, on its own, so it can be judged before any screen depends on it (ADR-154).
 *
 * It lives here rather than on Place detail for the reason ADR-112 gives for the lab existing at all:
 * a spec'd screen is an expensive place to try something. `MiniMap` still owns every shipping screen;
 * this proves the `MapProvider` seam and the engine, and M4 is what moves a screen onto it.
 *
 * ## Why the second half of this page exists
 *
 * For one milestone this lab drew **tiles and nothing else**, a human looked at it and said the map was
 * good, and both of those were true. What neither could show is that MapLibre's **worker was dead** the
 * whole time (ADR-155 decision 7): raster tiles decode on the main thread, so the basemap was perfect
 * while every source needing geometry was silently empty. It surfaced a milestone later, when a route
 * line was finally asked to draw.
 *
 * So the route-line section below is not decoration. It is the part of this page that **exercises the
 * worker**, and a lab that renders a basemap and no geometry cannot vouch for geometry. It also puts all
 * three of `routePathView`'s answers side by side, which is the thing a porter most needs to see: the
 * difference between *"this is the road"* and *"these are the stops, in order"* is a whole design
 * decision (ADR-152) and it is invisible in a spec listing.
 */
const PLACES = [
  { name: 'Chuk Yuen Estate', lat: 22.34544, lng: 114.19268 },
  { name: 'Star Ferry, TST', lat: 22.29415, lng: 114.1693 },
  { name: 'Central Ferry Piers', lat: 22.28755, lng: 114.15769 },
  { name: 'Cyberport', lat: 22.26199, lng: 114.13016 },
]

export function MapLab() {
  const [i, setI] = useState(0)
  const [zoom, setZoom] = useState(15)
  const place = PLACES[i] ?? PLACES[0]
  if (!place) return null

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {PLACES.map((p, idx) => (
          <button
            key={p.name}
            type="button"
            onClick={() => setI(idx)}
            className={`rounded-full px-3 py-1 text-caption ${
              idx === i ? 'bg-accent text-accent-contrast' : 'bg-surface-2 text-muted'
            }`}
          >
            {p.name}
          </button>
        ))}
        <span className="ml-2 text-caption text-muted">
          z{zoom} · dpr {typeof window === 'undefined' ? '?' : window.devicePixelRatio}
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(landsdMapProvider.maxZoom, z + 1))}
          className="rounded-full bg-surface-2 px-3 py-1 text-caption text-muted"
        >
          zoom in
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(landsdMapProvider.minZoom, z - 1))}
          className="rounded-full bg-surface-2 px-3 py-1 text-caption text-muted"
        >
          zoom out
        </button>
      </div>

      <RouteLines />

      <MapView
        centre={place}
        zoom={zoom}
        // Lab-only geometry is an INLINE STYLE, never a utility class: `tailwind.config.cjs` scans
        // `./src/**` and not `./lab/**`, so any class the app does not already use is never
        // generated. `h-[520px]` silently computed to 0 here, the map got a zero-height viewport and
        // requested no tiles at all. ADR-112 records the trap; adding `lab/` to the content glob
        // would fix it by letting lab-only classes into the SHIPPED stylesheet, which is the thing
        // that ADR exists to prevent.
        style={{ height: 520 }}
        className="w-full overflow-hidden rounded-lg"
        onReady={(map) => {
          // A handle for poking at the live map from the console. The lab is the one place this is
          // fine — ADR-112 keeps it out of the app.
          ;(window as unknown as { __map?: unknown }).__map = map
        }}
      />

      <p className="max-w-[70ch] text-caption text-muted">
        Drag and scroll it. The base layer is requested one zoom level deeper than the labels on a
        hi-DPI screen — <code>tileZoomPlan</code> in <code>@nextbus/core</code> decides that, and
        MapLibre is told in its own vocabulary (a halved <code>tileSize</code>). The labels are
        deliberately <em>not</em> overzoomed: LandsD bakes label size into the raster, so a deeper
        level means smaller, denser type.
      </p>
    </div>
  )
}

/**
 * The three answers `routePathView` can give, on real routes, through the shipping component.
 *
 * **Real ids rather than fixtures**, because the arm is a property of real geometry and a hand-made
 * fixture would only prove the code agrees with itself. These three are the ones ADR-155 measured:
 * `KMB 1` has a surveyed line; `KMB R215` has none but its 34 stops sit ~433 m apart, close enough that
 * joining them describes a road; `CTB 20R` is 4 stops over 7.6 km, where a chord would draw three
 * straight lines across Kowloon and the honest output is nothing at all.
 *
 * Needs `pnpm dev:edge`, as the tiles above already do.
 */
const ROUTES = [
  { id: 'KMB:1:outbound:1', label: 'KMB 1', expect: 'surveyed — the road, solid, no caption' },
  { id: 'KMB:R215:outbound:1', label: 'KMB R215', expect: 'approximate — dashed, and says so' },
  { id: 'CTB:20R:outbound:1', label: 'CTB 20R', expect: 'none — no map at all' },
] as const

function RouteLines() {
  const [i, setI] = useState(0)
  const [path, setPath] = useState<RoutePath | undefined>(undefined)
  const [stops, setStops] = useState<readonly MarkerStop[]>([])
  const [pending, setPending] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const route = ROUTES[i] ?? ROUTES[0]

  useEffect(() => {
    // `cancelled` rather than an AbortController: two clicks in a row must not let the slower answer
    // land last and contradict the button that is lit.
    let cancelled = false
    setPending(true)
    setError(null)
    Promise.all([dataSource.getRoutePath(route.id), dataSource.getRoute(route.id)])
      .then(([p, detail]) => {
        if (cancelled) return
        setPath(p)
        setStops(
          detail.stops.map((row) => ({
            location: row.stop.location,
            name: displayName(row.stop.name.en).label,
          })),
        )
        setPending(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [route.id])

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {ROUTES.map((r, idx) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setI(idx)}
            className={`rounded-full px-3 py-1 text-caption ${
              idx === i ? 'bg-accent text-accent-contrast' : 'bg-surface-2 text-muted'
            }`}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-2 text-caption text-muted">{route.expect}</span>
      </div>

      {error ? (
        <p className="text-caption text-negative">
          {error} — this section needs <code>pnpm dev:edge</code>.
        </p>
      ) : (
        <RouteMap path={path} pending={pending} stops={stops} className="w-full" />
      )}

      <p className="max-w-[70ch] text-caption text-muted">
        The <strong>only</strong> geometry on this page, and therefore the only thing here that
        proves MapLibre&rsquo;s worker is alive — a dead one leaves the basemap above perfect and
        every line silently missing (ADR-155). <code>CTB 20R</code> drawing nothing is the correct
        answer, not a failure: check the caption under <code>KMB R215</code> to tell &ldquo;no
        line&rdquo; from &ldquo;no map&rdquo;.
      </p>
    </section>
  )
}
