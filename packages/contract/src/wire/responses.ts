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
// Only the two this module actually *uses* are imported; the back-compat surface is the
// `export … from './errors'` at the foot of the file, which re-exports straight from the source and
// so never consumed these bindings. Importing the other three as well made them dead code.
import { EtaFailureSchema, WireErrorSchema } from './errors'
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
 * the payload the poll emulator's batch is assembled from, once per cadence (WP5-7).
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

/**
 * How many ids one `/v1/etas?ids=…` request may name (WP5-7).
 *
 * Twelve, and it is deliberately the same number as `EtaHub`'s `LIVE_MAX_TARGETS_PER_CONNECTION`,
 * because it answers the same question: how many places does one client watch at once. `/v1/nearby`
 * serves six; the largest legitimate set is a Favourites screen.
 *
 * **The cap is on the wire rather than inside the Worker because the caller has to chunk at it.** The
 * poll emulator splits a subscription into batches of this size, and a client compiled against a
 * different number would either waste a request or take a `400` it could have avoided — the same
 * reason `LIVE_SHARD_COUNT` is a server-side constant and this one is not.
 *
 * Over the cap is a **`400`, never a truncation.** An id list *is* the question being asked, so
 * answering a shorter one silently is ADR-008's no-silent-filter rule with the diagnostic removed: the
 * caller would hold that target's previous readings for ever with nothing to say they had stopped being
 * refreshed. `/v1/nearby` may clamp its `radius` because a clamped radius still answers the question;
 * a shortened id list does not.
 */
export const ETAS_BATCH_MAX_IDS = 12

/**
 * One id's answer inside a batch: exactly an `EtaReport`, plus the id it answers for and the failure
 * that came instead of one.
 *
 * **A superset of `EtaReport`, by extension rather than by restatement**, and that is the property the
 * whole shape exists to have: `/v1/etas?ids=X` must be byte-identical to `/v1/etas/X` in its `etas` and
 * its `failed`, so everything that already consumes an `EtaReport` — `retainFailedPoles`,
 * `applyLiveEtasToNearby`, the poll emulator's per-target bookkeeping — takes an entry unchanged and
 * the batch cannot quietly become a second read path. `.extend()` also emits a **flat** component
 * rather than an `allOf`, which is the `ErrorResponseSchema` precedent and the shape ADR-067's native
 * generators handle best.
 *
 * **`id` is the id as asked, verbatim, and it is not decoration.** A reading's `stopId` is a *pole*; a
 * requested id may be a `P:` place spanning several poles, or a bare pole id that the dataset's alias
 * table promotes to its place. So the map from "the id I asked about" to "the poles that answered"
 * lives in the dataset and no client holds a copy — which is why a flat list of readings across all
 * requested ids would be *undecodable* rather than merely awkward, and why every requested id gets an
 * entry even when it has nothing to report.
 *
 * `error` is the wire form of the failure a single `/v1/etas/{id}` would have answered with as its
 * status: a malformed id, a pole that has left the dataset. It is present **instead of** readings —
 * when it is set, `etas` is empty and carries no meaning, so a caller branches on this field and never
 * on the empty list. `retryable: false` means stop asking about this id, exactly as it does everywhere
 * else in the taxonomy (ADR-064).
 */
export const EtaBatchEntrySchema = EtaReportSchema.extend({
  id: z
    .string()
    .describe(
      'The canonical stop or place id **as the request spelled it**, echoed verbatim so a caller can index its own per-target state by it. There is one entry per distinct requested id, always — a missing entry would be unattributable, and a caller would keep that target’s previous readings with nothing to explain why.',
    ),
  error: WireErrorSchema.optional().describe(
    'Present when this id could not be answered at all — the failure a single `/v1/etas/{id}` would have returned as its status. `etas` is then empty and means nothing: branch on this field, never on the empty list. Absent means the id was answered, possibly partially — that is what `failed` is for.',
  ),
}).meta({ id: 'EtaBatchEntry' })

