// Stops and places. See the three rules at the top of `primitives.ts`.

import { z } from 'zod'
import { I18nTextSchema, LatLngSchema, OperatorIdSchema } from './primitives'

/** A canonical bus stop, with the per-operator source IDs it was merged from. */
export const StopSchema = z
  .object({
    /** Canonical, app-stable stop id. */
    id: z.string(),
    name: I18nTextSchema,
    location: LatLngSchema,
    /** The operator-native stop ids this canonical stop maps to. */
    sources: z.array(
      z.object({
        operator: OperatorIdSchema,
        operatorStopId: z.string(),
      }),
    ),
    /**
     * Mean direction buses travel through this place (deg, 0–360), for a compass cue that
     * distinguishes two same-named places (e.g. the NE vs SW kerb). **Only set for merged
     * places; absent for a lone stop** — so absent means "not a merged place", never
     * "direction unknown". ADR-042.
     */
    bearingDeg: z.number().optional(),
  })
  .meta({ id: 'Stop' })

/** A physical-location grouping of stops (e.g. KMB + CTB stops at the same kerb). */
export const PlaceSchema = z
  .object({
    id: z.string(),
    name: I18nTextSchema,
    location: LatLngSchema,
    stopIds: z.array(z.string()),
  })
  .meta({ id: 'Place' })
