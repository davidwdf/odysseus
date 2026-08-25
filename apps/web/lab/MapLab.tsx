import { useState } from 'react'
import { landsdMapProvider } from '../src/adapters/mapProvider'
import { MapView } from '../src/components/MapView'

/**
 * The interactive basemap, on its own, so it can be judged before any screen depends on it (ADR-154).
 *
 * It lives here rather than on Place detail for the reason ADR-112 gives for the lab existing at all:
 * a spec'd screen is an expensive place to try something. `MiniMap` still owns every shipping screen;
 * this proves the `MapProvider` seam and the engine, and M4 is what moves a screen onto it.
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
