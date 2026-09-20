import type { BoardLine, BoardPlace, Bound, NearbyStop, OperatorId } from '@nextbus/core'
import { nearbyFromCells } from '@nextbus/data-normalize'
import type { DatasetSource } from './dataset'
import { LIST_CTB_BUDGET, stopArrivals, toMergedStop } from './stop-route'

// Bounds so a cold nearby request stays cheap (all edge-cached). KMB and GMB poles cost one
// stop-board call each regardless of route count (ADR-042), so the fan-out is dominated by
// CTB; `LIST_CTB_BUDGET` caps CTB per place and is shared with the batch ETA endpoint, which is
// the other reader that answers about several places at once (WP5-7). The v2 push engine
// (ADR-004) replaces this fan-out later.
const MAX_STOPS = 6

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
      const { etas, failed } = await stopArrivals(place, LIST_CTB_BUDGET)
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

/**
 * GET /v1/board — the same places `/v1/nearby` answers with, plus **every line that stops at each**.
 *
 * ## Why this is a second endpoint rather than a field on the first
 *
 * `/v1/nearby` sends a place's readings and a `routeCount`, which is enough to say *"six of twenty-six ·
 * +20 more"* honestly and not enough to say **which** twenty. That was the right trade while a card
 * showed a shortlist of arrivals. It is the wrong one for Home's chip strip (`proposals/07`), whose
 * second half is *every route that stops here, as a badge with no time on it* — the whole point being
 * that nothing is chosen on the rider's behalf. With only a count, one half of Home's board can expand
 * its strip and the other cannot, and a rider sees that.
 *
 * A new path rather than a flag or a widened `NearbyStop`, at the owner's direction: the existing
 * endpoint keeps its payload and its clients exactly as they are, this one is shaped for the board, and
 * retiring the old one once the redesign lands is deleting a route rather than migrating a shape.
 *
 * ## It costs one projection, not one read
 *
 * `nearby()` already loads the full `PlaceDoc` for every place it returns — it cannot fetch arrivals
 * without `members` and `routes` — and then takes a single integer out of the route list it is holding.
 * This takes the list. Same KV reads, same upstream fan-out, same cache key shape; the only difference
 * is bytes on the wire, which is why the line shape is three fields rather than a `RouteSummary`.
 *
 * ## The de-duplication is the rule, and it is what makes `lines.length === routeCount`
 *
 * `PlaceDoc.routes` is one entry **per pole**, so a line boarding at two kerbs of one place appears
 * twice — while `routeCount` counts distinct rider lines (`operator|route|bound`) once. A strip carries
 * no kerb, so two identical badges would ask a rider to choose between them and give them nothing to
 * choose with. De-duplicating on the canonical route id restores the invariant a consumer will assume
 * the moment it sees both fields, and `test/board.test.ts` asserts it rather than leaving it to the
 * reader.
 */
export async function board(
  ds: DatasetSource,
  lat: number,
  lng: number,
  radiusM: number,
): Promise<BoardPlace[]> {
  const candidates = await ds.cells(lat, lng, radiusM)
  const hits = nearbyFromCells(candidates, lat, lng, radiusM, MAX_STOPS)

  const cards = await Promise.all(
    hits.map(async ({ entry, distanceM }): Promise<BoardPlace | null> => {
      const place = await ds.place(entry.id)
      if (!place) return null
      const { etas, failed } = await stopArrivals(place, LIST_CTB_BUDGET)
      return {
        stop: toMergedStop(place),
        distanceM,
        etas,
        routeCount: place.routeCount,
        lines: linesOf(place.routes),
        ...(failed?.length ? { failed } : {}),
      }
    }),
  )
  return cards.filter((c): c is BoardPlace => c !== null)
}

/**
 * The place's distinct **rider lines**, in the order the dataset holds them.
 *
 * ## The key is `operator|routeNo|bound`, and getting that wrong is the whole trap
 *
 * The first version de-duplicated on the canonical **route id** and that is a different question.
 * `PlaceDoc.routes` is one entry per pole, so a line boarding at two kerbs appears twice — the id
 * catches that. It also carries KMB's **service-type variants**, which are distinct route ids
 * (`KMB:6:outbound:1`, `KMB:6:outbound:2`) and **one rider line**: the same number, the same
 * direction, the same bus stop sign. De-duplicating on the id keeps both and `lines.length` then
 * exceeds `routeCount`, because `routeCountOf` in the shard builder counts
 * `operator|route|bound` — one line, once.
 *
 * So this uses the shard builder's key, which is what makes `lines.length === routeCount` true **by
 * construction** rather than by coincidence. A consumer reading both fields will assume it the moment
 * it sees them, and Home does: a "+N" badge computed from a count that disagrees with the list either
 * expands to nothing or hides routes behind a badge saying zero.
 *
 * **Which id survives is the first in dataset order**, deliberately unspecified beyond that. A rider
 * tapping a chip wants *that line*, and every variant of it goes to the same places under the same
 * number; `/v1/route/{id}` resolves the variant question on the screen that can show it.
 */
export function linesOf(
  routes: readonly {
    route: { id: string; operator: OperatorId; routeNo: string; bound: Bound }
  }[],
): BoardLine[] {
  const out: BoardLine[] = []
  const seen = new Set<string>()
  for (const r of routes) {
    // The shard builder's own key (`routeCountOf`). Change one and the invariant breaks silently.
    const line = `${r.route.operator}|${r.route.routeNo}|${r.route.bound}`
    if (seen.has(line)) continue
    seen.add(line)
    out.push({ routeId: r.route.id, operator: r.route.operator, routeNo: r.route.routeNo })
  }
  return out
}
