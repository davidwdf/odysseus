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
import { SearchIndexSchema } from './search'

/**
 * The error envelope, **as it is served today**.
 *
 * ⚠️ This is not the taxonomy the plan specifies (`{code, message, retryable}`) and it is a known
 * gap, transcribed faithfully because WP1-1 changes no shapes (ADR-052). The cost is concrete: an
 * iOS Widget holding a favourite for a stop that no longer exists cannot distinguish "prune this
 * permanently" from "retry on the next refresh", so it retries forever. Fix additively — serve
 * `code` and `retryable` alongside `error`, let clients migrate, then retire `error`.
 */
export const ErrorResponseSchema = z
  .object({
    error: z.string(),
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
] as const satisfies ReadonlyArray<{
  operationId: string
  path: string
  summary: string
  response: z.ZodType
  params: readonly WireParam[]
}>
