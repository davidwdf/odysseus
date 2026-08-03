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
import { poleNameKey } from './stop-name'
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
 * The **boarding point** a route row departs from: the member pole itself, or — where upstream
 * published one physical pole under two stop ids — the member that pole was folded onto.
 *
 * ## Why a route row can name a pole that is not a member
 *
 * `buildPlaces` folds a cluster's poles onto its boarding points (`foldDuplicatePoles` in
 * `@nextbus/data-normalize`, WP5-11), so a pole upstream published twice is **one** member with the
 * other id listed in its `aliasIds`. The route rows are deliberately *not* re-based to match: a
 * row's `stopId` is the id a rider's favourite is keyed on (ADR-062) and the id the route schematic
 * offers, and re-basing it in the dataset would silently strand every favourite already saved at the
 * folded pole. So the wire keeps both ids and the collapse happens here, at render time, where it is
 * only a display decision and nothing persisted depends on it.
 *
 * That is the whole rule: **the dataset decides which ids are one pole; this decides what that means
 * on screen.** Use it to pick the *heading* a row is grouped under, and pass `members` to
 * `dedupeRoutes` so two ids of one pole collapse to one row.
 *
 * ## What must not be rewritten with the result, and why this returns an id instead of a row
 *
 * **Never write the answer back onto a row's `stopId`.** A row's id is a *key*: `SaveStar` saves
 * `${row.stopId}|${routeId}` and the Favourites tab matches that key against `/v1/stop`'s own rows.
 * Re-base the row and the star writes a key no row will ever carry, which orphans the favourite at
 * the moment a rider creates it — the failure this whole work package exists to avoid, arriving from
 * the other direction. So the two spellings never mix: **the wire and everything persisted speak raw
 * pole ids; only what is grouped or counted goes through here.**
 *
 * The Favourites tab therefore does not call this at all, and does not need to: both ids stay valid
 * keys for ever because the wire keeps naming both.
 *
 * An id the place does not name at all comes back unchanged, which is what makes it safe to call on
 * a `?pole=` parameter from a deep link of any age.
 *
 * @spec stop-detail#boardingPoleId
 */
export function boardingPoleId(
  poleId: string,
  members: readonly Pick<StopDetailPole, 'id' | 'aliasIds'>[],
): string {
  for (const m of members) {
    if (m.id === poleId) return m.id
    if (m.aliasIds?.includes(poleId)) return m.id
  }
  return poleId
}

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
 * line boarding at both renders twice under two identical labels. Two rules share the remedy and
 * neither fuses two services back together. `poleSideOctants` below puts a **compass side** on the
 * heading where the two poles are far enough apart for one to mean something — 226 of the 567
 * affected places. Where they are not, they are usually one physical pole published twice, and the
 * build folds those onto one member (WP5-11) — which is what `members` is for here. Tin Shui Wai
 * Park's two `TN510` poles, 1.1 m apart, are the case both rules were measured on: no side to name,
 * one member after the fold. Read `poleSideOctants`' last section before reaching for an ordinal.
 *
 * ## `members` — collapsing two ids of one pole, without touching the rows
 *
 * Pass a place's `members` and the key uses each row's **boarding point** (`boardingPoleId`) instead
 * of its raw pole, so a line boarding at two ids of one physical pole is one row rather than two.
 * Omit it and nothing changes: every id is its own boarding point, which is the answer for a place
 * that has no aliases — most of them — and for a caller that has no member list to hand.
 *
 * **The rows themselves come back untouched, raw pole id and all.** That is the load-bearing half.
 * Re-basing the key is a display decision; re-basing the *row* would rewrite the id `SaveStar`
 * persists, and the key it wrote would then match no row on the Favourites tab. So the collapse is
 * expressed as a key here rather than as a `map()` at the call site — a call site cannot make that
 * mistake if it never holds a rewritten row. See `boardingPoleId`.
 *
 * @spec stop-detail#dedupeRoutes
 */
