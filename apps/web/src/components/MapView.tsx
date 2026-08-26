import { type LatLng, tileZoomPlan } from '@nextbus/core'
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// The worker as a BUNDLED asset, built by Vite rather than located by MapLibre at runtime.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef } from 'react'
import { mapProvider as defaultProvider, type MapProvider } from '../adapters/mapProvider'
import { useAppearance } from '../lib/appearance'
import { useLocale } from '../providers/LocaleProvider'

/**
 * **Tell MapLibre where its worker is, because neither Vite mode can work it out.**
 *
 * Left alone, MapLibre derives the path itself: `new URL("./maplibre-gl-worker.mjs", import.meta.url)`,
 * relative to its own module. That assumption — *my worker is my sibling on disk* — is true in
 * `node_modules` and false everywhere Vite puts the module:
 *
 * - **dev**, it is pre-bundled to `.vite/deps/maplibre-gl.js`, and Vite pre-bundles the entry only, so
 *   the sibling is not there;
 * - **build**, it is rolled into `assets/index-<hash>.js`, and Rollup has no reason to emit a file
 *   nothing imports.
 *
 * Both resolve to a 404. `new Worker()` on a 404 **still constructs** — it fails asynchronously, on the
 * worker's own `error` event, which MapLibre does not surface — so every symptom is a silent absence:
 * `GeoJSONSource._isUpdatingWorker` stays `true` for ever, `isSourceLoaded` stays `false`, and
 * `queryRenderedFeatures` returns nothing. **The raster basemap is unaffected**, because raster tiles are
 * decoded on the main thread — which is the cruel part: the map looks completely healthy and every
 * source that needs geometry is dead. It cost an afternoon; a route line that would not draw over a
 * basemap that would.
 *
 * `?worker&url` makes the bundler responsible instead: Vite builds the worker as its own bundle and
 * hands back its real URL, in both modes. `setWorkerUrl` is MapLibre's supported way to be told, and it
 * is called at module scope because the worker pool is built on the first map and never rebuilt.
 *
 * **`?worker`, not a bare `?url`** — and that distinction cost a second round. `?url` copies *one file*
 * and knows nothing about what it imports, so `dist/` got `maplibre-gl-worker-<hash>.mjs` whose first
 * line is `import … from "./maplibre-gl-shared.mjs"` — a sibling that was never emitted. The same silent
 * death, one level down, and made harder to see by the SPA fallback: a missing asset under a
 * `/* → /index.html` rule is not a 404, it is **200 with HTML in it**, so the worker parsed a web page
 * as JavaScript. `?worker` bundles the graph, which is the whole difference.
 */
setWorkerUrl(maplibreWorkerUrl)

/**
 * Dark mode, as raster paint rather than a CSS filter.
 *
 * `MiniMap` inverts with `.map-tiles-invert` — `invert(1) hue-rotate(180deg) brightness(1.2)` — and
 * can, because its tiles are `<img>` elements with the overlay in separate DOM. Here the basemap and
 * everything drawn over it share **one canvas**, so the same filter would invert the route line with
 * the map and hand back exactly the colour the light theme already rejected. The style spec can
 * express it per source instead: `brightness-min: 1, brightness-max: 0` is the inversion, the hue
 * rotation is its own property, and `contrast` stands in for the brightness lift — which the CSS
 * recipe needs because inverting a cartography drawn for white paper flattens it (`index.css`).
 */
const DARK_RASTER = {
  'raster-brightness-min': 1,
  'raster-brightness-max': 0,
  'raster-hue-rotate': 180,
  'raster-contrast': 0.12,
} as const
const LIGHT_RASTER = {
  'raster-brightness-min': 0,
  'raster-brightness-max': 1,
  'raster-hue-rotate': 0,
  'raster-contrast': 0,
} as const

/**
 * An **interactive** basemap — drag, zoom, and a camera something else can drive (ADR-154).
 *
 * This is not a replacement for `MiniMap`, which stays exactly as it is: `MiniMap` answers *"show me
 * where this place is"* with a static, cheap, hand-composited grid, and it is what every spec'd screen
 * currently uses. This answers *"let me move around"*, and the two will coexist until a screen asks
 * for the second thing.
 *
 * ## Why the base and label layers are declared with different `tileSize`s
 *
 * LandsD serves **256 px tiles only** — no `@2x` — so on a DPR-2 screen a tile drawn at 256 CSS px is
 * upscaled and looks soft. MapLibre's `tileSize` is the lever: telling it a source's tiles are 128 px
 * makes it fetch one zoom level deeper and draw them at half size, which is true 2× density.
 *
 * The labels must **not** get the same treatment, because LandsD bakes label size into the raster and
 * a deeper level arrives with a denser, half-size label set — sharper text that is harder to read.
 * `tileZoomPlan` in `@nextbus/core` owns that decision, corpus-pinned, so the rule is stated once for
 * every platform; this component only asks it *whether* to overzoom and configures the engine to
 * match. Splitting the two is only possible because LandsD publishes labels as a separate service,
 * which is the same property ADR-049 relies on for per-locale labels.
 *
 * ## Dark mode inverts the TILES ONLY
 *
 * `invertForDark` is a property of the source, and the filter goes on the map canvas — so anything
 * drawn *over* the map keeps its true colour and needs its own light/dark pair. That is a trap rather
 * than a detail: a near-black route line is excellent on the light map and invisible on the dark one
 * (`docs/proposals/06 §8c`).
 */
