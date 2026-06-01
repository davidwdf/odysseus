import { fetchEta } from '@nextbus/data-normalize'
import { nearbyKmb } from './nearby'

export interface Env {
  // DATASET: KVNamespace  // static normalized dataset (enable in wrangler.toml)
}

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
        const stops = await nearbyKmb(lat, lng, radius)
        const res = json(stops, 10)
        ctx.waitUntil(cache.put(cacheKey, res.clone()))
        return res
      } catch (err) {
        return fail(502, `nearby error: ${(err as Error).message}`)
      }
    }

    return fail(404, 'not found')
  },

  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Daily static-data crawl pipeline (docs/03 §"daily crawl"). Stub for now:
    // fetch GTFS + KMB + CTB route/stop/fare → normalize → stop-merge → write to R2/KV.
    console.log('[crawl] daily normalization run — not yet implemented')
  },
} satisfies ExportedHandler<Env>
