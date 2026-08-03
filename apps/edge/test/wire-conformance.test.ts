import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { ERROR_CODES, ErrorResponseSchema, WIRE_ENDPOINTS } from '@nextbus/contract'
import type { ErrorCode, Eta, EtaReport, I18nText, RouteDetail, StopDetail } from '@nextbus/core'
import { classifyRemark } from '@nextbus/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDatasetState } from '../src/dataset'
import { fail } from '../src/errors'
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
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === DATASET_URL) return jsonResponse(datasetJson())
    const stopEta = KMB_STOP_ETA.exec(url)
    if (stopEta?.[1]) return jsonResponse(kmbStopEtaJson(stopEta[1]))
    // **Throw rather than fall through to the network.** This line used to be
    // `return realFetch(input, init)`, which made the conformance suite — the gate that decides whether
    // the Worker's responses match the published contract — reach the live internet for any URL the two
    // patterns above did not match. Three consequences, and the first is why it was found: the suite
    // flaked once during WP5-9, and a gate that can fail on somebody's wifi teaches people to re-run it
    // rather than read it. The second is worse: an upstream that answered *plausibly* would let a
    // conformance run pass against real data nobody pinned, so the fixtures would stop being the thing
    // under test. The third is that CI has no HK network path at all, so the failure would arrive as a
    // timeout in the one job whose job is to be believable.
    //
    // Every other suite in this directory already throws here (`dataset-kv`, `eta-coalescing`,
    // `search-index`, `tiles`, `eta-hub`). This one was the exception, and there was no reason for it.
    throw new Error(`unexpected fetch in wire-conformance: ${url}`)
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
    ['getClientPolicy', '/v1/policy'],
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

/**
 * ADR-053: a field the server now owns has to actually arrive, and has to agree with the kernel rule
 * it was moved from.
 *
 * The strict check above cannot see this. `remarkKind` is `.optional()` — it must be, so a client
 * older than the field still decodes — so an edge that quietly stopped classifying would satisfy
 * every schema in the document and the only symptom would be a native client rendering remarks with
 * no honesty cue. Same asymmetry ADR-065's tier test covers, same fix: assert the direction the
 * schema cannot.
 *
 * Asserting it **equals `classifyRemark`** rather than equals `'scheduled'` is the load-bearing part.
 * The claim of ADR-053 is that the rule stays declared once and the edge calls it; a hard-coded
 * expectation here would still pass if someone reimplemented the match in the Worker, which is the
 * precise failure this design exists to prevent.
 */
describe('served fields the schema cannot make mandatory', () => {
  it('/v1/etas/:id classifies its remarks with the kernel rule, not a copy of it', async () => {
    const paths = await resolvePaths()
    const { etas } = (await (await get(paths.get('getStopEtas') as string)).json()) as EtaReport
    const withRemark = etas.filter((e) => e.remark)
    expect(
      withRemark.length,
      'the fixture must carry a remark or this asserts nothing',
    ).toBeGreaterThan(0)
    for (const eta of withRemark) {
      expect(eta.remarkKind, `${eta.routeId} carries a remark but no class`).toBe(
        classifyRemark(eta.remark as I18nText),
      )
    }
  })

  it('/v1/stop/:id and /v1/route/:id classify too — all three ETA paths, not just the flat one', async () => {
    // Three separate assembly points in `stop-route.ts` produce an `Eta` that reaches the wire, and
    // the first version of this change stamped only one of them. A rider would have seen the cue on
    // Nearby and not on the stop page.
    const paths = await resolvePaths()
    const stop = (await (await get(paths.get('getStop') as string)).json()) as StopDetail
    const stopEtas = stop.routes.map((r) => r.eta).filter((e): e is Eta => !!e && !!e.remark)
    expect(
      stopEtas.length,
      'no remark on the stop payload — this would assert nothing',
    ).toBeGreaterThan(0)
    for (const eta of stopEtas) {
      expect(eta.remarkKind).toBe(classifyRemark(eta.remark as I18nText))
    }

    const route = (await (await get(paths.get('getRoute') as string)).json()) as RouteDetail
    const routeEtas = route.stops.map((s) => s.eta).filter((e): e is Eta => !!e && !!e.remark)
    for (const eta of routeEtas) {
      expect(eta.remarkKind).toBe(classifyRemark(eta.remark as I18nText))
    }
  })
})

