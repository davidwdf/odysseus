// The compact on-device search index (ADR-037). See the three rules at the top of `primitives.ts`.

import { z } from 'zod'
import { BoundSchema, I18nTextSchema, OperatorIdSchema } from './primitives'

/**
 * One searchable route, collapsed to a single record per (operator, route number, direction) —
 * riders search by number, not by the operator's service-type variants. `id` is a *representative*
 * canonical route id to navigate to, so it is not necessarily the variant the rider will board.
 */
export const RouteLiteSchema = z
  .object({
    id: z.string(),
    operator: OperatorIdSchema,
    routeNo: z.string(),
    bound: BoundSchema,
    origin: I18nTextSchema,
    destination: I18nTextSchema,
  })
  .meta({ id: 'RouteLite' })

/**
 * One searchable stop or same-kerb place. `id` is a canonical stop id (`KMB:…`/`CTB:…`) or a merged
 * place id (`P:…`) — both resolve in `/v1/stop/:id`. Same-kerb groups are pre-merged on the edge so
 * they appear once.
 *
 * Note the coordinates are **flat `lat`/`lng` here**, where `Stop` nests them under `location`.
 * Faithful to what ships today; harmless, but do not assume one shape across the wire (ADR-052).
 */
export const StopLiteSchema = z
  .object({
    id: z.string(),
    name: I18nTextSchema,
    lat: z.number(),
    lng: z.number(),
  })
  .meta({ id: 'StopLite' })

/** The compact static index shipped to the client for on-device search. */
export const SearchIndexSchema = z
  .object({
    version: z
      .string()
      .describe(
        'Coarse content tag; the client redownloads when it changes. Currently derived from collection sizes — a content hash is WP2-7.',
      ),
    routes: z.array(RouteLiteSchema),
    stops: z.array(StopLiteSchema),
  })
  .meta({ id: 'SearchIndex' })
