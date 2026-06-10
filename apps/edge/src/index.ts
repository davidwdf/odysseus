import { fetchEta } from '@nextbus/data-normalize'
import { nearby } from './nearby'
import { getSearchIndex } from './search-index'
import { routeDetail, stopDetail, stopEtas } from './stop-route'

// No bindings yet; the daily-crawl dataset will add e.g. `DATASET: KVNamespace`.
export type Env = Record<string, never>

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(data: unknown, maxAge = 8): Response {
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
  async fetch(request: Request, _env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts.length === 0) return json({ name: 'nextbus-edge', ok: true }, 0)

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
      const operator = upper === 'CTB' ? 'CTB' : upper === 'LWB' ? 'LWB' : 'KMB'
      try {
        const etas = await fetchEta(operator, stop, route, service)
        const res = json(etas, 8)
        ctx.waitUntil(cache.put(cacheKey, res.clone()))
        return res
      } catch (err) {
        return fail(502, `upstream error: ${(err as Error).message}`)
      }
    }

    // GET /v1/index  → SearchIndex (compact route + stop list for on-device search +
    // the smart keypad — ADR-037). Static-ish: collapsed/merged off the daily dataset,
    // so it gets a long TTL; the client caches it and redownloads only when `version` moves.
    if (parts[0] === 'v1' && parts[1] === 'index') {
      return cached(request, url, ctx, 21_600, () => getSearchIndex(), 'index error')
    }

    // GET /v1/nearby?lat=&lng=[&radius=]  → NearbyStop[] (KMB; Citybus is a follow-up)
    if (parts[0] === 'v1' && parts[1] === 'nearby') {
      const lat = Number(url.searchParams.get('lat'))
      const lng = Number(url.searchParams.get('lng'))
      const radiusRaw = Number(url.searchParams.get('radius') ?? '500')
      const radius = Number.isFinite(radiusRaw) ? radiusRaw : 500
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return fail(400, 'usage: /v1/nearby?lat=<deg>&lng=<deg>[&radius=<m>]')
      }

      const cache = caches.default
      const cacheKey = new Request(url.toString(), request)
      const hit = await cache.match(cacheKey)
      if (hit) return hit

      try {
        const stops = await nearby(lat, lng, radius)
        const res = json(stops, 10)
        ctx.waitUntil(cache.put(cacheKey, res.clone()))
        return res
      } catch (err) {
        return fail(502, `nearby error: ${(err as Error).message}`)
      }
    }

    // GET /v1/stop/:id  → StopDetail (canonical id, e.g. KMB:<stopId> or CTB:<stopId>)
    if (parts[0] === 'v1' && parts[1] === 'stop' && parts[2]) {
      const id = decodeURIComponent(parts[2])
      return cached(request, url, ctx, 8, () => stopDetail(id), 'stop error')
    }

    // GET /v1/route/:id  → RouteDetail (canonical id, e.g. KMB:6:outbound:1, CTB:1:outbound:1)
    // Now carries live per-stop ETAs (ADR-030) → short TTL like the other live endpoints,
    // not the hour the static geometry alone could afford.
    if (parts[0] === 'v1' && parts[1] === 'route' && parts[2]) {
      const id = decodeURIComponent(parts[2])
      return cached(request, url, ctx, 8, () => routeDetail(id), 'route error')
    }

    // GET /v1/etas/:id[?routes=a,b]  → Eta[] for a stop (canonical id). The app-facing
    // ETA endpoint; the lower-level /v1/eta/:co/:stop/:route stays for debugging.
    if (parts[0] === 'v1' && parts[1] === 'etas' && parts[2]) {
      const id = decodeURIComponent(parts[2])
      const routesParam = url.searchParams.get('routes')
      const routeIds = routesParam ? routesParam.split(',').filter(Boolean) : undefined
      return cached(request, url, ctx, 8, () => stopEtas(id, routeIds), 'etas error')
    }

    return fail(404, 'not found')
  },

  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Daily static-data crawl pipeline (docs/03 §"daily crawl"). Stub for now:
    // fetch GTFS + KMB + CTB route/stop/fare → normalize → stop-merge → write to R2/KV.
    console.log('[crawl] daily normalization run — not yet implemented')
  },
} satisfies ExportedHandler<Env>
