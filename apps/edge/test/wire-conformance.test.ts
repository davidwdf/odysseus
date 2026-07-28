import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { ErrorResponseSchema, WIRE_ENDPOINTS } from '@nextbus/contract'
import type { RouteDetail, StopDetail } from '@nextbus/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEtaCache } from '../src/eta-cache'
import worker from '../src/index'
import { datasetJson, kmbStopEtaJson, ORIGIN } from './fixtures'

// WP1-1 acceptance. Every JSON endpoint's real response is parsed through the schema the contract
// publishes for it (ADR-052).
//
// This is the test that makes `packages/contract` a contract rather than a wish. The schemas are the
// single declaration the OpenAPI document — and therefore every generated native model — is built
// from, but nothing about writing a schema proves the Worker agrees with it. Without this file, a
// field could be renamed on the edge and the only symptom would appear months later, on a phone,
// as a decode failure nobody can reproduce.
//
// Two properties, and the second is the one that is easy to miss:
//
//  1. **Every response satisfies its schema.** A missing or mistyped field fails here.
//  2. **No response carries a field the contract doesn't describe.** `z.object()` *strips* unknown
//     keys rather than rejecting them, so `parse()` alone would happily accept a response with an
//     extra field and silently discard it — and an undocumented field is drift in the direction
//     that hurts most: the data exists, the web app reads it, and no native client can see it,
//     because it never reached the OpenAPI document. Comparing the response against its own parsed
//     output catches exactly that.

const DATASET_URL = 'https://data.hkbus.app/routeFareList.min.json'
const KMB_STOP_ETA = /^https:\/\/data\.etabus\.gov\.hk\/v1\/transport\/kmb\/stop-eta\/(.+)$/

const realFetch = globalThis.fetch

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

async function get(path: string): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`https://edge.test${path}`), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

/**
 * Recursively sort object keys so two structurally identical payloads serialize identically.
 *
 * Needed because `parse()` rebuilds objects in *schema* declaration order while the Worker emits
 * them in construction order. Without this the comparison below would fail on key order and say
 * "undocumented field" when nothing is wrong — a flaky gate, which is worse than none.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    )
  }
  return value
}

beforeEach(() => {
  resetEtaCache()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === DATASET_URL) return jsonResponse(datasetJson())
    const stopEta = KMB_STOP_ETA.exec(url)
    if (stopEta?.[1]) return jsonResponse(kmbStopEtaJson(stopEta[1]))
    return realFetch(input, init)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

/**
 * Resolve each published endpoint to a request path that returns real data.
 *
 * The ids are *discovered* from a live `/v1/nearby` response rather than hard-coded, so the test
 * can't drift out of step with the fixture: if clustering changes what a place id looks like, this
 * follows it. `radius=497` is deliberately unlike the values the other suites use — `caches.default`
 * is not reset between test files, and a shared URL would be answered from the edge cache.
 */
async function resolvePaths(): Promise<Map<string, string>> {
  const nearbyPath = `/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=497`
  const nearby = (await (await get(nearbyPath)).json()) as Array<{
    stop: { id: string }
  }>
  const placeId = nearby[0]?.stop.id
  if (!placeId) throw new Error('fixture produced no nearby places — cannot resolve paths')

  const detail = (await (await get(`/v1/stop/${encodeURIComponent(placeId)}`)).json()) as {
    routes: Array<{ route: { id: string } }>
  }
  const routeId = detail.routes[0]?.route.id
  if (!routeId) throw new Error(`place ${placeId} serves no routes — cannot resolve a route path`)

  return new Map([
    ['getHealth', '/v1/health'],
    ['getNearby', nearbyPath],
    ['getStop', `/v1/stop/${encodeURIComponent(placeId)}`],
    ['getRoute', `/v1/route/${encodeURIComponent(routeId)}`],
    ['getStopEtas', `/v1/etas/${encodeURIComponent(placeId)}`],
    ['getSearchIndex', '/v1/index'],
  ])
}

describe('every published endpoint conforms to its schema', () => {
  it('covers every entry in WIRE_ENDPOINTS — an undescribed endpoint is a hole in the contract', async () => {
    const paths = await resolvePaths()
    const missing = WIRE_ENDPOINTS.filter((ep) => !paths.has(ep.operationId)).map(
      (ep) => ep.operationId,
    )
    expect(missing).toEqual([])
  })

  it('returns a payload that satisfies the schema, with no undocumented fields', async () => {
    const paths = await resolvePaths()

    for (const ep of WIRE_ENDPOINTS) {
      const path = paths.get(ep.operationId) as string
      const res = await get(path)
      expect(res.status, `${ep.operationId} (${path})`).toBe(200)

      const body = await res.json()

      // (1) the response satisfies the published schema
      const parsed = ep.response.safeParse(body)
      if (!parsed.success) {
        throw new Error(
          `${ep.operationId} response does not satisfy ${ep.response.meta()?.id}:\n` +
            JSON.stringify(parsed.error.issues, null, 2),
        )
      }

      // (2) …and carries nothing the schema doesn't describe
      expect(
        canonical(parsed.data),
        `${ep.operationId} returned field(s) absent from ${ep.response.meta()?.id} — ` +
          'document them, or stop sending them',
      ).toEqual(canonical(body))
    }
  })
})

/**
 * ADR-065: `Route.service` ships at two fidelities and they are now two schemas, so which tier an
 * endpoint serves is a fact the contract states. A fact the contract states has to be a fact the
 * Worker is *held* to — otherwise the OpenAPI document is a wish again, and the failure lands on a
 * native client that reads a missing `patterns` as "this route runs on no timetable".
 *
 * Half of this is already automatic: `StopDetail` now parses through `RouteSummary`, which has no
 * `patterns` key, so the strict check above would flag a stop response that carried one as an
 * undocumented field. What that check *cannot* see is the other direction — a route endpoint that
 * quietly stopped sending profiles would satisfy every schema in the document, because `patterns`
 * is optional at the full tier too. So both directions are asserted, against a fixture whose routes
 * all have a frequency table.
 */
describe('the two service-fidelity tiers are the ones each endpoint serves', () => {
  it('/v1/route/:id serves the full tier — patterns present', async () => {
    const paths = await resolvePaths()
    const detail = (await (await get(paths.get('getRoute') as string)).json()) as RouteDetail
    expect(detail.route.service?.patterns?.length, 'the route tier must carry the profiles').toBe(2)
  })

  it('/v1/stop/:id serves the summary tier — no route carries patterns', async () => {
    const paths = await resolvePaths()
    const detail = (await (await get(paths.get('getStop') as string)).json()) as StopDetail
    expect(detail.routes.length).toBeGreaterThan(0)
    for (const { route } of detail.routes) {
      // Not `patterns === undefined`: the point is that the key is absent from the payload, and
      // `service` still carries the summary facts — the tier is reduced, not emptied.
      expect(Object.keys(route.service ?? {}), route.id).not.toContain('patterns')
      expect(route.service?.headway, `${route.id} lost its summary facts too`).toBeDefined()
    }
  })
})

describe('the error envelope', () => {
  it('conforms on an unknown path', async () => {
    const res = await get('/v1/nope')
    expect(res.status).toBe(404)
    expect(ErrorResponseSchema.safeParse(await res.json()).success).toBe(true)
  })

  it('conforms on a bad request', async () => {
    // Missing lat/lng — the 400 branch of /v1/nearby.
    const res = await get('/v1/nearby?radius=498')
    expect(res.status).toBe(400)
    expect(ErrorResponseSchema.safeParse(await res.json()).success).toBe(true)
  })
})
