import { DEFAULT_API_URL } from '@nextbus/api-client'
import type { Locale } from '@nextbus/core'
import { localeRecord } from '@nextbus/i18n'
import type { TileSource as PortTileSource } from '@nextbus/ports'

/**
 * The basemap seam for the DOM renderer — the same port, bound to this platform's image type.
 *
 * The twin of `apps/mobile/lib/tileSource.ts`, and the difference between them is the whole reason
 * `TileSource` is generic over its asset type: React Native wants an `ImageSourcePropType` from a
 * `require()`, and a browser wants a URL string. Everything else — the templates, the zoom bounds, the
 * per-locale label layer, the attribution copy — is **data**, and `packages/ports` says so: *"this is the
 * one port whose implementation is already shared… it ports to Swift or Kotlin as a struct literal"*.
 *
 * Two things are deliberately **not** duplicated here. The credit strings come from `localeRecord`, so the
 * catalogue is their one home in both apps (the six inline strings this pattern replaced in WP4-0 were
 * outside it, which is why no parity gate compared them). And the base URL falls back to
 * `DEFAULT_API_URL`, the one declaration of where the API is — only the env read is per-bundler, which is
 * the same split `adapters/datasource.ts` makes and the reason `check-one-endpoint-declaration` passes on
 * both.
 *
 * The `/v1/tiles/` path is on **our own Worker**, which proxies and caches the Lands Department
 * (`apps/edge/src/tiles.ts`, ADR-049) — so it is allowlisted in `check-view-transport-free` for the reason
 * that file's entry for the mobile twin gives: a `TileSource` is a URL template by definition, and the view
 * consumes the port, never the path.
 */
export type TileSource = PortTileSource<Locale, string>

const API_URL = import.meta.env.VITE_API_URL ?? DEFAULT_API_URL

/** Our locale ids → LandsD's label-service language codes. */
const LABEL_LANG: Record<Locale, string> = { en: 'en', 'zh-Hant': 'tc', 'zh-Hans': 'sc' }

export const landsdTileSource: TileSource = {
  id: 'landsd',
  basemap: (z, x, y) => `${API_URL}/v1/tiles/basemap/${z}/${x}/${y}.png`,
  label: (z, x, y, locale) => `${API_URL}/v1/tiles/label/${LABEL_LANG[locale]}/${z}/${x}/${y}.png`,
  minZoom: 10,
  maxZoom: 20,
  invertForDark: true,
  attribution: {
    // A URL rather than a `require()`, and the bytes are the same file: `scripts/gen-icons.mjs` copies it
    // from `apps/mobile/assets/` into this app's `public/` in the same run that emits the icon set.
    logo: '/landsd-logo.png',
    notice: localeRecord('mapAttribution'),
    href: 'https://api.portal.hkmapservice.gov.hk/disclaimer',
    a11yLabel: localeRecord('mapAttributionAction'),
  },
}

/** The active basemap. One assignment is the whole "repoint without an app release" seam. */
export const tileSource: TileSource = landsdTileSource
