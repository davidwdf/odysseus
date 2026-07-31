// The four list rules the Place (stop-detail) screen is built out of: which route rows a rider
// sees, which operators the place is "served by", what order its poles appear in, and — where two
// poles would otherwise print the same heading — which compass side each of them is on.
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
// `poleSideOctants` takes the heading *text* for the same reason and returns an **octant, not a
// word** — the rule is the kernel's, the word is `@nextbus/i18n`'s (ADR-054).

import { bearingOctant, haversineMeters, initialBearingDeg } from './geo'
import type { LatLng, OperatorId, StopDetail } from './types'

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
 * A "line" is **operator + route number + direction, at one pole** — the unit a rider thinks in,
 * boarded somewhere specific. The operators publish finer: KMB and Citybus split a route into
 * service-type variants (Citybus 969 is listed three times at one pole, all bound for Causeway Bay),
 * and GMB does the same with "Normal"/"Special" codes. Showing those raw is three identical-looking
 * rows to choose between. The key includes the operator so a merged same-kerb place still keeps
 * KMB-6 and CTB-6 apart.
 *
 * **The pole is in the key, and that is a Wave 5 change** whose reasoning is worth keeping, because
 * the franchised case and the minibus case pull in opposite directions:
 *
 *   · For KMB and Citybus the pole-free key was almost right — the field it discarded is genuinely
 *     noise, a timetable variant of the same bus, and those variants share a pole, so they still
 *     collapse.
 *   · **For GMB that field is the route's identity.** Minibus numbers repeat — it is why a GMB route
 *     id is built on the government's globally-unique id rather than on the number (ADR-047) — and two
 *     different services can share one number in one neighbourhood. At Tai On Street,
 *     `GMB:20:outbound:2002320` boards at `GMB:20000270` for Chai Wan (Fung Yip Street) and
 *     `GMB:20:outbound:2002319` boards at `GMB:20009406` for Chai Wan Industrial City. Both are
 *     circular, so both are "outbound" on every leg and direction cannot separate them either. Fused,
 *     the second destination was never shown — and where route 20 was that pole's only route the
 *     pole's whole group vanished from the list while its dot stayed on the map: **21 poles emptied**
 *     in the 2026-07-27 build.
 *
 * Wave 5 is why it is fixed now rather than eventually. `/v1/etas/:id` collapses readings across the
 * **whole place** and keeps the sooner arrival, so the live merge fills only one of the two poles'
 * rows — and with the survivor chosen by *which row has a reading*, that row's destination, its lit
 * map dot and its scroll target followed the sooner kerb and **moved as buses departed**. Measured
 * against live upstream on 2026-07-31: GMB 68K with both poles publishing 11 s apart, and another pair
 * flipping between "Kai Ham" and "Ho Chung".
 *
 * Note the edge's `dedupeEtas` still collapses *across* poles, so at most one of a line's poles can
 * carry a reading and the other renders as "no reading right now" even when a bus is due there. That
 * is the honest half-answer: the row no longer lies about *where*, and the missing arrival needs the
 * edge to stop discarding it — a wire change, owned separately.
 *
 * **Order is first-appearance:** replacing a keyed entry keeps the position its first variant had,
 * so the list does not reshuffle when a later variant happens to be the one carrying the reading.
 *
 * ⚠️ One corpus row here is still `knownDefect`, and the pole does not touch it: two KMB service-type
 * variants **at one pole** still collapse, and the rule keeps the first variant carrying a reading
 * rather than the *sooner* one. Read `spec/stop-detail.spec.json` before changing the tie-break.
 *
 * ⚠️ A display consequence, not a data one: where two members of a place print the same heading, a
 * line boarding at both renders twice under two identical labels. `poleSideOctants` below is the
 * remedy — a compass side on the heading, not a reason to fuse two services back together — and it
 * covers 226 of the 567 affected places. It deliberately declines the rest, Tin Shui Wai Park's two
 * `TN510` poles among them: at 1.1 m apart there is no side to name, because they are one physical
 * pole published twice. Read that function's last section before reaching for an ordinal.
 *
 * @spec stop-detail#dedupeRoutes
 */
