import { DEFAULT_API_URL } from '@nextbus/api-client'
import type { Locale } from '@nextbus/core'
import { localeRecord } from '@nextbus/i18n'
import type { MapProvider as PortMapProvider } from '@nextbus/ports'

/**
 * The **interactive** basemap seam for the DOM renderer (ADR-154).
 *
 * The twin of `adapters/tileSource.ts` and deliberately not a replacement for it: `MiniMap` still
 * composites tiles by hand and still consumes `TileSource`, while anything driven by a map *engine*
 * consumes this. Both describe the same LandsD service, and both take their URLs from the same
 * `/v1/tiles/` path on our own Worker — which is what makes the licence and the caching one
 * decision rather than two (ADR-049).
 *
 * Allowlisted in `check-view-transport-free` for the reason the `TileSource` entry gives: a basemap
 * provider is a URL template by definition, and a view consumes the port, never the path.
 */
export type MapProvider = PortMapProvider<Locale, string>

const API_URL = import.meta.env.VITE_API_URL ?? DEFAULT_API_URL

/** Our locale ids → LandsD's label-service language codes. */
const LABEL_LANG: Record<Locale, string> = { en: 'en', 'zh-Hant': 'tc', 'zh-Hans': 'sc' }

export const landsdMapProvider: MapProvider = {
  kind: 'raster-xyz',
  id: 'landsd',
  basemap: (z, x, y) => `${API_URL}/v1/tiles/basemap/${z}/${x}/${y}.png`,
  label: (z, x, y, locale) => `${API_URL}/v1/tiles/label/${LABEL_LANG[locale]}/${z}/${x}/${y}.png`,
  tileSize: 256,
  minZoom: 10,
  maxZoom: 20,
  invertForDark: true,
  attribution: {
    logo: '/landsd-logo.png',
    notice: localeRecord('mapAttribution'),
    href: 'https://api.portal.hkmapservice.gov.hk/disclaimer',
    a11yLabel: localeRecord('mapAttributionAction'),
  },
}

/** The active basemap. One assignment is the whole "repoint without an app release" seam. */
export const mapProvider: MapProvider = landsdMapProvider