export function dedupeRoutes(
  routes: readonly StopDetailRoute[],
  members: readonly Pick<StopDetailPole, 'id' | 'aliasIds'>[] = [],
): StopDetailRoute[] {
  const byKey = new Map<string, StopDetailRoute>()
  for (const r of routes) {
    const pole = boardingPoleId(r.stopId, members)
    const key = `${r.route.operator}|${r.route.routeNo}|${r.route.bound}|${pole}`
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
 * nothing there to separate. The remedy for those is upstream and is now built: `foldDuplicatePoles`
 * (`@nextbus/data-normalize`, WP5-11) makes them **one member**. Measured over build
 * `1ccad7436a8df480` by running this function twice, once over every clustered pole and once over the
 * boarding points the fold leaves: colliding places fall **567 → 496** and colliding heading groups
 * **571 → 498**, so 73 groups stop colliding because there is now only one pole to name. The number
 * this function resolves barely moves (226 → 227), which is the point — the fold removes cases rather
 * than making them nameable. The rest still collide, and this is still the right answer for *this*
 * function: a pair 2–10 m apart is too far to call one pole and too close to give a side.
 *
 * **What now happens to the poles this declines: see `poleDistinctions`** (WP5-12, ADR-080). It calls
 * this rule's guards first, so the 226 groups that get a side here are byte-identical — and for the ones
 * declined it goes on to the pole's own *name* where the names differ (143 groups), and to saying plainly
 * that two kerbs are adjacent where nothing else can (103). This function is unchanged and its refusal
 * is that rule's input rather than its problem.
 *
 * Order-independent, and it never reorders or mutates the input: the caller holds `members` off the
 * query cache and draws the map pins from it.
 *
 * @spec stop-detail#poleSideOctants
 */
export function poleSideOctants(poles: readonly PoleHeading[]): Map<string, number> {
  const sides = new Map<string, number>()
  for (const group of byHeading(poles)) {
    // A heading that is already unique gets nothing — the overwhelmingly common case.
    if (group.length < 2) continue
    const octants = sidedOctants(group.map((p) => p.location))
    if (octants === undefined) continue
    for (const [i, pole] of group.entries()) sides.set(pole.id, octants[i] as number)
  }
  return sides
}

/** Poles grouped by the heading a renderer prints, in first-seen order. */
function byHeading<T extends { heading: string }>(poles: readonly T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const pole of poles) {
    const group = groups.get(pole.heading)
    if (group) group.push(pole)
    else groups.set(pole.heading, [pole])
  }
  return [...groups.values()]
}

/** A planar mean. Over the tens of metres ADR-042 clustering allows, the difference from a spherical
 *  centroid is far below the ~1.1 m the source data is quantised to; it is also exactly how the pipeline
 *  places a `Place`'s own lat/lng, so the two agree. */
function centroid(points: readonly LatLng[]): LatLng {
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
  }
}

/**
 * A compass octant per point, **or `undefined` when the geometry cannot support one** — the two guards
 * that are the whole of `poleSideOctants`' restraint, extracted so a *second* caller can ask the same
 * question about different points.
 *
 * Extracted rather than reached through `poleSideOctants`' returned `Map`, and that is the point:
 * `poleDistinctions`' unit tier has to ask this about **unit centroids**, which have no pole id and no
 * heading, and synthesising fake `PoleHeading` records with invented ids to read an answer back out of a
 * map keyed by id is the laundering that produces two spellings of one thing. Private, so it adds no
 * export and no corpus group; `poleSideOctants`' existing rows going green untouched is the proof the
 * extraction changed nothing.
 *
 * The bearings are taken from the **centroid of the points themselves**, not of the whole place. See
 * `poleSideOctants` for why that was measured rather than assumed.
 */
function sidedOctants(points: readonly LatLng[]): number[] | undefined {
  const centre = centroid(points)
  if (points.some((p) => haversineMeters(centre, p) < POLE_SIDE_MIN_SEPARATION_M / 2))
    return undefined
  const octants = points.map((p) => bearingOctant(initialBearingDeg(centre, p)))
  // Reciprocity only helps a pair; three colliding points can put two of them in one octant, and
  // printing that would make two headings longer and still identical.
  if (new Set(octants).size !== octants.length) return undefined
  return octants
}

/**
 * Poles partitioned into groups no compass word can separate: **complete linkage** at `maxM`.
 *
 * Complete rather than single linkage, matching ADR-071's own reasoning about the fold: single linkage
 * would chain 0 / 9 / 18 m into one 18 m "indistinguishable" unit and suppress a compass word that is
 * perfectly honest at 18 m. The load-bearing property — and it holds whatever order the scan happens to
 * merge in — is that **no unit ever contains two poles more than `maxM` apart**, because a merge is
 * tested against *every* cross pair.
 */
