import type { Eta, Locale } from '@nextbus/core'
import { etaView, formatRelative, isStale } from '@nextbus/core'
import { Text, View } from 'react-native'

/**
 * Honest ETA readout (docs/09 §6, ADR-008): tabular figures, urgency colour,
 * stale dimming. No client-side countdown — the value only changes when fresh
 * data arrives. (A number-flip / split-flap animation hooks in here later.)
 */
export function EtaBadge({ eta, locale, now }: { eta: Eta; locale: Locale; now: number }) {
  const next = eta.arrivals[0]
  const stale = isStale(eta, now)
  const view = next ? etaView(next, now) : null
  const urgency = !view
    ? 'text-muted'
    : view.isDue
      ? 'text-danger'
      : view.minutes <= 5
        ? 'text-warning'
        : 'text-text'

  return (
    <View className="items-end">
      <Text
        className={`text-2xl font-bold ${urgency} ${stale ? 'opacity-45' : ''}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {next ? formatRelative(next, now, locale) : '—'}
      </Text>
    </View>
  )
}
