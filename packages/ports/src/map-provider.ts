/**
 * # MapProvider — what the basemap *is*, for a renderer that does not composite tiles itself
 *
 * {@link TileSource} answers **"what is the URL of one tile"**, which is the right question only
 * while the renderer lays tiles out by hand — which is what `MiniMap` does today. An interactive map
 * delegates compositing to an engine (MapLibre, MapKit, Google Maps), and an engine does not want a
 * tile URL: it wants a **style** or an **archive**. This port is that widening, and it is deliberately
 * a superset rather than a replacement:
 *
 * - The `raster-xyz` arm **is** {@link TileSource}, structurally. The LandsD implementation is reused
 *   rather than rewritten, `MiniMap` keeps working unchanged, and nothing has to move in one commit.
 * - The `vector-style` arm is what a Protomaps/PMTiles or MapTiler basemap would supply
 *   (ADR-049 decision 7 keeps that as the documented fallback). Nothing implements it yet; it exists
 *   so the shape of the seam is decided before the swap, not during it.
 *
 * ## Three things this port refuses to let a caller forget
 *
 * 1. **Attribution is a member, not a decision.** Carried over from {@link TileAttribution} verbatim.
 *    LandsD's licence requires the mark on the map face, so a provider that could be used without it
 *    would be a provider that can be used out of compliance.
 * 2. **The label overlay is orthogonal to the base.** `raster-xyz` keeps `label` separate because
 *    LandsD publishes `en`/`tc`/`sc` label rasters over one unlabelled base — which is why switching
 *    the rider's language relabels the map with no restyling, and why a *vector* base can still wear
 *    a raster label layer (`labelOverlay`). hkbus does exactly that: an OSM base under LandsD labels.
 *    A source that bakes labels in simply omits both fields.
 * 3. **`invertForDark` is a property of the SOURCE.** A raster cartography drawn for white paper has
 *    to be inverted by filter; a vector style restyles properly and sets this false. The renderer must
 *    not decide it, and — the part that is easy to get wrong — **the filter applies to the tiles only**.
 *    Anything drawn *over* the map keeps its true colour, so a route line, its casing and its markers
 *    each need their own light/dark pair. See `docs/proposals/06 §8c`.
 *
 * ## Which zoom levels to actually request
 *
 * Not here. `@nextbus/core`'s `tileZoomPlan` decides it, because it is a rule with a reason
 * (a 256px-only raster must overzoom its base for sharpness and must NOT overzoom its labels) and
 * every platform has to make the same call. This port supplies the bounds; the kernel supplies the
 * policy. `ZoomRange` is satisfied structurally, so a provider passes straight in.
 *
 * @see TileSource — the narrower port this widens, still in use by `MiniMap`
 */
export type MapProvider<LocaleId extends string = string, ImageAsset = unknown> = MapProviderBase<
  LocaleId,
  ImageAsset
> &
  (RasterXyzSource<LocaleId> | VectorStyleSource<LocaleId>)

/** What every provider carries, whatever it is made of. */
export interface MapProviderBase<LocaleId extends string = string, ImageAsset = unknown> {
  /** Stable id, for cache keys and debugging (e.g. `'landsd'`). */
  id: string
  /** Lowest zoom the source serves. Below this a renderer must clamp, not request. */
  minZoom: number
  /** Highest zoom the source serves — 20 for LandsD; above it, tiles must be upscaled. */
  maxZoom: number
  /**
   * True when the source ships only a light cartography, so dark mode has to be derived with an
   * invert-style filter over the **tiles alone**. A vector style sets this false and restyles.
   */
  invertForDark: boolean
  /** Licence compliance, not decoration. Same shape as {@link TileAttribution}. */
  attribution: TileAttribution<LocaleId, ImageAsset>
}

/** A classic XYZ raster pyramid — today's LandsD, and structurally today's {@link TileSource}. */
export interface RasterXyzSource<LocaleId extends string = string> {
  kind: 'raster-xyz'
  /** URL of one base raster tile. */
  basemap(z: number, x: number, y: number): string
  /**
   * URL of the localized label tile drawn over the basemap, or omitted entirely when the source
   * bakes labels into the base tiles.
   */
  label?(z: number, x: number, y: number, locale: LocaleId): string
  /** Edge length of one tile in px. 256 for LandsD; some sources serve 512. */
  tileSize: number
}

/** A vector style an engine renders itself — Protomaps/PMTiles, MapTiler, or LandsD's own `/vt/`. */
export interface VectorStyleSource<LocaleId extends string = string> {
  kind: 'vector-style'
  /** A style document the engine loads (MapLibre GL style spec, or a `pmtiles://` archive). */
  styleUrl: string
  /**
   * An optional raster label layer drawn *over* the vector base — the hkbus arrangement, which keeps
   * per-locale labels working without the style carrying a single `symbol` layer.
   */
  labelOverlay?: {
    url(z: number, x: number, y: number, locale: LocaleId): string
    tileSize: number
  }
}

/**
 * Attribution is part of the **licence**, not the design — a client that renders tiles without it is
 * out of compliance, which is why it is a required member of a provider rather than something a view
 * layer decides to include.
 *
 * Declared here as well as in `tile-source.ts` would be two sources of truth, so this is the one
 * declaration and `TileSource` keeps its own for as long as it exists. When `MiniMap` is gone and
 * `TileSource` with it, this stays.
 */
export interface TileAttribution<LocaleId extends string = string, ImageAsset = unknown> {
  /** Logo that must be drawn **on the map face** where the licence demands it (LandsD's does). */
  logo?: ImageAsset
  /** Short copyright notice, per locale. */
  notice: Record<LocaleId, string>
  /** Where the notice links — the provider's copyright and disclaimer page. */
  href: string
  /** Accessible label for that link, per locale. */
  a11yLabel: Record<LocaleId, string>
}