// ── The error taxonomy (WP2-8 acceptance, ADR-064) ────────────────────────────────────────────
//
// One row per error *exit* in `apps/edge/src`, driven through the real Worker. The table is the
// point: the previous two examples asserted only that the envelope parsed, which is why a
// malformed id could return `502` — a status nobody had written down as wrong — for as long as it
// did. Here every row names the code it expects, and the status is looked up from the contract's
// own table, so a row cannot quietly agree with a handler that picked the wrong one.
//
// Two completeness assertions stop the table rotting:
//   · every member of `ERROR_CODES` is exercised, so adding a code without a path is red;
//   · every published endpoint that takes a parameter has at least one row, because a parameter is
//     the only way a client can get a request wrong. A new endpoint with an `{id}` and no error
//     case shows up here rather than in a native client's crash log.

interface ErrorCase {
  name: string
  code: ErrorCode
  /** The published endpoint this row exercises, or `null` for a router- or tile-level exit. */
  endpoint: string | null
  /** A request path, or `direct` for a code no request can provoke. */
  path?: string
  /** `internal` means *we* have a bug, so by construction nothing a client sends can reach it. */
  direct?: () => Response
  /**
   * Make every outbound fetch fail with this, for the two codes that need a broken upstream rather
   * than a bad request. `/v1/index` on an unseeded KV falls back to the inline build, which is a
   * real fetch of the consolidated dataset — so failing it exercises the catch every dataset-backed
   * endpoint shares.
   */
  fault?: Error
}

/** A well-formed stop id the fixture cannot possibly contain. */
const ABSENT_STOP = 'KMB:NOSUCHPOLE'
/** A well-formed route id, likewise absent. */
const ABSENT_ROUTE = 'KMB:ZZZZ:outbound:1'

const ERROR_CASES: ErrorCase[] = [
  { name: 'a path that is not an endpoint', code: 'not_found', endpoint: null, path: '/v1/nope' },
  {
    name: 'nearby with no coordinates at all',
    code: 'bad_request',
    endpoint: 'getNearby',
    path: '/v1/nearby?radius=498',
  },
  {
    name: 'nearby with an unreadable coordinate',
    code: 'bad_request',
    endpoint: 'getNearby',
    path: '/v1/nearby?lat=abc&lng=114.17&radius=496',
  },
  {
    // The defect WP2-8 exists for: this was a 502, i.e. "try again", forever.
    name: 'a stop id that is not an id',
    code: 'bad_request',
    endpoint: 'getStop',
    path: '/v1/stop/not-an-id',
  },
  {
    // ADR-059's other half: a place id with an empty member denotes a *different* place, so it is
    // rejected rather than resolved — and rejection has to be permanent, not retryable.
    name: 'a place id with a missing member',
    code: 'bad_request',
    endpoint: 'getStop',
    path: `/v1/stop/${encodeURIComponent('P:KMB:POLE00+')}`,
  },
  {
    name: 'a path segment that is not valid percent-encoding',
    code: 'bad_request',
    endpoint: 'getStop',
    path: '/v1/stop/%E0%A4%A',
  },
  {
    name: 'a well-formed stop id nothing serves',
    code: 'not_found',
    endpoint: 'getStop',
    path: `/v1/stop/${encodeURIComponent(ABSENT_STOP)}`,
  },
  {
    name: 'a route id whose direction is not a direction',
    code: 'bad_request',
    endpoint: 'getRoute',
    path: `/v1/route/${encodeURIComponent('KMB:6:sideways:1')}`,
  },
  {
    name: 'a well-formed route id nothing serves',
    code: 'not_found',
    endpoint: 'getRoute',
    path: `/v1/route/${encodeURIComponent(ABSENT_ROUTE)}`,
  },
  {
    name: 'etas for an id that is not an id',
    code: 'bad_request',
    endpoint: 'getStopEtas',
    path: '/v1/etas/nope',
  },
  {
    name: 'etas for a well-formed id nothing serves',
    code: 'not_found',
    endpoint: 'getStopEtas',
    path: `/v1/etas/${encodeURIComponent(ABSENT_STOP)}`,
  },
  {
    name: 'the debug eta endpoint without its segments',
    code: 'bad_request',
    endpoint: null,
    path: '/v1/eta/kmb',
  },
  {
    name: 'the debug eta endpoint asked for GMB',
    code: 'bad_request',
    endpoint: null,
    path: '/v1/eta/gmb/S1/19M/1',
  },
  {
    name: 'a tile below the basemap zoom floor',
    code: 'bad_request',
    endpoint: null,
    path: '/v1/tiles/basemap/3/1/1.png',
  },
  {
    name: 'a label layer in a language LandsD does not publish',
    code: 'bad_request',
    endpoint: null,
    path: '/v1/tiles/label/de/16/53550/28598.png',
  },
  {
    name: 'a bug of ours',
    code: 'internal',
    endpoint: null,
    // Unreachable by request on purpose: every handler that can fail already classifies itself, so
    // `internal` is what the top-level catch in `index.ts` reports when one of them throws anyway.
    // Asserting the envelope through the helper is the honest test of a branch a client cannot
    // provoke — the alternative is a fault injected into production code to make a test go green.
    direct: () => fail('internal', 'synthetic'),
  },
  {
    name: 'upstream refusing the connection',
    code: 'upstream_unavailable',
    endpoint: 'getSearchIndex',
    // A distinct query string per fault case: `caches.default` is not reset between tests, and a
    // shared URL would be answered from the edge cache before any of this ran.
    path: '/v1/index?bust=unavailable',
    fault: new Error('connection refused'),
  },
  {
    name: 'upstream timing out',
    code: 'upstream_timeout',
    endpoint: 'getSearchIndex',
    path: '/v1/index?bust=timeout',
    fault: Object.assign(new Error('the operation timed out'), { name: 'TimeoutError' }),
  },
]

