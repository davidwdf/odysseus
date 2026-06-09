import { etaView } from './eta'

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
 */
export function inferBusMarkers(soonest: Array<string | null>, now: number): BusMarker[] {
  const markers: BusMarker[] = []
  for (let i = 0; i < soonest.length; i++) {
    const a = soonest[i]
    if (!a) continue
    const prev = i > 0 ? soonest[i - 1] : null
    // A new (lead) bus is heading to stop i when the previous stop shows nothing, or a
    // *later* bus (prev > a) — i.e. the lead bus has already passed the previous stop.
    const isLead = !prev || prev > a
    if (!isLead) continue
    const { isDue, hasDeparted } = etaView(a, now)
    if (hasDeparted) continue
    markers.push({ toIndex: i, atStop: isDue })
  }
  return markers
}
