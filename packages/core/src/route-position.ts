import { etaView } from './eta'

// `@spec <module>#<export>` below means: that export's behaviour is pinned by the language-neutral
// JSON corpus at `../spec/<module>.spec.json`, group `<export>`. These are **domain rules** — the
// one kind of change no schema can generate (ADR-052 context, kind 2), so they are hand-ported to
// Swift and Kotlin and the corpus is the only thing keeping the ports equal. Change a rule and you
// edit the corpus; every platform's suite then goes red until it has been ported.
// `scripts/check-spec-coverage.mjs` fails a tagged export with no corpus **and** a corpus with no tag.

/**
 * A bus inferred to be somewhere on the route (ADR-030).
 * `toIndex` is the stop it is heading to (its *next* stop, by array order).
 * `atStop` is true when that arrival is imminent (< 1 min) — the bus is drawn **on**
 * the stop node; otherwise it is drawn at the **midpoint of the segment leading into**
 * that stop. We never interpolate a position from a clock — the marker only moves when
 * fresh ETA data arrives (honest with ADR-008).
 */
export interface BusMarker {
  toIndex: number
  atStop: boolean
}

/**
 * Infer bus positions along an ordered route from each stop's soonest arrival.
 *
 * **Drop-off detection (no vehicle id needed):** going forward along the route a single
 * bus reaches successive stops at *increasing* times. So a stop whose soonest arrival is
 * **sooner** than the previous stop's (or whose predecessor has no arrival) marks a
 * *distinct* bus heading to it — the lead bus has already left the earlier stop, which
 * now shows the bus *behind* it (a later time). Each such discontinuity is one bus.
 *
 * Pure: pass `now` in. `soonest[i]` is the ISO arrival at stop `i`, or null if none.
 * ISO strings carry a fixed +08:00 offset, so lexical `>` is chronological.
 *
 * @spec route-position#inferBusMarkers
 */
export function inferBusMarkers(soonest: Array<string | null>, now: number): BusMarker[] {
  // Departed readings are discarded **before** the discontinuity scan, not during it.
  //
  // This ordering is the whole correctness of the function. A departed reading is a bus that has
  // already gone but whose ETA has not refreshed yet — upstream only republishes about once a
  // minute, so they are common, not exotic. Filtering inside the loop used to leave such a reading
  // in place as stop `i-1`'s value, where it still acted as a predecessor: the bus genuinely
  // approaching stop `i` was then judged "not a lead" (its predecessor's time being *earlier* than
  // its own) and dropped as well. Both stops ended up with no marker, so a bus one minute away
  // vanished from the route view entirely. The departed test and the lead test disagreed about
  // which readings existed.
  //
  // Nulling them first makes a departed predecessor count as *absent*, which is what the drop-off
  // rule above already says it should be. Strictly additive: it can only restore markers the old
  // ordering discarded, never invent one, because a departed reading is excluded either way.
  const live = soonest.map((a) => (a && !etaView(a, now).hasDeparted ? a : null))

  const markers: BusMarker[] = []
  for (let i = 0; i < live.length; i++) {
    const a = live[i]
    if (!a) continue
    const prev = i > 0 ? live[i - 1] : null
    // A new (lead) bus is heading to stop i when the previous stop shows nothing, or a
    // *later* bus (prev > a) — i.e. the lead bus has already passed the previous stop.
    const isLead = !prev || prev > a
    if (!isLead) continue
    markers.push({ toIndex: i, atStop: etaView(a, now).isDue })
  }
  return markers
}
