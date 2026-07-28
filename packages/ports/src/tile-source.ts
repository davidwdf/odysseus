/**
 * # TileSource — where map tiles come from
 *
 * **What a native developer must supply:** normally *nothing new*. This is the one port whose
 * implementation is already shared — `landsdTileSource` is plain data (URL templates, zoom
 * bounds, attribution strings) and ports to Swift or Kotlin as a struct literal. A native client
 * implements this interface only to point at a different basemap, e.g. an offline `MBTiles`
 * bundle or a vector style.
 *
 * | Platform | Renderer that consumes it |
 * |---|---|
 * | Web / React Native (today) | `components/MiniMap.tsx` — hand-composited raster tiles |
 * | iOS | `MKTileOverlay` (or MapLibre with a style pointing at these templates) |
 * | Android | `TileProvider` / MapLibre |
 *
 * ## This file is the canonical home; `apps/mobile/lib/tileSource.ts` will import from it
 *
 * The interface first appeared in `apps/mobile/lib/tileSource.ts` under WP0-2 (ADR-049), whose
 * own doc comment says it "moves [to `packages/ports`] in Wave 1 (WP1-3) — it lives here only
 * because `packages/ports` doesn't exist yet". So: **the type belongs here, the LandsD
 * *implementation* stays in the app** (it carries a `require()`d logo asset and an
 * `EXPO_PUBLIC_API_URL` read, both of which are platform concerns by definition).
 *
 * Until the app is wired to `@nextbus/ports` — deliberately out of scope for WP1-3, which ships
 * types only — the declaration in `apps/mobile/lib/tileSource.ts` is a **temporary duplicate**,
 * not a second concept. Closing it is a two-line change in that file: delete the local
 * `interface TileSource` and
 *
 * ```ts
 * import type { TileSource } from '@nextbus/ports'
 * // …
 * export const landsdTileSource: TileSource<Locale, ImageSourcePropType> = { … }
 * ```
 *
 * Any divergence between the two before then is a bug in the app copy.
 *
 * ## Why it is generic over the locale and the logo asset
 *
 * `packages/ports` imports **nothing** — that is what makes it declaration-only and portable.
 * But the original interface referenced `Locale` from `@nextbus/core` and
 * `ImageSourcePropType` from `react-native`. Re-declaring a `Locale` union here would create
 * exactly the second source of truth this package is supposed to prevent, and
 * `ImageSourcePropType` is React Native leaking into a port. Two type parameters solve both:
 * the app instantiates `TileSource<Locale, ImageSourcePropType>`, iOS thinks in
 * `TileSource<Locale, UIImage>`, and the port itself stays import-free. The defaults
 * (`string`/`unknown`) keep a bare `TileSource` usable where the specificity does not matter.
 *
 * ## Tile conventions, stated so nobody re-derives them wrong
 *
 * - **XYZ / "slippy map", Web Mercator (EPSG:3857), 256 px tiles, `y` counted from the north** —
 *   the OSM and Google convention, *not* TMS's flipped `y`. The Mercator maths that goes with it
 *   (`lngToWorldX`, `latToWorldY`, `fitZoom`) lives in `components/MiniMap.tsx` today and moves
 *   into `packages/core` under WP2-4, so it is written once for all three platforms.
 * - **Tiles are fetched from our own Worker** (`/v1/tiles/...`), which caches the upstream and
 *   re-emits it as publicly cacheable. Do not call the Lands Department endpoints directly from
 *   a client: the caching that makes this affordable, and the compliance work that makes it
 *   permitted, both live in the Worker (`apps/edge/src/tiles.ts`, ADR-049).
 * - **Labels are a separate per-locale overlay.** LandsD publishes `en`/`tc`/`sc` label layers on
 *   top of one unlabelled base, which is why switching the rider's language relabels the map with
 *   no restyling. A source that bakes labels into the base tiles simply omits `label`.
 */
export interface TileSource<LocaleId extends string = string, ImageAsset = unknown> {
  /** Stable id, for cache keys and debugging (e.g. `'landsd'`). */
  id: string
  /** URL of one base raster tile. */
  basemap(z: number, x: number, y: number): string
  /**
   * URL of the localized label tile drawn over the basemap, or omitted entirely when the source
   * bakes labels into the base tiles.
   */
  label?(z: number, x: number, y: number, locale: LocaleId): string
  /** Lowest zoom the source serves. Below this the renderer must clamp, not request. */
  minZoom: number
  /** Highest zoom the source serves — 20 for LandsD; above it, tiles must be upscaled. */
  maxZoom: number
  /**
   * True when the source ships only a light cartography, so dark mode has to be derived with an
   * invert-style filter rather than a dark tile set. LandsD's raster service has no dark
   * variant, so this stays on until a vector basemap earns its keep (ADR-049).
   */
  invertForDark: boolean
  attribution: TileAttribution<LocaleId, ImageAsset>
}

/**
 * Attribution is part of the **licence**, not the design — a client that renders tiles without
 * it is out of compliance, which is why it is a required member of the port rather than
 * something a view layer decides to include.
 */
export interface TileAttribution<LocaleId extends string = string, ImageAsset = unknown> {
  /**
   * Logo that must be drawn **on the map face** where the licence demands it (LandsD's does).
   * The type is whatever the platform calls an image reference.
   */
  logo?: ImageAsset
  /** Short copyright notice, per locale. */
  notice: Record<LocaleId, string>
  /** Where the notice links — the provider's copyright and disclaimer page. */
  href: string
  /** Accessible label for that link, per locale. */
  a11yLabel: Record<LocaleId, string>
}
