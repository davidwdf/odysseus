import type { ErrorCode } from '@nextbus/core'
import { fetchEta } from '@nextbus/data-normalize'
import { type DatasetSource, datasetBuildCount, getDataset } from './dataset'
import type { Env } from './env'
import { errorResponse, fail as failWith } from './errors'
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

function json(data: unknown, maxAge = ETA_TTL_SEC, etag?: string): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
      // `expose-headers` is for us, not for the cache: revalidation happens inside the browser's
      // HTTP cache and needs no CORS permission, but a debugger reading `res.headers.get('etag')`
      // cross-origin does.
      ...(etag ? { etag, 'access-control-expose-headers': 'etag' } : {}),
      ...CORS,
    },
  })
}

/**
 * A 304 for a client whose copy is still current: same validators, **no body**.
 *
 * Only strong, single-value `If-None-Match` is honoured — the form a browser or a native HTTP
 * client sends when it is revalidating one resource it already holds. A comma-list or a `W/` weak
 * tag simply misses and gets the 200 it would have got anyway, which is the safe direction.
 */
function notModifiedIfMatched(request: Request, res: Response): Response {
  const etag = res.headers.get('etag')
  if (!etag || request.headers.get('if-none-match') !== etag) return res
  return new Response(null, {
    status: 304,
    headers: {
      etag,
      'cache-control': res.headers.get('cache-control') as string,
      'access-control-expose-headers': 'etag',
      ...CORS,
    },
  })
}

/**
 * Every failure exit in this file. Takes a taxonomy member, **not** a status — `errors.ts` reads
 * the status off the contract's table, which is what keeps the two from disagreeing (ADR-064).
 */
const fail = (code: ErrorCode, message: string): Response => failWith(code, message, CORS)

/** Edge-cache + coalesce a JSON producer: many users on the same key = one build per TTL. */
async function cached<T>(
  request: Request,
  url: URL,
  ctx: ExecutionContext,
  env: Env,
  maxAge: number,
  produce: (dataset: DatasetSource) => Promise<T>,
  errPrefix: string,
  /** Strong validator for the produced value, when the value knows its own version. */
  etagOf?: (value: T) => string,
): Promise<Response> {
  const cache = caches.default
  // `getDataset` is **inside** the try: it is a KV read, so a throw from it is upstream I/O and
  // must reach the rider as `upstream_unavailable` with this endpoint's context, not as the
  // `internal` the top-level handler would stamp on it (ADR-064 — `internal` means *our* bug).
  try {
    // Resolved before the cache lookup because the build hash is *part of the key* (below), and
    // handed to `produce` so one memoized manifest read serves both.
    const dataset = await getDataset(env)
    // The cache key drops the client's headers on purpose. `new Request(url, request)` copies them,
    // which would put `If-None-Match` in the key and split the colo cache into one entry per
    // validator a client happens to hold — the conditional response is derived below, not stored.
    //
    // It gains the build hash for the opposite reason: without it the key is just the path, and
    // `build:current` flipping to a new dataset leaves every entry in place. `/v1/index` carries a
    // 6 h TTL, so a publish stayed invisible for six hours — and once ADR-063 gave the index an
    // ETag, a client revalidating in that window got a **304 confirming the stale copy**, which is
    // worse than the plain staleness it replaced: the index is versioned precisely so a client can
    // tell it moved. Scoping the key by build means a flip produces new keys by construction, so
    // correctness stops depending on anyone remembering to purge (ADR-066). `searchParams.set`
    // overwrites rather than appends, so a client passing `__build` cannot add a second entry for
    // the same build under the same parameter name.
    //
    // **The inline fallback is deliberately uncached.** Its content is not addressed by anything —
    // it is whatever upstream returned to this isolate — so there is no honest key for it. Sharing
    // one `__build=inline` key across every inline response would rebuild the original defect on
    // the fallback path and hold a 6 h entry that no publish can ever displace, which is strictly
    // worse than the slow answer it was trying to avoid. `inlineSource()` memoizes per isolate, so
    // the cost of skipping the cache here is bounded by ADR-055's own degrade-to-slow promise.
    const cacheKey = dataset.buildHash === null ? null : buildScopedKey(url, dataset.buildHash)
    const hit = cacheKey && (await cache.match(cacheKey))
    if (hit) return notModifiedIfMatched(request, hit)
    const value = await produce(dataset)
    const res = json(value, maxAge, etagOf?.(value))
    if (cacheKey) ctx.waitUntil(cache.put(cacheKey, res.clone()))
    return notModifiedIfMatched(request, res)
  } catch (err) {
    // A handler that knows why it failed threw a `WireError` and keeps its own code — that is how
    // a malformed id reaches the rider as 400 instead of the 502 this line used to hard-code.
    // Everything else here is dataset or upstream I/O, so it stays `upstream_unavailable`.
    return errorResponse(err, CORS, { context: errPrefix })
  }
}