function poleUnits<T extends { location: LatLng }>(poles: readonly T[], maxM: number): T[][] {
  const units: T[][] = poles.map((pole) => [pole])
  for (let i = 0; i < units.length; i++) {
    // `j` is not incremented on a merge: the unit that was at `j` is gone, and whatever slid into its
    // place must be tested against the now-larger unit `i`.
    for (let j = i + 1; j < units.length; ) {
      const a = units[i] as T[]
      const b = units[j] as T[]
      if (a.every((p) => b.every((q) => haversineMeters(p.location, q.location) <= maxM))) {
        units[i] = [...a, ...b]
        units.splice(j, 1)
      } else {
        j++
      }
    }
  }
  return units
}

/**
 * One pole as the labelling rule sees it: `PoleHeading` plus **the pole's own name**, exactly as a
 * renderer would print it in the active locale.
 *
 * Passed in for the same reason `heading` is (see `PoleHeading`): whether two poles are
 * distinguishable is locale-dependent, and a rule that rebuilt the string from `name.en` would answer
 * the wrong question in two of the three locales we ship. It is compared through `poleNameKey`, never
 * by bytes — 16 groups differ only by case or punctuation width.
 */
export interface PoleDistinctionInput extends PoleHeading {
  /** `titleCaseName(splitStopCode(member.name[locale]).label)` — what the renderer would show. */
  name: string
}

/**
 * What tells this pole apart from a sibling printing the same heading.
 *
 * A record with optional fields rather than a discriminated union, following `StopCardView`'s precedent
 * (ADR-077): `crowded` and `octant` are genuinely orthogonal — a *unit* of two poles can have a compass
 * side while the two poles inside it cannot be separated — so a union would need a
 * `side-and-crowded` member, which reads as an enum whose author knew the states were a product. The
 * invariant is written down instead and asserted over every corpus row:
 *
 * > **Two poles under one heading carry the same `octant` only if both are `crowded`, and every pole in
 * > a multi-pole unit is `crowded`.**
 *
 * A pole with nothing to say is **absent from the map**, never present with every field unset.
 */
export interface PoleDistinction {
  /** Print this under the heading. The pole's own name, which differs from its siblings'. */
  name?: string
  /** 0–7, `geo#bearingOctant`'s scale. The word is i18n's (`poleSideLabel`), ADR-054. */
  octant?: number
  /** True when this pole shares a unit with another: closer together than a compass word can resolve. */
  crowded?: boolean
}