async function assertTaxonomy(res: Response, code: ErrorCode, label: string): Promise<void> {
  const expected = ERROR_CODES[code]
  expect(res.status, `${label}: status must be the one ERROR_CODES gives '${code}'`).toBe(
    expected.status,
  )
  // An error a cache holds outlives the republish that would have fixed it.
  expect(res.headers.get('cache-control'), label).toBe('no-store')

  const body = await res.json()
  const parsed = ErrorResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error(
      `${label} is not an ErrorResponse:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
    )
  }
  expect(parsed.data.code, label).toBe(code)
  expect(parsed.data.retryable, `${label}: retryable must follow the code, not the handler`).toBe(
    expected.retryable,
  )
  // The deprecated field is still served (ADR-052 §5 — additive now, removal later) and still
  // duplicates `message`, which is the whole reason retiring it is safe.
  expect(parsed.data.error, label).toBe(parsed.data.message)
  expect(
    canonical(parsed.data),
    `${label} carries a field ErrorResponse does not describe`,
  ).toEqual(canonical(body))
}

describe('the error taxonomy', () => {
  it('exercises every member of ERROR_CODES — a code with no path is a code nobody has seen', () => {
    const covered = new Set(ERROR_CASES.map((c) => c.code))
    expect([...Object.keys(ERROR_CODES)].filter((c) => !covered.has(c as ErrorCode))).toEqual([])
  })

  it('covers every parameterised endpoint — a parameter is how a client gets a request wrong', () => {
    const covered = new Set(ERROR_CASES.map((c) => c.endpoint).filter(Boolean))
    const uncovered = WIRE_ENDPOINTS.filter(
      (ep) => ep.params.length > 0 && !covered.has(ep.operationId),
    ).map((ep) => ep.operationId)
    expect(uncovered).toEqual([])
  })

  for (const c of ERROR_CASES) {
    it(`classifies ${c.name} as ${c.code}`, async () => {
      if (c.fault) {
        // The memoized inline index has to go both ways round: in, so the failing fetch is actually
        // attempted; out, so the next test does not inherit a poisoned isolate.
        resetDatasetState()
        globalThis.fetch = (async () => {
          throw c.fault
        }) as typeof fetch
      }
      try {
        const res = c.direct ? c.direct() : await get(c.path as string)
        await assertTaxonomy(res, c.code, `${c.name} (${c.path ?? 'direct'})`)
      } finally {
        if (c.fault) resetDatasetState()
      }
    })
  }
})
