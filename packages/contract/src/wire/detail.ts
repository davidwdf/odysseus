// The composite screen payloads. See the three rules at the top of `primitives.ts`.

import { z } from 'zod'
import { EtaFailureSchema } from './errors'
import { EtaSchema } from './eta'
import { I18nTextSchema, LatLngSchema } from './primitives'
import { RouteRefSchema, RouteSchema, RouteSummarySchema } from './route'
import { StopSchema } from './stop'

/**
 * Route + its ordered stops — returned by `DataSource.getRoute`. Each stop carries the route's own
 * next arrival *there* (`eta`), so a route view can show per-stop times and infer bus positions
 * (ADR-030).
 *
 * **`eta` is `null`, not absent, where this stop has no live reading** — a missing key would mean the
 * server never populated the field, where `null` is an answer. What `null` does **not** tell you is
 * *why*, and this comment used to claim it did: it said `null` means "we asked and there is nothing
 * right now" and then admitted in the same sentence that Citybus has no bulk route-eta feed at all.
 * Both cannot be true, and the second one is — which is why a Citybus route rendered as "no bus is due
 * at any stop" for two waves. **`liveArrivals` is where the reason lives now** (ADR-114); `eta: null`
 * is per-stop and says nothing about the round.
 *
 * `route` is the **full** service tier (`Route` → `RouteServiceInfo`): this is the one endpoint
 * that carries `patterns` (ADR-065).
 */
export const RouteDetailSchema = z
  .object({
    route: RouteSchema,
    stops: z.array(
      z.object({
        seq: z.number(),
        stop: StopSchema,
        eta: EtaSchema.nullable(),
        fare: z.string().optional().describe('Boarding fare at this stop, HK$ decimal string.'),
      }),
    ),
    liveArrivals: z
      .enum(['unavailable', 'perStopOnly'])
      .optional()
      .describe(
        'Why the per-stop `eta`s on this route are **not** a complete answer; **absent when they are** (ADR-114). Without it, `eta: null` on every stop means two different things — no bus is due anywhere, or nobody was asked — and a schematic renders identically for both. Not an `EtaFailure[]` like the other endpoints carry, and deliberately: a route is fetched in ONE upstream call, so naming 34 poles would invent a granularity the fetch does not have, and the UI is required to say this once for the screen rather than per row. `unavailable` = the route feed was asked and did not answer, so it is worth retrying. `perStopOnly` = this operator publishes no route-level arrivals feed (Citybus, GMB — ADR-021), so the route view will never carry them however long a rider waits; their per-pole boards do answer, and `/v1/etas/{poleId}` is where those times are.',
      ),
    reverse: RouteRefSchema.optional().describe(
      'The same route number in the opposite direction, when the dataset carries one — lets the UI offer a direction toggle. Absent for circular / single-direction routes (ADR-046). Server-resolved with the correct service-type variant, so the client never guesses the id.',
    ),
  })
  .meta({ id: 'RouteDetail' })

/**
 * A stop (or merged same-kerb place) + the routes that serve it, each with its current ETA.
 *
 * For a multi-pole place, `stopId` on each route is the canonical id of the **pole** it departs
 * from, so the UI can group routes under their pole (ADR-042) — it is deliberately *not* the place
 * id. `members` carries each pole's id/name/location for the multi-pin map and the per-pole walk
 * estimate; a lone stop has exactly one member.
 *
 * `members` is one entry per **boarding point**, so where upstream published one physical pole under
 * two ids only one of them is a member and the other is in its `aliasIds` (WP5-11). A route row can
 * therefore name a pole that is not itself a member — deliberately, because a row's `stopId` is the
 * key a favourite is saved under, and the reading attached to that row carries the same id. The fold
 * is a *display* collapse: `boardingPoleId`/`dedupeRoutes` (`@nextbus/core`) group and collapse the
 * rows, nothing rewrites them, and both ids stay valid favourite keys for good.
 *
 * Routes here are `RouteSummary`, not `Route`: this endpoint serves the summary service tier, with
 * no frequency profiles (ADR-065, ADR-055 §7). That is a property of the *type*, so a generated
 * decoder cannot read the absence as "this route has no frequency table" — the field does not
 * exist on the summary schema. Load `/v1/route/:id` for the profiles.
 */
