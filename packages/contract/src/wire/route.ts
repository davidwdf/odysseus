// Routes and their static service facts. See the three rules at the top of `primitives.ts`.
//
// Two conventions in here a native developer will otherwise guess wrong, so they are written into
// the schema descriptions and not just this comment:
//
//  · **Fares are decimal *strings*.** Compare numerically, display verbatim, never parse to a
//    float — HK fares like "6.7" are exact upstream and float round-tripping invents pennies.
//  · **`"HH:mm"` can exceed 24.** "25:35" means 01:35 the next day. A naive parse yields an
//    invalid time or throws; a naive sort puts the last bus before the first.

import { z } from 'zod'
import { BoundSchema, I18nTextSchema, OperatorIdSchema } from './primitives'

/**
 * Which days a frequency pattern runs. `other` = an uncommon mix (e.g. Mon–Sat); the UI falls back
 * to the exact `days` mask for those. Sourced from the dataset's service-day map.
 */
export const ServiceDayTypeSchema = z
  .enum(['weekday', 'saturday', 'sunday', 'daily', 'other'])
  .meta({ id: 'ServiceDayType', 'x-unknown-tolerant': true })

/**
 * One frequency band within a day: buses roughly every `headwayMin` minutes between `start` and
 * `end`.
 */
export const FreqBandSchema = z
  .object({
    start: z.string().describe('Local 24h "HH:mm". May exceed 24 — "25:35" means 01:35 next day.'),
    end: z.string().describe('Local 24h "HH:mm". May exceed 24 — "25:35" means 01:35 next day.'),
    headwayMin: z.number(),
  })
  .meta({ id: 'FreqBand' })

/**
 * A day-type's frequency profile — the bands the badge's coarse min–max is derived from, plus the
 * first/last departure. From the GTFS frequency table joined to the dataset's service-day map
 * (ADR-044). The **Static** honesty tier — a coarse timetable summary, never live.
 */
export const FreqPatternSchema = z
  .object({
    dayType: ServiceDayTypeSchema,
    /**
     * Days this pattern runs, **Sunday-first `[Sun…Sat]`**, so the UI can render an exact day row
     * when `dayType` is `other`. Always 7 entries.
     */
    days: z.array(z.boolean()),
    bands: z.array(FreqBandSchema),
    first: z
      .string()
      .describe('Earliest first departure across the bands, "HH:mm" (may exceed 24).'),
    last: z.string().describe('Latest last departure across the bands, "HH:mm" (may exceed 24).'),
  })
  .meta({ id: 'FreqPattern' })

// ── The two service-fidelity tiers (ADR-065) ─────────────────────────────────────────────────
//
// `Route` is served at two fidelities, and until ADR-065 both used one schema with an optional
// `patterns`, so a decoder could not tell *"this route has no frequency table"* from *"you asked
// the endpoint that doesn't send one"*. The tiers are now two named component schemas, so the
// distinction is carried by the type a generator emits rather than by prose a human has to read.
//
// The reduced tier is not an oversight to be tidied away: duplicating `patterns` into every place
// a route touches was **54 MB of an 82 MB build** (ADR-055 §7), and `patterns` is read on exactly
// one screen. Keep it dropped.
//
// The shared fields are spread rather than composed with `.extend()`/`allOf` on purpose: each tier
// emits as one **flat** JSON Schema object, which is what a Swift `Codable` struct and a kotlinx
// `@Serializable` data class generate from without a hand-written decoder. An `allOf` chain is the
// shape those generators handle worst.

const routeServiceFields = {
  fareFull: z
    .string()
    .optional()
    .describe(
      'Full adult fare from the route origin, HK$ as a decimal string, e.g. "6.7". Compare numerically, display verbatim, never parse to float.',
    ),
  fareFullHoliday: z
    .string()
    .optional()
    .describe('Holiday full fare, HK$ decimal string. Present only when it differs from fareFull.'),
  journeyMin: z.number().optional().describe('Whole-route journey time, minutes.'),
  headway: z
    .object({ min: z.number(), max: z.number() })
    .optional()
    .describe(
      'Typical headway from the GTFS frequency bands, minutes. Coarse range — no fake precision.',
    ),
  hours: z
    .object({ start: z.string(), end: z.string() })
    .optional()
    .describe(
      'Rough daily service span, local 24h "HH:mm" (may exceed 24). Earliest first departure → latest end.',
    ),
}

