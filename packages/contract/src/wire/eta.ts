// Live arrival readings. See the three rules at the top of `primitives.ts`.

import { z } from 'zod'
import { I18nTextSchema, OperatorIdSchema } from './primitives'

/**
 * A normalized estimated-arrival reading. **ETAs are approximations** — ADR-008. A client must not
 * run a per-second countdown off these; update the displayed value only when a fresh reading
 * arrives, and indicate staleness using `observedAt`.
 *
 * The two timestamps are not interchangeable and both are needed: `dataTimestamp` is when the
 * *operator* generated the reading, `observedAt` is when *our* layer fetched it. A reading replayed
 * from an offline cache keeps its original `observedAt` (ADR-058), which is precisely what lets the
 * UI label it stale rather than presenting cached arrivals as live.
 */
export const EtaSchema = z
  .object({
    routeId: z.string(),
    stopId: z.string(),
    operator: OperatorIdSchema,
    arrivals: z
      .array(z.string())
      .describe('Up to ~3 upcoming arrivals, ISO-8601 with a +08:00 offset, soonest first.'),
    destination: I18nTextSchema.optional().describe(
      'Where this service is headed, for flat ETA lists that show "→ dest" without the full Route object (e.g. Nearby). Server-populated; optional because not every feed/path supplies it.',
    ),
    fare: z
      .string()
      .optional()
      .describe(
        'Adult fare for boarding this route *at this stop*, HK$ decimal string. Sectional — see RouteServiceInfo. Compare numerically, display verbatim, never parse to float.',
      ),
    remark: I18nTextSchema.optional().describe(
      'Free-text operator remark, if any (e.g. scheduled vs real-time). Classified client-side; a "Scheduled" remark is a lower-confidence reading, not a live one.',
    ),
    dataTimestamp: z
      .string()
      .describe('When the upstream feed generated this reading. ISO-8601 with a +08:00 offset.'),
    observedAt: z
      .string()
      .describe(
        'When our layer fetched/observed it. ISO-8601 with a +08:00 offset. Survives offline replay — use it for staleness.',
      ),
  })
  .meta({ id: 'Eta' })