export const StopDetailSchema = z
  .object({
    stop: StopSchema,
    routes: z.array(
      z.object({
        route: RouteSummarySchema,
        eta: EtaSchema.nullable().describe(
          'The next arrival for this route AT THIS POLE, or `null` where there is none. Its `stopId` always equals the row’s `stopId`: a reading is never borrowed from a sibling pole, which is what made a bus appear at a kerb it was not coming to (WP5-9). Where upstream published a different service-type variant of the same rider line at this pole, that variant’s soonest reading is the one attached — a board publishes whichever variant is running and a row names one, so the exact route id alone dropped real arrivals.',
        ),
        fare: z.string().optional().describe('Boarding fare here, HK$ decimal string.'),
        stopId: z
          .string()
          .describe(
            'Canonical id of the pole this route departs from — the pole its own stop list names, which may be one of a member’s aliasIds rather than a member (WP5-11). Never re-base it: this is the key a favourite is saved under, and the eta beside it carries the same id.',
          ),
      }),
    ),
    members: z.array(
      z.object({
        id: z.string(),
        name: I18nTextSchema,
        location: LatLngSchema,
        aliasIds: z
          .array(z.string())
          .optional()
          .describe(
            'Other canonical pole ids naming this same physical pole, because upstream published it more than once (WP5-11). A route row may depart from one of these rather than from the member, and its ETA carries the same id: every id here is a real addressable pole, not a spelling to be replaced. Use boardingPoleId/dedupeRoutes (@nextbus/core) to group and collapse rows for display, and never write the result back onto a row — a row id is the key a favourite is saved under, and both ids stay valid keys for good.',
          ),
      }),
    ),
    failed: z
      .array(EtaFailureSchema)
      .optional()
      .describe(
        'Boarding points of this place whose upstream board did not answer, ordered by `stopId`; **absent when every board answered** (ADR-077). A route row whose `eta` is `null` and whose `stopId` appears here has no reading because we could not ask — not because nothing is due. **This field describes the moment this payload was built and must never be carried across a live merge:** `applyLiveEtasToStopDetail` replaces it from its own argument, so a subscription that has taken over becomes the authority (its `status: retrying` frames), rather than a stale list outliving the outage it describes.',
      ),
  })
  .meta({ id: 'StopDetail' })

/** A nearby stop (or merged place) with distance + its soonest arrivals. */
export const NearbyStopSchema = z
  .object({
    stop: StopSchema,
    distanceM: z
      .number()
      .describe(
        'Straight-line distance from the query point, metres. Round it for display — ADR-008.',
      ),
    etas: z
      .array(EtaSchema)
      .describe(
        'Soonest arrivals first, one per route+direction **at each boarding pole** — so a line boarding at two poles of this place appears twice, distinguished by `stopId` (WP5-9). A compact card with no per-pole heading should collapse them to one row per route+direction before capping and counting; `stopCardView` in @nextbus/core is that rule. May be fewer readings than routeCount: routes with no live reading right now are not listed.',
      ),
    routeCount: z
      .number()
      .describe(
        'True number of distinct rider LINES — operator + route number + direction — serving the place, from the static index (no live call), counted once however many poles a line boards at. Lets a compact card say "soonest few of N · +N more" honestly, never a silent filter. Subtract rows counted in the same unit: subtracting per-pole readings from it understates what is hidden.',
      ),
    failed: z
      .array(EtaFailureSchema)
      .optional()
      .describe(
        'Boarding points of THIS place whose upstream board did not answer, ordered by `stopId`; **absent when every board answered** (ADR-077). Without it `etas: []` means two different things — this stop has no buses, or nobody would tell us — and a card renders identically for both. `stopCardView` in @nextbus/core turns it into the one thing a compact card can honestly say, since a card has no per-kerb heading to attach it to. A reading missing for a pole named here has NOT departed.',
      ),
  })
  .meta({ id: 'NearbyStop' })
