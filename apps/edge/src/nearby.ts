import type { NearbyStop } from '@nextbus/core'
import { nearbyFromCells } from '@nextbus/data-normalize'
import type { DatasetSource } from './dataset'
import { stopArrivals, toMergedStop } from './stop-route'

// Bounds so a cold nearby request stays cheap (all edge-cached). KMB and GMB poles cost one
// stop-board call each regardless of route count (ADR-042), so the fan-out is dominated by
// CTB; `NEARBY_CTB_BUDGET` caps CTB per place. The v2 push engine (ADR-004) replaces this
// fan-out later.
const MAX_STOPS = 6
const NEARBY_CTB_BUDGET = 12

/**
 * GET /v1/nearby — the closest places, each with its soonest de-duplicated arrivals.
 *
 * Since WP0-1 the candidate set comes from precomputed geo cells rather than a linear scan of
 * every stop in Hong Kong, and same-kerb grouping is already baked into each entry — so there
 * is no collapse pass here and a place cannot appear twice.
 */
export async function nearby(
  ds: DatasetSource,
  lat: number,
  lng: number,
  radiusM: number,
): Promise<NearbyStop[]> {
  const candidates = await ds.cells(lat, lng, radiusM)
  const hits = nearbyFromCells(candidates, lat, lng, radiusM, MAX_STOPS)

  const cards = await Promise.all(
    hits.map(async ({ entry, distanceM }): Promise<NearbyStop | null> => {
      // Rank from the cell stubs, then read only the winners' full documents.
      const place = await ds.place(entry.id)
      if (!place) return null
      // Canonical, de-duplicated arrivals via the shared server seam. We fetch ALL routes at
      // the place (KMB cheap, CTB to budget) so the soonest are genuinely soonest; the card
      // shows the true `routeCount` (free, precomputed) + "+N more" rather than a silent filter.
      //
      // `failed` rides on the card since WP5-13 (ADR-077): without it `etas: []` means either "no buses
      // due" or "nobody would tell us", and a card renders identically for both — which is the outage
      // reading as an empty stop that ADR-073 closed on `/v1/etas` and could not close here. It is safe
      // to serve now because `applyLiveEtasToNearby` replaces the field rather than spreading it, so a
      // list fetched here cannot survive into a live round that reported nothing (WP5-7).
      //
      // Already per-card: `stopArrivals` is called per place, so its failures name this place's own
      // poles and need no attribution. The kernel does attribute, for the live path, where one round's
      // failures span every card.
      const { etas, failed } = await stopArrivals(place, NEARBY_CTB_BUDGET)
      return {
        stop: toMergedStop(place),
        distanceM,
        etas,
        routeCount: place.routeCount,
        // Absent, not `[]`, when every board answered — the shape the schema declares, and what
        // `stopCardView` reads by length rather than by presence.
        ...(failed?.length ? { failed } : {}),
      }
    }),
  )
  // A cell can outlive the place it names only if a build half-landed, which content-addressing
  // rules out — but drop a missing document rather than failing the whole screen.
  return cards.filter((c): c is NearbyStop => c !== null)
}