/**
 * What each pole of a place is told apart by — in the order the data can support it (WP5-12).
 *
 * ## The gap this closes, and why it needed a third kind of answer
 *
 * `foldDuplicatePoles` refuses to merge two poles more than 2 m apart (one coordinate grid step) and
 * `poleSideOctants` refuses to name a compass side under 10 m. Both refusals are right and ADR-071
 * requires the two numbers to stay different — *"declining to name a side is a weaker act than asserting
 * two poles are one"* — so the band between them is real: measured over build `ceb33eed99461e04`,
 * **141 member pairs across 115 places** share an operator and a byte-identical name in all three
 * locales and sit 2–10 m apart, and every one of them prints an identical heading today. The row that
 * filed it said not to widen either threshold, and this does not.
 *
 * **Two of the row's own three candidate leads were measured and do not work.**
 *
 *  · *A printed code that upstream carries in one locale only* resolves **0 of the 141 — by
 *    construction**, because the band's membership predicate is "identical name in *every* locale", so
 *    any printed code is necessarily identical on both poles. The row conflated two disjoint
 *    populations. The one it was actually describing is 52 pairs whose `en` matches while the Chinese
 *    differs, 28 of them by a code, and that *is* worth having — it is `poleFlagCode`, one function
 *    away in `stop-name.ts`, and it operates on the heading before this rule ever sees a collision.
 *  · *Which pole a rider is closer to* cannot be honest at this range and the app does not even hold a
 *    position good enough to try: `SNAP_GRID_M` is 25 and the snap is mandatory, so simulating a rider
 *    standing **exactly at** one of the two poles, the snapped fix names the **wrong one nearer in
 *    97 of 282 cases (34.4 %)** — mean displacement 10.07 m, and it exceeds the whole pair separation in
 *    224 of 282. That is before any GPS error, and the snap makes the error *deterministic*: every rider
 *    in one 25 m cell gets the same wrong answer, so it is a stable lie rather than a flickering one.
 *
 * ## The shape the data does support, and it was hiding in plain sight
 *
 * **The heading throws away the pole's own name.** Of the 258 heading groups `poleSideOctants` declines
 * on its floor guard, **143 have member names that differ in some locale** — at Bonham Road one pole is
 * *Centre Street, Bonham Road* and the other *BONHAM ROAD, near Golden Phoenix Court*, and both print
 * bare `GMB` / `專線小巴`. Telling a rider "we cannot tell these apart" there is not restraint, it is a
 * false claim about our own data. The remaining 115 groups are WP5-12's set proper, and for them the
 * app **says so plainly**, which is the second branch the row's acceptance explicitly permits.
 *
 * ## The order, and every tier's cost measured
 *
 *  1. **A compass side, byte-identical to today.** Tier 1 *is* one call to the same private helper
 *     `poleSideOctants` uses, so the 226 groups that speak today are unaffected by construction. Side
 *     before name deliberately: name-first would replace a two-word compass cue with a ~35-character
 *     name in 97 groups, and in every name-distinct group one pole's name simply repeats the screen
 *     title. ADR-071's measured restraint — *a cue on 2 % of places means something when it appears* —
 *     is preserved rather than diluted.
 *  2. **The pole's own name**, when the group's folded name keys are pairwise distinct. 143 groups.
 *  3. **Units.** The group is partitioned by complete linkage at the same 10 m the compass rule already
 *     refuses below — no third threshold, so ADR-071's "exactly two numbers" holds — and the compass
 *     question is asked again about the *units'* centroids. A unit gets a side; a unit holding more than
 *     one pole additionally marks each of its poles `crowded`. This is what makes the **mixed place**
 *     honest, and it is the case a simpler rule gets wrong: three poles under one heading, A and B 3 m
 *     apart and C 40 m away, today get *nothing at all* (the distinctness guard trips). Now A and B
 *     share a side **and** say they are adjacent, while C gets its own side — and marking C `crowded`
 *     would have been a plain falsehood.
 *  4. **`crowded` alone**, when the units' octants still collide or there is only one unit. 103 groups.
 *  5. **Nothing**, for a pole alone in its unit inside a group the compass rule still refuses.
 *
 * Poles told nothing fall from every pole in 271 declined groups to **54**. Places carrying any cue go
 * 226 → 464 of 10 115 (2.2 % → 4.6 %) — a doubling, which is the honest cost of this change.
 *
 * ## Two things this deliberately is not
 *
 * **It is not a boarding-point remapping.** `dedupeRoutes` keys a row on `boardingPoleId`, and feeding it
 * a wider mapping would collapse one line boarding at both poles into a single row — discarding the
 * sibling kerb's arrival, which is exactly the defect WP5-9 fixed. A unit is a *display* fact; rows keep
 * their own raw pole ids, which is also what `SaveStar` persists, so no favourite key moves.
 *
 * **It is not an ordinal.** "1 of 2" tells a rider nothing they can walk on and manufactures a
 * distinction between two poles that are, on the ground, one pole. `poleSideOctants` already refuses it
 * and the reason still holds.
 *
 * Order-independent, and it neither reorders nor mutates the input: the caller holds `members` off the
 * query cache and draws map pins from the same array.
 *
 * @spec stop-detail#poleDistinctions
 */
export function poleDistinctions(
  poles: readonly PoleDistinctionInput[],
): Map<string, PoleDistinction> {
  const out = new Map<string, PoleDistinction>()
  for (const group of byHeading(poles)) {
    // A heading already unique needs nothing said about it — the overwhelmingly common case.
    if (group.length < 2) continue

    const octants = sidedOctants(group.map((p) => p.location))
    if (octants !== undefined) {
      for (const [i, pole] of group.entries()) out.set(pole.id, { octant: octants[i] as number })
      continue
    }

    const keys = group.map((p) => poleNameKey(p.name))
    if (new Set(keys).size === group.length) {
      for (const pole of group) out.set(pole.id, { name: pole.name })
      continue
    }

    const units = poleUnits(group, POLE_SIDE_MIN_SEPARATION_M)
    // One unit means every pole is within the floor of every other, so there is no side to ask about;
    // `sidedOctants` would refuse a single centroid anyway, and asking is the clearer statement.
    const unitOctants =
      units.length > 1
        ? sidedOctants(units.map((u) => centroid(u.map((p) => p.location))))
        : undefined
    for (const [i, unit] of units.entries()) {
      const octant = unitOctants?.[i]
      const crowded = unit.length > 1
      // Nothing to say: a pole alone in its unit inside a group the compass rule still refuses. Absent
      // from the map rather than present with every field unset — see `PoleDistinction`.
      if (octant === undefined && !crowded) continue
      for (const pole of unit) {
        out.set(pole.id, {
          ...(octant === undefined ? {} : { octant }),
          ...(crowded ? { crowded: true } : {}),
        })
      }
    }
  }
  return out
}
