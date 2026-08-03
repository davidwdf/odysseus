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
// The failure taxonomy moved to `./errors` in ADR-077 — see that file's header for the cycle that
// forced it (`detail.ts` needs `EtaFailure`, and this module imports `detail.ts`). Re-exported below
// so every existing importer of `ERROR_CODES` / `WireErrorSchema` / `ErrorResponseSchema` /
// `EtaFailureSchema` from here keeps working, and so `@nextbus/contract`'s public surface is unchanged.
import {
  ERROR_CODES,
  ErrorCodeSchema,
  ErrorResponseSchema,
  EtaFailureSchema,
  WireErrorSchema,
} from './errors'
import { EtaSchema } from './eta'
import { ClientPolicySchema } from './policy'
import { SearchIndexSchema } from './search'

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

/**
 * What `/v1/etas/:id` answers: the readings we have, and the boarding points we could not ask about.
 *
 * **This replaced a bare `Eta[]`, and that is a breaking change made on purpose** (ADR-073, ADR-052 §5).
 * The array could not distinguish "this stop has no buses" from "every board refused us": both are
 * `200 []`, and a delta protocol built on top then reports every reading `gone` — *"a failed round is
 * not a departure"* defeated one layer below where both engines enforce it. No additive shape fixes
 * that, because the missing information is about the readings that are *absent*, and an array has
 * nowhere to put it.
 *
 * `failed` is **omitted when empty**, not sent as `[]`. Same reason `Eta.remarkKind` is absent rather
 * than `info`: "every board answered" and "we have nothing to say about failures" should not be the
 * same bytes on the wire, and the common case then costs nothing — which matters here, because this is
 * the payload the poll emulator fetches once per target per cadence.
 *
 * The list is ordered by `stopId` in code-point order, like every other list the live protocol
 * produces (`packages/core/src/live.ts`'s header, D1). Both engines turn each entry into one
 * `status: 'retrying'` frame, so an unordered list would make the two engines' frame sequences differ
 * for identical data — the one property the scenario corpus exists to assert.
 */
export const EtaReportSchema = z
  .object({
    etas: EtaListSchema,
    failed: z
      .array(EtaFailureSchema)
      .optional()
      .describe(
        'Boarding points whose upstream board did not answer, ordered by `stopId`. **Absent when every board answered.** A reading missing from `etas` for a pole named here has NOT departed — we could not ask; a client holding previous readings keeps them and labels them, and must not report them `gone`.',
      ),
  })
  .meta({ id: 'EtaReport' })

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
    summary:
      'Live arrivals for a stop or place, one per route+direction at each boarding pole (WP5-9): service-type variants at one pole collapse to the soonest, and a line boarding at two poles of a place is two readings, distinguished by `stopId`. Since ADR-073 the body is an **object**, not an array: `failed` names the boarding points whose upstream board did not answer, so an outage is distinguishable from a stop with no buses.',
    response: EtaReportSchema,
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

export {
  ERROR_CODES,
  ErrorCodeSchema,
  ErrorResponseSchema,
  EtaFailureSchema,
  WireErrorSchema,
} from './errors'
