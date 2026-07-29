// Endpoint envelopes, plus the one registry that both the OpenAPI emit and the response-conformance
// test read.
//
// **Why a registry rather than two lists.** An endpoint documented in the OpenAPI document but not
// exercised by the conformance test is the exact failure this wave exists to prevent: the contract
// would claim a shape nobody ever checked against a real response. Both consumers iterate
// `WIRE_ENDPOINTS`, so an endpoint cannot be described without also being tested, and its schema
// cannot drift from what the Worker returns without a red test.

import { z } from 'zod'
import { NearbyStopSchema, RouteDetailSchema, StopDetailSchema } from './detail'
import { EtaSchema } from './eta'
import { ClientPolicySchema } from './policy'
import { SearchIndexSchema } from './search'

/**
 * The error taxonomy (ADR-064).
 *
 * **`x-unknown-tolerant` matters more here than anywhere else in the contract.** This vocabulary
 * will grow — `rate_limited` is the obvious next member — and an error response is precisely the
 * payload a client is least able to recover from by throwing. That is also why `retryable` rides
 * on the wire as its own boolean instead of being a table a client compiles in: a client that has
 * never heard of a code still knows what to do with it.
 */
export const ErrorCodeSchema = z
  .enum(['bad_request', 'not_found', 'internal', 'upstream_unavailable', 'upstream_timeout'])
  .meta({ id: 'ErrorCode', 'x-unknown-tolerant': true })

/**
 * The status code and the retry advice that belong to each member — **one table, not three**.
 *
 * The defect this replaces was not "the envelope lacks a code". It was that the status code and
 * the meaning were chosen separately at each `fail()` call site, so a malformed id left the Worker
 * as `502` — which reads as *retryable* to every HTTP client and cache in the path. An iOS Widget
 * holding a favourite whose id no longer parses would retry it forever, and no amount of adding
 * `code` to the body fixes that, because the Widget's URLSession sees the status line first.
 * Binding the two together here is what makes them one decision: `apps/edge/src/errors.ts` takes a
 * code and reads the status off this table, so a new error path physically cannot pick a status
 * that disagrees with its meaning.
 *
 * `retryable` is "may the same request succeed later?", which is the question a Widget is actually
 * asking — *prune this favourite permanently, or try again next refresh?* So `internal` is
 * retryable: a fault on our side is not evidence that the rider's saved stop is gone, and pruning
 * their favourites over our own bug is the worse failure.
 *
 * `satisfies Record<z.infer<typeof ErrorCodeSchema>, …>` is the drift gate — adding a member to
 * the enum without a status is a typecheck error, and so is a table entry with no enum member.
 */
export const ERROR_CODES = {
  bad_request: { status: 400, retryable: false },
  not_found: { status: 404, retryable: false },
  internal: { status: 500, retryable: true },
  upstream_unavailable: { status: 502, retryable: true },
  upstream_timeout: { status: 504, retryable: true },
} as const satisfies Record<z.infer<typeof ErrorCodeSchema>, { status: number; retryable: boolean }>

/**
 * The error envelope every non-2xx JSON response carries.
 *
 * `error` is **deprecated and still served**: ADR-052 §5 makes additive free and removal breaking,
 * so `code`/`message`/`retryable` land alongside it and it is retired in a later, gated change
 * (ADR-064 says which one). It is a duplicate of `message` for as long as it exists — do not read
 * both, and do not parse either. `code` is the field to branch on.
 */
export const ErrorResponseSchema = z
  .object({
    error: z.string().meta({
      deprecated: true,
      description: 'Duplicate of `message`, kept for pre-ADR-064 clients. Branch on `code`.',
    }),
    code: ErrorCodeSchema,
    message: z.string().meta({
      description:
        'Human-readable, English, and **not** a stable identifier — it names the offending value and its wording changes freely. Do not match on it.',
    }),
    retryable: z.boolean().meta({
      description:
        'Whether the identical request may succeed later. `false` means the request is permanently wrong (a malformed or deleted id) and a background client — an iOS Widget, a watch complication — should prune it rather than retry.',
    }),
  })
  .meta({ id: 'ErrorResponse' })

/**
 * `GET /v1/health` — the operational truth about one isolate (ADR-055).
 *
 * `datasetBuildsThisIsolate` is the number that matters: how many times this isolate built the
 * 8.3 MB static index in-request. In production it must be **0**; anything else means the slow path
 * is silently serving. `buildHash` is `null` on the in-isolate dev fallback, where `dataset` reads
 * `"inline"`.
 */
