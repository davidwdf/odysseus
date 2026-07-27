import type { Locale } from '@nextbus/core'
import type { ImageSourcePropType } from 'react-native'

/**
 * The basemap seam (WP0-2 / ADR-049).
 *
 * `MiniMap` — and any future MapLibre view — talks only to this interface, never to a tile
 * host. Two reasons that matters beyond tidiness:
 *  - the tile URL is **not hard-coded in a component**, so we can repoint the basemap without
 *    an app release (the OSMF policy asks for exactly this, and we'll want it for the eventual
 *    vector migration);
 *  - an iOS or Android client implements this one interface rather than re-deriving Web
 *    Mercator plumbing. It is the map entry on the `packages/ports` porting checklist, and
 *    moves there in Wave 1 (WP1-3) — it lives here only because `packages/ports` doesn't exist
 *    yet, and the type is deliberately platform-neutral apart from `ImageSourcePropType`.
 */
export interface TileSource {
  /** Stable id, for cache keys and debugging. */
  id: string
  /** Base raster layer. */
  basemap(z: number, x: number, y: number): string
  /**
   * Localised label overlay drawn on top of the basemap, or `undefined` when the source bakes
   * labels into the base tiles. LandsD serves labels as a separate per-language layer, which
   * is why the rider's locale relabels the map with no restyling at all.
   */
  label?(z: number, x: number, y: number, locale: Locale): string
  minZoom: number
  maxZoom: number
  /**
   * True when the source ships only a light cartography and dark mode has to be derived with
   * a CSS-style invert filter. LandsD's raster service has no dark variant, so this stays on
   * until a vector basemap earns its keep (proposal 02 §4, ADR-049).
   */
  invertForDark: boolean
  attribution: {
    /** Rendered **on the map face** when the licence requires it (LandsD does). */
    logo?: ImageSourcePropType
    /** Short notice, per locale. */
    notice: Record<Locale, string>
    /** Where the notice links. */
    href: string
    /** Accessible label for the notice link, per locale. */
    a11yLabel: Record<Locale, string>
  }
}

/** Same base URL as the DataSource — tiles are served by our own Worker (`/v1/tiles/...`),
 *  which caches LandsD and re-emits the tiles as publicly cacheable. See apps/edge/src/tiles.ts. */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787'

/** Our locale ids → LandsD's label-service language codes. */
const LABEL_LANG: Record<Locale, string> = { en: 'en', 'zh-Hant': 'tc', 'zh-Hans': 'sc' }

/**
 * Hong Kong Lands Department topographic raster, via our Worker (ADR-049).
 *
 * Chosen over OpenStreetMap and every commercial vendor because it is keyless, free for
 * commercial use, **cacheable by us** (the only hosted provider here whose licence permits
 * it), and carries official `en`/`zh-Hant`/`zh-Hans` labels. Its dense survey cartography —
 * footbridges, subways, named buildings — is a product feature in Hong Kong, where the hard
 * part of finding a stop is working out which side of the road you're on.
 */
export const landsdTileSource: TileSource = {
  id: 'landsd',
  basemap: (z, x, y) => `${API_URL}/v1/tiles/basemap/${z}/${x}/${y}.png`,
  label: (z, x, y, locale) => `${API_URL}/v1/tiles/label/${LABEL_LANG[locale]}/${z}/${x}/${y}.png`,
  minZoom: 10,
  maxZoom: 20,
  invertForDark: true,
  attribution: {
    logo: require('../assets/landsd-logo.png'),
    notice: {
      en: 'Map from Lands Department',
      'zh-Hant': '地圖由地政總署提供',
      'zh-Hans': '地图由地政总署提供',
    },
    href: 'https://api.portal.hkmapservice.gov.hk/disclaimer',
    a11yLabel: {
      en: 'Map from Lands Department — open the copyright notice and disclaimer',
      'zh-Hant': '地圖由地政總署提供 — 開啟版權公告及免責聲明',
      'zh-Hans': '地图由地政总署提供 — 打开版权公告及免责声明',
    },
  },
}

/** The active basemap. One assignment is the whole "repoint without an app release" seam. */
export const tileSource: TileSource = landsdTileSource