export function dedupeRoutes(routes: readonly StopDetailRoute[]): StopDetailRoute[] {
  const byKey = new Map<string, StopDetailRoute>()
  for (const r of routes) {
    const key = `${r.route.operator}|${r.route.routeNo}|${r.route.bound}|${r.stopId}`
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

/**
 * One pole as the heading rule sees it: where it is, and **the heading a renderer already prints
 * for it**.
 *
 * `heading` is passed in rather than derived because assembling it needs an operator name and a
 * locale, and this package has neither. That is not a concession — it is what makes the rule
 * correct. Whether two headings collide *is itself locale-dependent*: at Shau Kei Wan East
 * Government Secondary School three KMB poles print bare "KMB" in English while the Chinese name of
 * one of them carries `(ED522)`, so the same place is ambiguous three ways in `en` and two ways in
 * `zh-Hant`. A rule that rebuilt the heading from `name.en` would answer the wrong question in two
 * of the three locales we ship, and a rule that compared ids would answer it in none.
 */
export interface PoleHeading {
  /** Canonical member-pole id (ADR-042). The key the result is returned under. */
  id: string
  /** The pole's own coordinate — `StopDetailPole.location`, the only field on the wire that can
   *  tell two identically-named poles apart. */
  location: LatLng
  /** Exactly the text the renderer shows above this pole's routes. Compared, never parsed. */
  heading: string
}

/**
 * Minimum ground separation, in metres, between two identically-headed poles before a compass side
 * is worth printing. Three independent lines land on 10 m and none of them is a round-number
 * preference:
 *
 *   · **`formatDistance` rounds metres to the nearest 10** because ADR-008 forbids fake precision.
 *     An app that refuses to print a distance finer than 10 m must not imply a *direction* finer
 *     than 10 m either.
 *   · **~10 m is the GPS error** `mercator.ts` already names as the reason not to frame a lone stop
 *     tighter than z19. Below it, "the east one" is not a thing a rider standing there can resolve.
 *   · **Below ~2 m the octant is not even stable.** Upstream publishes coordinates to five decimal
 *     places — a ~1.1 m grid — so a member's position carries ±0.55 m per axis. At a 10 m separation
 *     that is ≤ ~9° of wobble on the bearing, comfortably inside an octant's 22.5° half-width; at
 *     2 m it is ~21° and the printed word flips on a one-grid-step coordinate change, which is drift
 *     with extra steps.
 */
const POLE_SIDE_MIN_SEPARATION_M = 10

/**
 * Which compass side each pole of a place sits on — **but only for the poles whose heading would
 * otherwise be indistinguishable from another pole's.**
 *
 * ## The defect this prevents
 *
 * Wave 5 put the boarding pole into a route row's identity (`dedupeRoutes` above), which was right:
 * two different minibuses sharing a number were being fused into one row. The accepted display cost
 * was that a line boarding at two poles of one place now renders **twice, under two headings that
 * can be character-for-character identical** — the rider is asked to choose between two rows and
 * given nothing to choose with.
 *
 * Measured over the shipped build `d598893de6add2e4` (10 118 places), and the shape of the problem
 * is wider than the stop code the plan's row named: **567 places print at least one duplicate pole
 * heading**, across 571 colliding groups. Only 64 of those are stop-code collisions (Tin Shui Wai
 * Park's two `TN510` poles, 61 of the 64 with identical full names too). The other **507 are poles
 * with no printed code at all** — two Citybus poles at Peaksville both reading just "Citybus", three
 * minibus stands both reading just "Minibus". Neither the code nor the name can separate any of
 * them; `location` is the only field on the wire that can, which is why this is a kernel rule and
 * not a screen decision.
 *
 * ## The shape, and why it declines so often
 *
 * The octant is the bearing from the **centroid of the colliding poles** to each of them — not from
 * the centroid of the whole place. That is a deliberate departure from the obvious reading, and it
 * was measured: with the place centroid, a pair sitting off to one side of a five-member interchange
 * gets two bearings only a few degrees apart, and the guard below then throws away 11 of the 15
 * cases it should keep. Relative to *each other* is also the comparison the rider's eyes make, and
 * for a pair the two bearings are reciprocal, so the two sides are opposite by construction.
 *
 * Two guards, and both of them are the point of the rule rather than defensive trimming:
 *
 *   1. **`POLE_SIDE_MIN_SEPARATION_M`** — no side for any pole in a group where some member sits
 *      closer than half that to the group's centroid (for a pair, exactly "closer together than the
 *      floor"). **331 of the 571 groups fail here**, including Tin Shui Wai Park, whose two `TN510`
 *      poles are **1.1 m** apart — one coordinate grid step. 49 of the 64 code collisions are at
 *      *exactly* 0.0 m.
 *   2. **The sides must actually be distinct.** Reciprocity only helps a pair; three colliding poles
 *      can put two of them in one octant, and **14 groups really do** — at that school three KMB
 *      poles print bare "KMB", two of them share a coordinate exactly and the third is 26 m south, so
 *      the octants come out North / North / South. Printing them would make two headings *longer*
 *      and still identical, while telling the rider the ambiguity had been resolved. Silence is the
 *      honest answer, so the whole group is declined.
 *
 * Net: **226 places gain a side, 9 892 render exactly as they do today.** Restraint is the design,
 * not a side effect — a cue that appears on 2 % of places is a cue that means something when it
 * appears.
 *
 * ## What a caller does with a pole that gets nothing
 *
 * Print the heading exactly as it stands, and stop there. **Do not fall back to an ordinal** ("1 of
 * 2"): a number tells a rider nothing they can walk on, and it manufactures a distinction between
 * two poles that are, on the ground, one pole. Because that is what the declined cases mostly are —
 * two poles 0–1 m apart with the same operator, the same name and the same printed code are one
 * boarding point published under two upstream ids, and no word can separate them because there is
 * nothing there to separate. The remedy for those is upstream, in `buildPlaces`
 * (`@nextbus/data-normalize`), which today keeps them as two members; it is not a heading problem
 * and a heading cannot fix it.
 *
 * Order-independent, and it never reorders or mutates the input: the caller holds `members` off the
 * query cache and draws the map pins from it.
 *
 * @spec stop-detail#poleSideOctants
 */
export function poleSideOctants(poles: readonly PoleHeading[]): Map<string, number> {
  const byHeading = new Map<string, PoleHeading[]>()
  for (const pole of poles) {
    const group = byHeading.get(pole.heading)
    if (group) group.push(pole)
    else byHeading.set(pole.heading, [pole])
  }

  const sides = new Map<string, number>()
  for (const group of byHeading.values()) {
    // A heading that is already unique gets nothing — the overwhelmingly common case.
    if (group.length < 2) continue
    // A planar mean of the group's coordinates. Over the tens of metres ADR-042 clustering allows,
    // the difference from a spherical centroid is far below the ~1.1 m the source data is quantised
    // to; it is also exactly how the pipeline places a `Place`'s own lat/lng, so the two agree.
    const centre: LatLng = {
      lat: group.reduce((sum, p) => sum + p.location.lat, 0) / group.length,
      lng: group.reduce((sum, p) => sum + p.location.lng, 0) / group.length,
    }
    if (group.some((p) => haversineMeters(centre, p.location) < POLE_SIDE_MIN_SEPARATION_M / 2))
      continue
    const sided = group.map((pole) => ({
      pole,
      octant: bearingOctant(initialBearingDeg(centre, pole.location)),
    }))
    if (new Set(sided.map((s) => s.octant)).size !== sided.length) continue
    for (const s of sided) sides.set(s.pole.id, s.octant)
  }
  return sides
}