export const HealthResponseSchema = z
  .object({
    ok: z.boolean(),
    dataset: z.enum(['kv', 'inline']).meta({ id: 'DatasetOrigin', 'x-unknown-tolerant': true }),
    buildHash: z.string().nullable(),
    datasetBuildsThisIsolate: z.number(),
  })
  .meta({ id: 'HealthResponse' })

/** `GET /` — a liveness banner, not part of the data contract. */
export const RootResponseSchema = z
  .object({
    name: z.string(),
    ok: z.boolean(),
  })
  .meta({ id: 'RootResponse' })

export const EtaListSchema = z.array(EtaSchema).meta({ id: 'EtaList' })
export const NearbyListSchema = z.array(NearbyStopSchema).meta({ id: 'NearbyList' })

/** One request parameter, in the subset of OpenAPI's parameter object we actually use. */
export interface WireParam {
  name: string
  in: 'path' | 'query'
  required: boolean
  type: 'string' | 'number'
  description: string
}

/**
 * Every JSON endpoint the Worker serves, with the schema its 200 response must satisfy and the
 * parameters it accepts.
 *
 * Tiles (`/v1/tiles/…`) are deliberately absent: they return PNG bytes, not JSON, and belong to
 * ADR-049's licence surface rather than this contract. `/v1/eta/:co/:stop/:route` is absent too —
 * it is a debugging endpoint that deliberately fails loudly rather than degrading, and publishing it
 * would invite a native client to depend on it instead of `/v1/etas/:id`.
 */
export const WIRE_ENDPOINTS = [
  {
    operationId: 'getHealth',
    path: '/v1/health',
    summary: 'Dataset tier and in-isolate build count for this isolate.',
    response: HealthResponseSchema,
    params: [],
  },
  {
    operationId: 'getNearby',
    path: '/v1/nearby',
    summary: 'Stops and merged places near a coordinate, with their soonest arrivals.',
    response: NearbyListSchema,
    params: [
      {
        name: 'lat',
        in: 'query',
        required: true,
        type: 'number',
        description: 'Latitude, WGS84 degrees.',
      },
      {
        name: 'lng',
        in: 'query',
        required: true,
        type: 'number',
        description: 'Longitude, WGS84 degrees.',
      },
      {
        name: 'radius',
        in: 'query',
        required: false,
        type: 'number',
        description:
          'Search radius in metres, default 500. **Clamped server-side to 50–2000**: since ADR-055 the radius decides how many KV keys a request reads (one per ~1.1 km cell, quadratic), so an unclamped value is a remote amplification from one query parameter.',
      },
    ],
  },
  {
    operationId: 'getStop',
    path: '/v1/stop/{id}',
    summary: 'A stop or merged place, the routes serving it, and their current ETAs.',
    response: StopDetailSchema,
    params: [
      {
        name: 'id',
        in: 'path',
        required: true,
        type: 'string',
        description:
          'Canonical stop id (e.g. "KMB:1234") or merged place id ("P:<a>+<b>"). A member pole id is promoted to its place. **Percent-encode it** — place ids contain "+", which decodes to a space.',
      },
    ],
  },
  {
    operationId: 'getRoute',
    path: '/v1/route/{id}',
    summary: 'A route direction with its ordered stops and per-stop ETAs.',
    response: RouteDetailSchema,
    params: [
      {
        name: 'id',
        in: 'path',
        required: true,
        type: 'string',
        description: 'Canonical route id, e.g. "KMB:6:outbound:1". Percent-encode it.',
      },
    ],
  },
  {
    operationId: 'getStopEtas',
    path: '/v1/etas/{id}',
    summary: 'Live arrivals for a stop or place, deduped to one line per route+direction.',
    response: EtaListSchema,
    params: [
      {
        name: 'id',
        in: 'path',
        required: true,
        type: 'string',
        description: 'Canonical stop or place id. Percent-encode it.',
      },
      {
        name: 'routes',
        in: 'query',
        required: false,
        type: 'string',
        description: 'Comma-separated canonical route ids to restrict the fan-out to.',
      },
    ],
  },
  {
    operationId: 'getSearchIndex',
    path: '/v1/index',
    summary: 'The compact route + stop index for on-device search.',
    response: SearchIndexSchema,
    params: [],
  },
  {
    operationId: 'getClientPolicy',
    path: '/v1/policy',
    summary: 'Tunable counts, cadences and honesty thresholds the server owns (ADR-053).',
    response: ClientPolicySchema,
    params: [],
  },
] as const satisfies ReadonlyArray<{
  operationId: string
  path: string
  summary: string
  response: z.ZodType
  params: readonly WireParam[]
}>
