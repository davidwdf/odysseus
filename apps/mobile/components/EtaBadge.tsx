import type { EtaLabelParts, EtaUrgency } from '@nextbus/core'
import { View } from 'react-native'
import { Text } from './Text'

/**
 * Tone by urgency — **the client half of the line, and it belongs here** (ADR-053, applied on this
 * side of the network for once). The kernel says an arrival is `soon`; this says `soon` is
 * `text-warning`. A served `etaColor: "#f59e0b"` would look like the same information and would be
 * wrong: it renders outside iOS's colour system, so it ignores Dark Mode and Increase Contrast.
 *
 * **What used to live here was the threshold, not the tone, and it had already drifted.** This
 * component decided imminence with a literal `parts.value <= 5` — 360 s, since `value` is floored
 * minutes — while the served `warnUnderSec` was 180 and its own comment in `core/policy.ts` read
 * *"Nothing reads this yet"*. Both were true, which is how one judgement came to be written down
 * twice. In a live sample of 40 rows, 7 were coloured imminent against the policy. `etaUrgency` owns
 * the thresholds now and this owns the colours, so neither can drift from the other: neither holds
 * the other's information.
 */
const TONE: Record<EtaUrgency, string> = {
  due: 'text-positive',
  soon: 'text-warning',
  normal: 'text-text',
  none: 'text-muted',
}

/**
 * Honest ETA readout (docs/09 §6, ADR-008): tabular figures, urgency colour, stale dimming.
 * No client-side countdown — the value only changes when fresh data arrives. The minutes
 * number is prominent with a small, muted, **pinned** unit so only the number shifts as the
 * value changes (less width-jump); under a minute it collapses to a short "Due" status.
 * (A number-flip / split-flap animation hooks in here later.)
 *
 * Takes an already-derived label, urgency and staleness rather than an `Eta` and a clock. All three are
 * corpus-pinned kernel rules (`etaLabelParts`, `etaUrgency`, `isStale`), and a component that derives
 * them itself is a component a second renderer has to *read* rather than call.
 */
export function EtaBadge({
  label,
  urgency,
  stale,
}: {
  label: EtaLabelParts
  urgency: EtaUrgency
  /** The reading is old enough to say so. Dimming is this component's choice; the judgement is not. */
  stale: boolean
}) {
  // `?? TONE.none` because `EtaUrgency` may grow: this file is compiled against one version of the
  // kernel and a table lookup that returned `undefined` would render an unstyled figure.
  const tone = TONE[urgency] ?? TONE.none
  return (
    <View className={`flex-row items-baseline ${stale ? 'opacity-45' : ''}`}>
      {label.kind === 'mins' ? (
        <>
          <Text variant="h2" tabular className={tone}>
            {label.value}
          </Text>
          <Text variant="caption" className="ml-0.5 text-muted">
            {label.unit}
          </Text>
        </>
      ) : (
        <Text variant="h2" tabular className={tone}>
          {label.kind === 'due' ? label.label : '—'}
        </Text>
      )}
    </View>
  )
}
