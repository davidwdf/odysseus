import type { Eta, Locale } from '@nextbus/core'
import { etaLabelParts, isStale } from '@nextbus/core'
import { View } from 'react-native'
import { Text } from './Text'

/**
 * Honest ETA readout (docs/09 §6, ADR-008): tabular figures, urgency colour, stale dimming.
 * No client-side countdown — the value only changes when fresh data arrives. The minutes
 * number is prominent with a small, muted, **pinned** unit so only the number shifts as the
 * value changes (less width-jump); under a minute it collapses to a short "Due" status.
 * (A number-flip / split-flap animation hooks in here later.)
 */
export function EtaBadge({ eta, locale, now }: { eta: Eta; locale: Locale; now: number }) {
  const next = eta.arrivals[0]
  const stale = isStale(eta, now)
  const parts = next ? etaLabelParts(next, now, locale) : ({ kind: 'departed' } as const)
  const urgency =
    parts.kind === 'due'
      ? 'text-positive'
      : parts.kind === 'mins'
        ? parts.value <= 5
          ? 'text-warning'
          : 'text-text'
        : 'text-muted'

  return (
    <View className={`flex-row items-baseline ${stale ? 'opacity-45' : ''}`}>
      {parts.kind === 'mins' ? (
        <>
          <Text variant="h2" tabular className={urgency}>
            {parts.value}
          </Text>
          <Text variant="caption" className="ml-0.5 text-muted">
            {parts.unit}
          </Text>
        </>
      ) : (
        <Text variant="h2" tabular className={urgency}>
          {parts.kind === 'due' ? parts.label : '—'}
        </Text>
      )}
    </View>
  )
}