/**
 * What `/v1/etas?ids=…` answers: one entry per distinct requested id, ordered by `id`.
 *
 * An object rather than a bare array, unlike `/v1/nearby`. ADR-073 had to make `/v1/etas/{id}` a
 * breaking change precisely because an array has nowhere to put a second fact, and a new endpoint is
 * the cheapest possible moment not to repeat that.
 *
 * **Ordered, deduplicated and complete.** `reports.length` is the number of *distinct* ids asked for,
 * and the order is those ids sorted in code-point order — the same total order `acceptTargets` puts its
 * accepted set in (`packages/core/src/live.ts`, D1), so the batching engine and the socket engine
 * cannot serialize one round differently. Two ids that resolve to the *same place* stay two entries:
 * `KMB:A` and `P:KMB:A+CTB:B` are two questions with one answer, and the caller asked both.
 */
export const EtaBatchSchema = z
  .object({ reports: z.array(EtaBatchEntrySchema) })
  .meta({ id: 'EtaBatch' })

/** One request parameter, in the subset of OpenAPI's parameter object we actually use. */
export interface WireParam {
  name: string
  in: 'path' | 'query'
  required: boolean
  /**
   * `'string[]'` means a **repeated** query parameter (`?ids=a&ids=b`) — OpenAPI's
   * `style: form, explode: true`.
   *
   * A member of its own rather than a `'string'` with prose, because the two serialize differently and
   * a generator has to know which: a comma-joined string is not a legal spelling of this parameter.
   * See the `ids` parameter of `getStopEtasBatch` for why the delimiter cannot be a character at all.
   */
  type: 'string' | 'number' | 'string[]'
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
        description:
          'Comma-separated canonical route ids to restrict the **readings** to. It filters the response and never the upstream fan-out — a KMB board is one call for every route at the pole, so there is nothing per-route to narrow — and it never filters `failed` (ADR-073). The description here used to say "restrict the fan-out to", which was a claim about cost that the code does not make.',
      },
    ],
  },
  {
    operationId: 'getStopEtasBatch',
    path: '/v1/etas',
    summary:
      'Live arrivals for up to 12 stops or places in one request — the same answer `/v1/etas/{id}` gives each of them, in one round trip (WP5-7) — **or, with `?route=` instead of `?ids=`, one report per pole of one whole route, narrowed to that route** (ADR-136). Exactly one of the two parameters; both or neither is a 400. Every id goes through the same producer, so an entry is byte-identical to the single-id response, and the edge coalescer makes a pole shared by two ids one upstream call rather than two (ADR-057).',
    response: EtaBatchSchema,
    params: [
      {
        name: 'ids',
        in: 'query',
        required: false,
        type: 'string[]',
        description:
          'Canonical stop or place ids, **repeated** (`?ids=a&ids=b`), each percent-encoded. Repeated and not comma-separated, and that is a grammar constraint rather than a preference: `,` is a legal `idchar` (`ids/id-grammar.abnf`) and a query string decodes `%2C` before any delimiter could be split on, so a comma list cannot be parsed back unambiguously — the parameter repetition is the only separator not drawn from the id alphabet. A `+` in a place id must be `%2B` or it arrives as a space and the id is rejected. At most 12 ids (`ETAS_BATCH_MAX_IDS`); more is a 400. Duplicates collapse to one entry. **Required unless `route` is given** — the two are mutually exclusive, which an OpenAPI parameter table cannot state formally and this sentence states instead.',
      },
      {
        name: 'route',
        in: 'query',
        required: false,
        type: 'string',
        description:
          "One canonical route id (`CTB:182:outbound:1`), percent-encoded — **the alternative to `ids`, not an addition to it** (ADR-136). The server resolves the route's poles from the same route document `/v1/route/{id}` serves and answers one report per pole, **narrowed to this route** — the narrowing `ids` cannot express, because the batch carries no per-id route list and every pole would otherwise be asked about every route calling there. That difference is the whole point: measured on Citybus 182 (31 poles), one un-narrowed chunk of 12 ids cost ~130 upstream calls and 10–20 s where the same poles narrowed cost 12 calls and 0.25 s. This is the polled twin of `/v1/live?route=` and exists for the same rider: Citybus and GMB publish no bulk route-eta feed, so a route screen that cannot hold a socket has no other affordable way to fetch a whole route's times. A malformed id is a 400; a route the dataset does not carry is a 404. Report ids are canonical pole ids in the route's own stop order, deduplicated.",
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
