import type { Locale } from '@nextbus/core'
import { localeRecord } from '@nextbus/i18n'
import type { TileSource as PortTileSource } from '@nextbus/ports'
import type { ImageSourcePropType } from 'react-native'

/**
 * The basemap seam (WP0-2 / ADR-049) — now a **type alias over the canonical port**.
 *
 * The interface itself lives in `@nextbus/ports` (WP1-3), which is where the doc comment this
 * replaced always said it would go. `packages/ports` imports nothing, so the port is generic over
 * the locale union and the platform's image type; this alias binds those to our `Locale` and React
 * Native's `ImageSourcePropType`, which is the only platform-specific part.
 *
 * Binding it here rather than re-declaring the shape is the point: the previous local copy was a
 * faithful duplicate *today*, and a duplicate that nobody diffs is a divergence with a start date.
 * Now the compiler checks it — if the port gains a member, this file stops building.
 *
 * `MiniMap` — and any future MapLibre view — still talks only to this interface, never to a tile
 * host, so we can repoint the basemap without an app release, and an iOS or Android client
 * implements one interface rather than re-deriving Web Mercator plumbing.
 */
export type TileSource = PortTileSource<Locale, ImageSourcePropType>

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
  // The credit copy lives in `@nextbus/i18n`, not here. It used to be two inline
  // `Record<Locale, string>` tables — six strings outside the catalogue, so no parity gate compared
  // them and no translator ever saw them. `localeRecord` rebuilds the shape the port wants from the
  // one declaration.
  attribution: {
    logo: require('../assets/landsd-logo.png'),
    notice: localeRecord('mapAttribution'),
    href: 'https://api.portal.hkmapservice.gov.hk/disclaimer',
    a11yLabel: localeRecord('mapAttributionAction'),
  },
}

/** The active basemap. One assignment is the whole "repoint without an app release" seam. */
export const tileSource: TileSource = landsdTileSource
