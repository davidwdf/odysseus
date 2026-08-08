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

/** Honest ETA readout (ADR-008): tabular figures, urgency colour, stale dimming, and no client-side
 *  countdown — the value changes only when fresh data arrives. */
export function EtaBadge({
  label,
  urgency,
  stale,
}: {
  label: EtaLabelParts
  urgency: EtaUrgency
  stale: boolean
}) {
  const tone = TONE[urgency] ?? TONE.none
  return (
    <span className={`flex shrink-0 items-baseline ${stale ? 'opacity-45' : ''}`}>
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