/** The colo cache key for `url` under a specific dataset build. See `cached` for why. */
function buildScopedKey(url: URL, buildHash: string): Request {
  const keyUrl = new URL(url.toString())
  keyUrl.searchParams.set('__build', buildHash)
  return new Request(keyUrl.toString(), { method: 'GET' })
}

/**
 * `decodeURIComponent` **throws** on a malformed escape (`%E0%A4%A`), and every canonical id
 * arrives percent-encoded because place ids contain `+`. Untrapped, that left the isolate as
 * workerd's bare `Error 1101` — no envelope, no code, and a 500 that reads as retryable. It is a
 * client mistake, so it is a 400 like every other unparseable id.
 */
function decodeId(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(request, env, ctx)
    } catch (err) {
      // Nothing in `handle` is supposed to throw — every handler that can fail already answers with
      // a taxonomy member. Reaching here therefore means a bug of ours, which is exactly what
      // `internal` denotes. It is still `retryable`, because our bug is no evidence that the
      // rider's saved stop is gone, and a Widget must not prune a favourite over it.
      console.error(`[edge] unhandled: ${(err as Error)?.stack ?? String(err)}`)
      return errorResponse(err, CORS, { fallback: 'internal' })
    }
  },
} satisfies ExportedHandler<Env>

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
      return fail('bad_request', 'usage: /v1/eta/:co/:stop/:route[/:serviceType]')
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
      return fail(
        'bad_request',
        'GMB live ETAs are served via /v1/etas/:id (stop board), not /v1/eta',
      )
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
      return errorResponse(err, CORS, { context: 'upstream error' })
    }
  }

  // GET /v1/tiles/basemap/:z/:x/:y.png · /v1/tiles/label/:lang/:z/:x/:y.png
  // LandsD raster basemap, re-emitted as publicly cacheable (ADR-049). See src/tiles.ts.
  const tile = parseTilePath(parts)
  if (tile) {
    if ('error' in tile) return fail('bad_request', tile.error)
    const cache = caches.default
    const cacheKey = new Request(url.toString(), request)
    const hit = await cache.match(cacheKey)
    if (hit) return hit
    try {
      const res = await fetchTile(tile.upstream)
      if (res.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()))
      return res
    } catch (err) {
      // A refused connection to LandsD is an upstream failure like any other, not a bug of ours
      // — without this it reached the top-level catch and was reported as `internal`.
      return errorResponse(err, CORS, { context: 'tile error' })
    }
  }

  // GET /v1/index  → SearchIndex (compact route + stop list for on-device search +
  // the smart keypad — ADR-037). Static per build, so it gets a long TTL; the client
  // caches it and redownloads only when `version` moves.
  if (parts[0] === 'v1' && parts[1] === 'index') {
    return cached(
      request,
      url,
      ctx,
      env,
      21_600,
      (dataset) => dataset.searchIndex(),
      'index error',
      // The index's own content hash is its strong validator (ADR-063), so a returning client
      // revalidates once the 6 h `max-age` lapses and pays a 304 instead of the whole blob.
      // This is the only endpoint with one: everything else is either live (a validator that
      // never matches is pure overhead) or small enough that the round trip is the cost.
      (index) => `"${index.version}"`,
    )
  }

  // GET /v1/nearby?lat=&lng=[&radius=]  → NearbyStop[]
  if (parts[0] === 'v1' && parts[1] === 'nearby') {
    // `Number(null)` is **0**, not NaN, and `searchParams.get` returns null for an absent key —
    // so reading these straight through `Number()` turned "no coordinates supplied" into "the
    // coordinates are 0, 0" and served an empty list with a 200. A client with a broken location
    // permission got a confident "no stops near you" instead of an error it could report.
    // Malformed values (`lat=abc`) were rejected all along; only *missing* ones slipped through.
    const latRaw = url.searchParams.get('lat')
    const lngRaw = url.searchParams.get('lng')
    const lat = latRaw === null ? Number.NaN : Number(latRaw)
    const lng = lngRaw === null ? Number.NaN : Number(lngRaw)
    const radiusRaw = Number(url.searchParams.get('radius') ?? '500')
    // Clamped, because since WP0-1 the radius decides how many **KV keys** a request reads:
    // one per ~1.1 km geo cell, quadratic in the radius. Unclamped, `radius=50000` would fan
    // out to ~8,000 concurrent reads, blow the per-request subrequest limit and 502 — a remote
    // amplification from one query parameter. 2 km is far beyond any walkable stop.
    const radius = Number.isFinite(radiusRaw) ? Math.min(2000, Math.max(50, radiusRaw)) : 500
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return fail('bad_request', 'usage: /v1/nearby?lat=<deg>&lng=<deg>[&radius=<m>]')
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
      return errorResponse(err, CORS, { context: 'nearby error' })
    }
  }

  // GET /v1/stop/:id  → StopDetail (canonical id, e.g. KMB:<stopId> or CTB:<stopId>)
  if (parts[0] === 'v1' && parts[1] === 'stop' && parts[2]) {
    const id = decodeId(parts[2])
    if (id === null) return fail('bad_request', `malformed percent-encoding: ${parts[2]}`)
    return cached(
      request,
      url,
      ctx,
      env,
      ETA_TTL_SEC,
      (dataset) => stopDetail(dataset, id),
      'stop error',
    )
  }

  // GET /v1/route/:id  → RouteDetail (canonical id, e.g. KMB:6:outbound:1, CTB:1:outbound:1)
  // Now carries live per-stop ETAs (ADR-030) → short TTL like the other live endpoints,
  // not the hour the static geometry alone could afford.
  if (parts[0] === 'v1' && parts[1] === 'route' && parts[2]) {
    const id = decodeId(parts[2])
    if (id === null) return fail('bad_request', `malformed percent-encoding: ${parts[2]}`)
    return cached(
      request,
      url,
      ctx,
      env,
      ETA_TTL_SEC,
      (dataset) => routeDetail(dataset, id),
      'route error',
    )
  }

  // GET /v1/etas/:id[?routes=a,b]  → Eta[] for a stop (canonical id). The app-facing
  // ETA endpoint; the lower-level /v1/eta/:co/:stop/:route stays for debugging.
  if (parts[0] === 'v1' && parts[1] === 'etas' && parts[2]) {
    const id = decodeId(parts[2])
    if (id === null) return fail('bad_request', `malformed percent-encoding: ${parts[2]}`)
    const routesParam = url.searchParams.get('routes')
    const routeIds = routesParam ? routesParam.split(',').filter(Boolean) : undefined
    return cached(
      request,
      url,
      ctx,
      env,
      ETA_TTL_SEC,
      (dataset) => stopEtas(dataset, id, routeIds),
      'etas error',
    )
  }

  return fail('not_found', 'not found')
}
