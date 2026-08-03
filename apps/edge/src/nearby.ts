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
      // **`report.failed` is dropped here, and the card therefore still cannot tell an outage from
      // an empty stop** (ADR-073, WP5-13). Stated rather than left as a silent `.etas`: the reason is
      // the same one `stopDetail` gives — `applyLiveEtasToNearby` spreads each card, so a `failed`
      // list from an HTTP fetch would outlive the outage it describes once Nearby adopts the live
      // merge. Nearby is not a live adopter yet (WP5-7), so the honest sequence is WP5-7 then WP5-13,
      // not a wire field with no reader and a staleness bug waiting behind it.
      const { etas } = await stopArrivals(place, NEARBY_CTB_BUDGET)
      return { stop: toMergedStop(place), distanceM, etas, routeCount: place.routeCount }
    }),
  )
  // A cell can outlive the place it names only if a build half-landed, which content-addressing
  // rules out — but drop a missing document rather than failing the whole screen.
  return cards.filter((c): c is NearbyStop => c !== null)
}
