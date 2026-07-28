// Raster basemap proxy — Hong Kong Lands Department, via the CSDI Portal (ADR-049, WP0-2).
//
// Why we proxy rather than point <Image> straight at LandsD:
//  1. **Their tiles say `cache-control: private, must-revalidate, max-age=43200`.** `private`
//     makes every shared cache — Cloudflare's included — a no-op. We deliberately override it
//     to `public` on the way out, which is what turns 20 riders in Mong Kok into one upstream
//     request instead of twenty. Caching is expressly permitted by the CSDI licence (proposal
//     02 §3) and their own 12 h `max-age` is the TTL we adopt.
//  2. It is the seam the native clients will share, and it lets us repoint the upstream
//     without an app release — the thing hard-coding `TILE_URL` in the component prevented.
//  3. It keeps the pinned API version (`v1.0.0`) in one place; LandsD warn that old versions
//     are "removed at any time without notice".
//
// **Demand-driven only.** The one published limit is "your application shall not invoke the
// API with large amount of requests within a short period", so we never pre-warm a pyramid —
// we cache what a rider actually looked at. Caching helps us comply rather than straining it.
//
// Attribution obligations (logo on the map face + copyright notice) are the client's job and
// live in `components/MiniMap.tsx`; this file only moves bytes.

import { fail } from './errors'

const LANDSD = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz'
/** Spatial reference: WGS84 matches the lat/lng we carry everywhere. */
const SR = 'WGS84'

/** LandsD's raster services span z10–20 (basemap) and z0–20 (labels). */
const MIN_ZOOM = 0
const MAX_ZOOM = 20
const MIN_BASEMAP_ZOOM = 10

/** Their own `max-age`, adopted verbatim. The upstream dataset updates weekly. */
export const TILE_TTL_SEC = 43_200

/** Label overlay locales, keyed by our `Locale` ids. The label service is the *only* thing
 *  that changes when the rider switches language — the basemap carries no CJK at all. */
const LABEL_LANG: Record<string, string> = {
  en: 'en',
  'zh-Hant': 'tc',
  'zh-Hans': 'sc',
  // Accept the upstream spellings too, so a native client can pass either.
  tc: 'tc',
  sc: 'sc',
}

function isTileCoord(z: number, x: number, y: number, minZoom: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false
  if (z < minZoom || z > MAX_ZOOM) return false
  const n = 2 ** z
  return x >= 0 && x < n && y >= 0 && y < n
}

/**
 * `GET /v1/tiles/basemap/:z/:x/:y.png` and `GET /v1/tiles/label/:lang/:z/:x/:y.png`.
 * Returns `null` when the path isn't a tile request, so the router can fall through.
 */
export function parseTilePath(parts: string[]): { upstream: string } | { error: string } | null {
  if (parts[0] !== 'v1' || parts[1] !== 'tiles') return null
  const kind = parts[2]

  if (kind === 'basemap' && parts.length === 6) {
    const [z, x, y] = [Number(parts[3]), Number(parts[4]), Number(parts[5]?.replace(/\.png$/, ''))]
    if (!isTileCoord(z, x, y, MIN_BASEMAP_ZOOM)) return { error: 'tile out of range' }
    return { upstream: `${LANDSD}/basemap/${SR}/${z}/${x}/${y}.png` }
  }

  if (kind === 'label' && parts.length === 7) {
    const lang = LABEL_LANG[parts[3] ?? '']
    const [z, x, y] = [Number(parts[4]), Number(parts[5]), Number(parts[6]?.replace(/\.png$/, ''))]
    if (!lang) return { error: 'unknown label language' }
    if (!isTileCoord(z, x, y, MIN_ZOOM)) return { error: 'tile out of range' }
    return { upstream: `${LANDSD}/label/hk/${lang}/${SR}/${z}/${x}/${y}.png` }
  }

  return { error: 'usage: /v1/tiles/basemap/:z/:x/:y.png | /v1/tiles/label/:lang/:z/:x/:y.png' }
}

/**
 * Fetch one upstream tile and re-emit it as a publicly cacheable image. `cf.cacheTtl` asks
 * Cloudflare's own cache to hold it too, so a repeat tile is usually answered before our code
 * runs at all — that is what keeps us inside LandsD's "no large amount of requests" limit.
 */
export async function fetchTile(upstream: string): Promise<Response> {
  const res = await fetch(upstream, {
    cf: { cacheTtl: TILE_TTL_SEC, cacheEverything: true },
  } as RequestInit)
  if (!res.ok) {
    // A tile failure is an API failure and carries the same envelope as every other (ADR-064).
    // It used to be a bare text body with a hand-picked status; a `<Image>` never read either, but
    // a native client debugging a blank map did, and "502" told it to keep retrying a tile that
    // does not exist. Upstream 404 is permanent at this coordinate; their 504 is their timeout.
    const code =
      res.status === 404
        ? 'not_found'
        : res.status === 504
          ? 'upstream_timeout'
          : 'upstream_unavailable'
    return fail(code, `tile upstream ${res.status}`, { 'access-control-allow-origin': '*' })
  }
  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'image/png',
      // The deliberate override: `private` upstream → `public` for us (see the note above).
      'cache-control': `public, max-age=${TILE_TTL_SEC}, stale-while-revalidate=86400`,
      'access-control-allow-origin': '*',
      // Kept so a conditional request can still short-circuit at the browser.
      ...(res.headers.get('etag') ? { etag: res.headers.get('etag') as string } : {}),
      'x-tile-source': 'landsd',
    },
  })
}
