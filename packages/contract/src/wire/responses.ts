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
 * A failure, as a body — the three fields that say what went wrong and what to do about it.
 *
 * **Why this is not simply `ErrorResponse`.** Since WP5-1 the same taxonomy has to travel two ways:
 * as an HTTP response body, and as `StatusFrame.error` on the `/v1/live` socket. Two hand-written
 * declarations of "a failure" would fork the moment one of them gained a field — and they would fork
 * *quietly*, because each side has its own tests and neither would notice the other had moved. So the
 * failure body is declared once here, beside the `ERROR_CODES` table it is classified by, and
 * `ErrorResponse` is defined below as *exactly this plus the deprecated duplicate*. Saying that in the
 * type is better than saying it in a comment.
 *
 * It lives in this file rather than in `wire/live.ts` for a mechanical reason worth stating: the
 * socket module needs `WireError`, and `WireError` needs `ErrorCodeSchema`, which is here with the one
 * table that binds a code to its status. Declaring it there instead would make `responses.ts` and
 * `live.ts` import each other, and an ESM cycle between two modules of top-level `const`s does not
 * fail loudly — it evaluates one of them to `undefined`, which surfaces as a schema silently missing a
 * field. The dependency runs one way: `live.ts` reads this file.
 */
export const WireErrorSchema = z
  .object({
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
  .meta({ id: 'WireError' })

/**
 * The error envelope every non-2xx JSON response carries: a `WireError`, plus one field kept alive
 * for older clients.
 *
 * `error` is **deprecated and still served**: ADR-052 §5 makes additive free and removal breaking,
 * so `code`/`message`/`retryable` land alongside it and it is retired in a later, gated change
 * (ADR-064 says which one). It is a duplicate of `message` for as long as it exists — do not read
 * both, and do not parse either. `code` is the field to branch on.
 *
 * `.extend()` emits a flat object rather than an `allOf` of the two, so the published component is
 * unchanged in content — a generator sees the same four properties it always did. What changed is that
 * `code`, `message` and `retryable` now have one declaration instead of two, and the socket's
 * `StatusFrame.error` reads that one.
 */
export const ErrorResponseSchema = WireErrorSchema.extend({
  error: z.string().meta({
    deprecated: true,
    description: 'Duplicate of `message`, kept for pre-ADR-064 clients. Branch on `code`.',
  }),
}).meta({ id: 'ErrorResponse' })

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
 * One boarding point whose upstream board we could not read this round, and why (ADR-073).
 *
 * The unit is the **pole**, not the place and not the route, because the pole is what an upstream call
 * is *for*: a KMB or GMB board is one call per pole, and Citybus is one per (pole, route) — so a
 * Citybus place with one refusing route reports that pole once, and the routes that did answer are in
 * `etas` as usual. Aggregating to the place would say "we could not ask about this stop" when we asked
 * about three of its four kerbs and got answers; splitting to the route would report the same outage
 * a dozen times.
 *
 * `stopId` is the same canonical pole id an `Eta` carries — the one `atPole` stamps and the one
 * `formatFavoriteRouteKey` encodes — so a client can match a failure against the readings it already
 * holds without a second id vocabulary. `error` is the taxonomy (ADR-064) rather than a bare string,
 * because `retryable` is what a background client needs and a message is not something to branch on.
 */
export const EtaFailureSchema = z
  .object({
    stopId: z
      .string()
      .describe(
        'Canonical id of the POLE whose upstream board did not answer — the same spelling `Eta.stopId` carries, so a client can pair a failure with the readings it already holds.',
      ),
    error: WireErrorSchema,
  })
  .meta({ id: 'EtaFailure' })

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
