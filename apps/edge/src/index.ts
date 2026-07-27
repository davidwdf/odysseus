import { fetchEta } from '@nextbus/data-normalize'
import { datasetBuildCount, getDataset } from './dataset'
import type { Env } from './env'
import { ETA_TTL_SEC } from './eta-cache'
import { nearby } from './nearby'
import { routeDetail, stopDetail, stopEtas } from './stop-route'
import { fetchTile, parseTilePath } from './tiles'

export type { Env }

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(data: unknown, maxAge = ETA_TTL_SEC): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
      ...CORS,
    },
  })
}

function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  })
}

/** Edge-cache + coalesce a JSON producer: many users on the same key = one build per TTL. */
async function cached(
  request: Request,
  url: URL,
  ctx: ExecutionContext,
  maxAge: number,
  produce: () => Promise<unknown>,
  errPrefix: string,
): Promise<Response> {
  const cache = caches.default
  const cacheKey = new Request(url.toString(), request)
  const hit = await cache.match(cacheKey)
  if (hit) return hit
  try {
    const res = json(await produce(), maxAge)
    ctx.waitUntil(cache.put(cacheKey, res.clone()))
    return res
  } catch (err) {
    return fail(502, `${errPrefix}: ${(err as Error).message}`)
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts.length === 0) return json({ name: 'nextbus-edge', ok: true }, 0)

    // GET /v1/health — the operational truth about this isolate (WP0-1).
    //
    // `datasetBuildsThisIsolate` is the one number that matters: it counts how many times this
    // isolate built the 8.3 MB static index in-request. In production, with the precomputed
    // shards in KV, it must be **0** — CI sweeps every endpoint and asserts exactly that, which
    // is what stops the slow path silently returning. Never cached.
    if (parts[0] === 'v1' && parts[1] === 'health') {
      const ds = await getDataset(env)
      return json(
        {
          ok: true,
          dataset: ds.origin,
          buildHash: ds.buildHash,
          datasetBuildsThisIsolate: datasetBuildCount(),
        },
        0,
      )
    }

    // GET /v1/eta/:co/:stop/:route[/:serviceType]
    if (parts[0] === 'v1' && parts[1] === 'eta') {
      const co = parts[2]
      const stop = parts[3]
      const route = parts[4]
      const service = parts[5] ?? '1'
      if (!co || !stop || !route) {
        return fail(400, 'usage: /v1/eta/:co/:stop/:route[/:serviceType]')
      }

      // Edge cache + coalescing: many users on the same stop = one upstream call per TTL.
      const cache = caches.default
      const cacheKey = new Request(url.toString(), request)
      const hit = await cache.match(cacheKey)
      if (hit) return hit

      const upper = co.toUpperCase()
      // GMB has no per-route debug fetch (its live board is keyed by numeric route_id, not
      // public number); use /v1/etas/:id, which resolves GMB via the place document (ADR-047).
      if (upper === 'GMB') {
        return fail(400, 'GMB live ETAs are served via /v1/etas/:id (stop board), not /v1/eta')
      }
      const operator = upper === 'CTB' ? 'CTB' : upper === 'LWB' ? 'LWB' : 'KMB'
      try {
        // Deliberately NOT routed through `coalesce`: it resolves a failed call to an empty list,
        // which this handler would then edge-cache as a perfectly ordinary `200 []` for 30 s —
        // an upstream outage rendered as "no buses", indistinguishable from an empty board and
        // sticky enough to outlast the outage. A debug endpoint must fail loudly.
        const etas = await fetchEta(operator, stop, route, service)
        const res = json(etas, ETA_TTL_SEC)
        ctx.waitUntil(cache.put(cacheKey, res.clone()))
        return res
      } catch (err) {
        return fail(502, `upstream error: ${(err as Error).message}`)
      }
    }

    // GET /v1/tiles/basemap/:z/:x/:y.png · /v1/tiles/label/:lang/:z/:x/:y.png
    // LandsD raster basemap, re-emitted as publicly cacheable (ADR-049). See src/tiles.ts.
    const tile = parseTilePath(parts)
    if (tile) {
      if ('error' in tile) return fail(400, tile.error)
      const cache = caches.default
      const cacheKey = new Request(url.toString(), request)
      const hit = await cache.match(cacheKey)
      if (hit) return hit
      const res = await fetchTile(tile.upstream)
      if (res.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()))
      return res
    }

    // GET /v1/index  → SearchIndex (compact route + stop list for on-device search +
    // the smart keypad — ADR-037). Static per build, so it gets a long TTL; the client
    // caches it and redownloads only when `version` moves.
    if (parts[0] === 'v1' && parts[1] === 'index') {
      return cached(
        request,
        url,
        ctx,
        21_600,
        async () => (await getDataset(env)).searchIndex(),
        'index error',
      )
    }

    // GET /v1/nearby?lat=&lng=[&radius=]  → NearbyStop[]
    if (parts[0] === 'v1' && parts[1] === 'nearby') {
      const lat = Number(url.searchParams.get('lat'))
      const lng = Number(url.searchParams.get('lng'))
      const radiusRaw = Number(url.searchParams.get('radius') ?? '500')
      // Clamped, because since WP0-1 the radius decides how many **KV keys** a request reads:
      // one per ~1.1 km geo cell, quadratic in the radius. Unclamped, `radius=50000` would fan
      // out to ~8,000 concurrent reads, blow the per-request subrequest limit and 502 — a remote
      // amplification from one query parameter. 2 km is far beyond any walkable stop.
      const radius = Number.isFinite(radiusRaw) ? Math.min(2000, Math.max(50, radiusRaw)) : 500
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return fail(400, 'usage: /v1/nearby?lat=<deg>&lng=<deg>[&radius=<m>]')
      }

      const cache = caches.default
      const cacheKey = new Request(url.toString(), request)
      const hit = await cache.match(cacheKey)
      if (hit) return hit

      try {
        const stops = await nearby(await getDataset(env), lat, lng, radius)
        const res = json(stops, ETA_TTL_SEC)
        ctx.waitUntil(cache.put(cacheKey, res.clone()))
        return res
      } catch (err) {
        return fail(502, `nearby error: ${(err as Error).message}`)
      }
    }

    // GET /v1/stop/:id  → StopDetail (canonical id, e.g. KMB:<stopId> or CTB:<stopId>)
    if (parts[0] === 'v1' && parts[1] === 'stop' && parts[2]) {
      const id = decodeURIComponent(parts[2])
      return cached(
        request,
        url,
        ctx,
        ETA_TTL_SEC,
        async () => stopDetail(await getDataset(env), id),
        'stop error',
      )
    }

    // GET /v1/route/:id  → RouteDetail (canonical id, e.g. KMB:6:outbound:1, CTB:1:outbound:1)
    // Now carries live per-stop ETAs (ADR-030) → short TTL like the other live endpoints,
    // not the hour the static geometry alone could afford.
    if (parts[0] === 'v1' && parts[1] === 'route' && parts[2]) {
      const id = decodeURIComponent(parts[2])
      return cached(
        request,
        url,
        ctx,
        ETA_TTL_SEC,
        async () => routeDetail(await getDataset(env), id),
        'route error',
      )
    }

    // GET /v1/etas/:id[?routes=a,b]  → Eta[] for a stop (canonical id). The app-facing
    // ETA endpoint; the lower-level /v1/eta/:co/:stop/:route stays for debugging.
    if (parts[0] === 'v1' && parts[1] === 'etas' && parts[2]) {
      const id = decodeURIComponent(parts[2])
      const routesParam = url.searchParams.get('routes')
      const routeIds = routesParam ? routesParam.split(',').filter(Boolean) : undefined
      return cached(
        request,
        url,
        ctx,
        ETA_TTL_SEC,
        async () => stopEtas(await getDataset(env), id, routeIds),
        'etas error',
      )
    }

    return fail(404, 'not found')
  },
} satisfies ExportedHandler<Env>
