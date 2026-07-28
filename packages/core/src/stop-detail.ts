// The three list rules the Place (stop-detail) screen is built out of: which route rows a rider
// sees, which operators the place is "served by", and what order its poles appear in.
//
// They lived inside `apps/mobile/app/stop/[id].tsx` until WP2-2, where they were reachable only by
// rendering a React tree — so nothing could assert them, and Swift and Kotlin would each have had to
// re-derive them by reading JSX. They are domain rules over the canonical model (ADR-051): a merged
// **place** is N poles (ADR-042), each pole has its own routes and its own walk, and these decide
// what that collapses to on screen.
//
// Nothing here reads a clock, a locale or a device. `orderPoles` takes the distances it needs as an
// argument for the same reason `inferBusMarkers` takes `now`: the rule must produce the same answer
// on every platform and in a test, and a function that measures its own inputs cannot.

import type { OperatorId, StopDetail } from './types'

// `@spec <module>#<export>` below means: that export's behaviour is pinned by the language-neutral
// JSON corpus at `../spec/<module>.spec.json`, group `<export>`. These are **domain rules** — the
// one kind of change no schema can generate (ADR-052 context, kind 2), so they are hand-ported to
// Swift and Kotlin and the corpus is the only thing keeping the ports equal. Change a rule and you
// edit the corpus; every platform's suite then goes red until it has been ported.
// `scripts/check-spec-coverage.mjs` fails a tagged export with no corpus **and** a corpus with no tag.

/** One route serving a place, plus the member pole (`stopId`) it departs from (ADR-042). */
export type StopDetailRoute = StopDetail['routes'][number]

/** One member pole of a place. A lone stop is a place with exactly one. */
export type StopDetailPole = StopDetail['members'][number]

/**
 * Collapse rider-duplicate variants to one row per line, keeping the one with a live ETA.
 *
 * A "line" is **operator + route number + direction** — the unit a rider thinks in. The operators
 * publish finer: KMB and Citybus split a route into service-type variants (Citybus 969 is listed
 * three times at one pole, all bound for Causeway Bay), and GMB does the same with
 * "Normal"/"Special" codes. Showing those raw is three identical-looking rows to choose between.
 * The key includes the operator so a merged same-kerb place still keeps KMB-6 and CTB-6 apart, and
 * it is the same key the edge's `dedupeEtas` collapses on, so the two agree about what a line is.
 *
 * **Order is first-appearance:** replacing a keyed entry keeps the position its first variant had,
 * so the list does not reshuffle when a later variant happens to be the one carrying the reading.
 *
 * ⚠️ Two corpus rows here are `knownDefect`. Both are consequences of the key deliberately *not*
 * containing the pole, and neither is fixed here — this module is a move, and a move that changes
 * behaviour is untraceable. Read `spec/stop-detail.spec.json` before touching the key.
 *
 * @spec stop-detail#dedupeRoutes
 */
export function dedupeRoutes(routes: readonly StopDetailRoute[]): StopDetailRoute[] {
  const byKey = new Map<string, StopDetailRoute>()
  for (const r of routes) {
    const key = `${r.route.operator}|${r.route.routeNo}|${r.route.bound}`
    const existing = byKey.get(key)
    if (!existing || (!existing.eta && r.eta)) byKey.set(key, r)
  }
  return [...byKey.values()]
}

/**
 * The operators serving this place, in first-seen order, once each — the "served by KMB, Citybus"
 * line. First-seen, not sorted: the caller passes the deduped route list, whose order is the
 * dataset's, so the operator that leads the list is the one that leads the label. Sorting would
 * read as a ranking the data does not support.
 *
 * @spec stop-detail#operatorsOf
 */
export function operatorsOf(routes: readonly Pick<StopDetailRoute, 'route'>[]): OperatorId[] {
  const seen: OperatorId[] = []
  for (const r of routes) if (!seen.includes(r.route.operator)) seen.push(r.route.operator)
  return seen
}

/**
 * Order a place's poles for the grouped route list (and its map dots), in **three tiers**:
 *
 *   1. **The pole the rider arrived from**, if any. Reaching a place from a route hands us
 *      `?pole=` — the rider has already named the kerb they care about, so nothing outranks it.
 *      Notably it outranks distance: a nearer pole they cannot board their bus from is not a
 *      better answer, it is a different question.
 *   2. **Nearest first**, when a distance is known for both. Absent an explicit ask, how far you
 *      have to walk is the only rider-facing difference between two kerbs at one place.
 *   3. **Server order** — the place's own member order, which ADR-042 makes the sorted member-id
 *      list embedded in the `P:` id. Arbitrary, but *stable*: it is identical before and after a
 *      location fix lands, so the list does not reshuffle under the rider's thumb when the GPS
 *      resolves, and identical between two renders of the same payload.
 *
 * Tier 2 applies only when **both** distances are known. That is not graceful degradation, it is a
 * statement about the only caller: a location fix either exists, in which case every member has
 * been measured, or it does not, in which case none have. ⚠️ Hand a *partially* measured map to
 * this and the comparator stops being a strict weak ordering — A can beat B on distance while B
 * beats C and C beats A on index — and the result is then whatever the platform's sort does with a
 * cycle (V8 shrugs; Swift traps in a debug build). It is left exactly as it was because a move that
 * changes behaviour is a move nobody can review; the corpus pins the one partial shape that *is*
 * well defined (at most one pole measured → server order), and the fix — an unknown distance
 * sorting last — wants its own change and its own rows.
 *
 * The third tier is written out as an index comparison rather than left to a stable sort. In
 * TypeScript the two are identical (`Array#sort` has been stable since ES2019); in **Swift they are
 * not** — `sort(by:)` gives no stability guarantee — so a hand-port of a comparator that returned 0
 * here would scramble tier 3 on one platform only, which is precisely the divergence ADR-060 exists
 * to catch. A total comparator costs one line and cannot be got wrong.
 *
 * @spec stop-detail#orderPoles
 */
export function orderPoles(
  poles: readonly StopDetailPole[],
  arrivedFrom: string | undefined,
  distanceM: ReadonlyMap<string, number>,
): StopDetailPole[] {
  return poles
    .map((pole, index) => ({ pole, index }))
    .sort((a, b) => {
      const aArrived = a.pole.id === arrivedFrom
      const bArrived = b.pole.id === arrivedFrom
      if (aArrived !== bArrived) return aArrived ? -1 : 1
      const da = distanceM.get(a.pole.id)
      const db = distanceM.get(b.pole.id)
      if (da != null && db != null && da !== db) return da - db
      return a.index - b.index
    })
    .map((entry) => entry.pole)
}