/**
 * Static service facts for a route direction at the **summary** tier — everything except the
 * per-day-type frequency profiles. This is what `/v1/stop/:id` serves, and the schema has no
 * `patterns` property at all, so a client reading a stop response cannot mistake its absence for a
 * fact about the route (ADR-065). To show a frequency table, load `/v1/route/:id`.
 *
 * All fields optional; this is the **Static** honesty tier (never styled as live). Fares are
 * *sectional* — riders boarding later pay less — so `fareFull` is the fare from the origin; the
 * per-boarding-stop fare rides on the stop/ETA records.
 */
export const RouteServiceSummarySchema = z.object(routeServiceFields).meta({
  id: 'RouteServiceSummary',
  description:
    'Static service facts at the **summary** tier — no frequency profiles. Served by /v1/stop/{id}. ' +
    'There is deliberately no `patterns` property here: the profiles are large and are read on one ' +
    'screen only, so duplicating them into every place a route touches is not worth 54 MB of the ' +
    'build. Load /v1/route/{id} for them.',
})

/**
 * Static service facts at the **full** tier: the summary fields plus `patterns`. Served by
 * `/v1/route/:id` only. Here an absent `patterns` is a fact about the route — the dataset carries
 * no frequency table for it — because the endpoint that returns this schema always sends one when
 * there is one to send.
 */
export const RouteServiceInfoSchema = z
  .object({
    ...routeServiceFields,
    patterns: z
      .array(FreqPatternSchema)
      .optional()
      .describe(
        'Per-day-type frequency profiles (ADR-044). Absent here means the dataset has no frequency table for this route. A stop response cannot carry this field at all — it returns RouteServiceSummary.',
      ),
  })
  .meta({
    id: 'RouteServiceInfo',
    description:
      'Static service facts at the **full** tier — the summary fields plus `patterns`. Served by ' +
      '/v1/route/{id} only. An absent `patterns` here is a fact about the route (the dataset has no ' +
      'frequency table for it), not an artefact of which endpoint was called.',
  })

const routeFields = {
  id: z
    .string()
    .describe('Canonical route id, e.g. "KMB:6:outbound:1". GMB is "GMB:{no}:{bound}:{gtfsId}".'),
  operator: OperatorIdSchema,
  routeNo: z.string().describe('Public route number shown on the bus, e.g. "6", "720", "N691".'),
  bound: BoundSchema,
  serviceType: z
    .string()
    .describe(
      'Operator service-type discriminator (KMB has variants per route). A string — some upstream entries are numeric and are coerced.',
    ),
  origin: I18nTextSchema,
  destination: I18nTextSchema,
}

/**
 * A route as it appears **in a stop response** — identical to `Route` except that `service` is the
 * summary tier (no frequency profiles). See `RouteServiceSummary` for why (ADR-065, ADR-055 §7).
 */
export const RouteSummarySchema = z
  .object({ ...routeFields, service: RouteServiceSummarySchema.optional() })
  .meta({
    id: 'RouteSummary',
    description:
      'A route as it appears in a stop response: identical to `Route` except that `service` is the ' +
      'summary tier (`RouteServiceSummary`) and therefore carries no frequency profiles.',
  })

/** A route at full fidelity — what `/v1/route/:id` returns. */
export const RouteSchema = z
  .object({ ...routeFields, service: RouteServiceInfoSchema.optional() })
  .meta({
    id: 'Route',
    description:
      'A route at full service fidelity (`service` is `RouteServiceInfo`, including `patterns`). ' +
      'Returned by /v1/route/{id}; stop responses return `RouteSummary` instead.',
  })

/** One stop in a route's ordered sequence. */
export const RouteStopSchema = z
  .object({
    routeId: z.string(),
    seq: z.number().describe('1-based position along the route.'),
    stopId: z.string(),
  })
  .meta({ id: 'RouteStop' })

/**
 * A lightweight pointer to another route direction — just enough to label a toggle and load it
 * (`getRoute(id)`); the full detail comes from that call. ADR-046.
 */
export const RouteRefSchema = z
  .object({
    id: z.string().describe('Canonical route id, e.g. "KMB:6:inbound:1".'),
    origin: I18nTextSchema,
    destination: I18nTextSchema,
  })
  .meta({ id: 'RouteRef' })