export function MapView({
  centre,
  zoom = 15,
  provider = defaultProvider,
  interactive = true,
  className,
  style,
  onReady,
}: {
  centre: LatLng
  zoom?: number
  provider?: MapProvider
  /** False for a still frame — the engine still renders, it just does not take gestures. */
  interactive?: boolean
  className?: string
  /** Inline geometry. The lab needs this: a utility class it invents is never generated (ADR-112). */
  style?: React.CSSProperties
  /** Handed the live map so a caller can add sources, layers or a camera policy of its own. */
  onReady?: (map: MapLibreMap) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const locale = useLocale()
  const mode = useAppearance()

  // The map is created ONCE. `centre`, `zoom` and `onReady` are read here as INITIAL values only;
  // everything that changes afterwards is applied to the live instance by the effect below. Listing
  // them would re-create the map on every camera change, dropping the tile cache, the caller's layers
  // and the rider's current view — which is the opposite of what an interactive map is for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: creation-time inputs, applied live below
  useEffect(() => {
    const host = hostRef.current
    if (!host || mapRef.current || provider.kind !== 'raster-xyz') return

    // Ask the kernel whether this screen should overzoom the base, then say so in the engine's own
    // vocabulary. `tileSize` is MapLibre's only lever for it.
    const plan = tileZoomPlan(zoom, window.devicePixelRatio || 1, provider)
    const baseTileSize = plan.base > plan.label ? provider.tileSize / 2 : provider.tileSize

    const map = new MapLibreMap({
      container: host,
      center: [centre.lng, centre.lat],
      zoom,
      minZoom: provider.minZoom,
      maxZoom: provider.maxZoom,
      interactive,
      attributionControl: false, // ours is a required, licence-bearing control — see below
      style: {
        version: 8,
        sources: {
          base: {
            type: 'raster',
            tiles: [provider.basemap(0, 0, 0).replace(/\/0\/0\/0\.png$/, '/{z}/{x}/{y}.png')],
            tileSize: baseTileSize,
            minzoom: provider.minZoom,
            maxzoom: provider.maxZoom,
            attribution: provider.attribution.notice[locale],
          },
          ...(provider.label
            ? {
                labels: {
                  type: 'raster' as const,
                  tiles: [
                    provider.label(0, 0, 0, locale).replace(/\/0\/0\/0\.png$/, '/{z}/{x}/{y}.png'),
                  ],
                  tileSize: provider.tileSize,
                  minzoom: provider.minZoom,
                  maxzoom: provider.maxZoom,
                },
              }
            : {}),
        },
        layers: [
          { id: 'base', type: 'raster', source: 'base', paint: { ...LIGHT_RASTER } },
          ...(provider.label
            ? [
                {
                  id: 'labels',
                  type: 'raster' as const,
                  source: 'labels',
                  paint: { ...LIGHT_RASTER },
                },
              ]
            : []),
        ],
      },
    })

    mapRef.current = map
    // MapLibre reports a bad style, an unreachable tile host and a failed source through ONE `error`
    // event, and with no listener attached it is easy to end up with a live canvas that simply never
    // draws. Surfacing it is not debug cruft: a basemap that silently shows nothing is the failure
    // this component is most likely to have in the wild.
    map.on('error', (e) => {
      console.error('[MapView]', (e as { error?: { message?: string } }).error?.message ?? e)
    })
    map.on('load', () => onReady?.(map))
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [provider, interactive, locale])

  // Appearance goes to the live map's raster layers, not to the canvas — see `DARK_RASTER`. Guarded
  // on the source's own `invertForDark`, because a vector basemap with a real dark style would want
  // this off entirely (ADR-041).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !provider.invertForDark) return
    const paint = mode === 'dark' ? DARK_RASTER : LIGHT_RASTER
    const apply = () => {
      for (const id of ['base', 'labels']) {
        if (!map.getLayer(id)) continue
        for (const [key, value] of Object.entries(paint)) {
          map.setPaintProperty(id, key as 'raster-hue-rotate', value)
        }
      }
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [mode, provider.invertForDark])

  // Camera changes go to the live map.
  useEffect(() => {
    mapRef.current?.jumpTo({ center: [centre.lng, centre.lat], zoom })
  }, [centre.lat, centre.lng, zoom])

  return <div ref={hostRef} className={className} style={style} data-provider={provider.id} />
}
