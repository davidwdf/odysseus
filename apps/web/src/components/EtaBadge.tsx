import type { EtaLabelParts, EtaUrgency } from '@nextbus/core'
import { SlideNumber } from './SlideNumber'

/**
 * Tone by urgency — the client half of ADR-053's line, and the DOM's copy of the *colour* decision
 * only. The thresholds are `etaUrgency`'s; this table is what `soon` looks like here.
 *
 * It is a deliberate duplicate of `apps/mobile/components/EtaBadge.tsx`'s table, and the duplication is
 * the correct kind: both map a kernel name to their own platform's colour system, which is exactly what
 * a native client will also do. What must never be duplicated is the number that decides which name.
 */
const TONE: Record<EtaUrgency, string> = {
  due: 'text-positive',
  soon: 'text-warning',
  normal: 'text-text',
  none: 'text-muted',
}

/**
 * Honest ETA readout (ADR-008): tabular figures, urgency colour, and no client-side countdown — the
 * value changes only when fresh data arrives.
 *
 * **It says nothing about staleness, deliberately** (ADR-123). Two treatments were tried here and both
 * were withdrawn: a 45 % fade, and a muted `~` before the figure. Neither was badly executed; both were
 * **the wrong unit.** `isStale` reads one `dataTimestamp` per *board*, so a per-figure cue draws a single
 * fact once per reading — 78 times on one route screen — and a rider can do nothing with *"this
 * particular number is two minutes old"*. What they can act on is *"the screen has stopped updating"*,
 * which is a statement about the screen and belongs there. See `docs/07`'s "last updated, and four
 * different reasons".
 *
 * `stale` is therefore **not a prop of this component**. The kernel still computes it — `etaReadout`
 * and `RouteStopRowView` both carry it — and the screen-level line is what will read it.
 */
export function EtaBadge({ label, urgency }: { label: EtaLabelParts; urgency: EtaUrgency }) {
  const tone = TONE[urgency] ?? TONE.none
  return (
    <span className="flex shrink-0 items-baseline">
      {label.kind === 'mins' ? (
        <>
          <SlideNumber
            value={String(label.value)}
            className={`text-h2 font-semibold tabular-nums ${tone}`}
          />
          <span className="ml-0.5 text-caption text-muted">{label.unit}</span>
        </>
      ) : label.kind === 'headway' ? (
        // The published timetable, where there is no live reading at all (WP6-4b) — small and muted rather
        // than a figure, because it is the *Static* honesty tier and must not read as a bus that has been
        // seen. See the RN twin for the longer note.
        <span className="max-w-[120px] text-right text-caption text-subtle">{label.text}</span>
      ) : (
        <span className={`text-h2 font-semibold tabular-nums ${tone}`}>
          {label.kind === 'due' ? label.label : '—'}
        </span>
      )}
    </span>
  )
}
