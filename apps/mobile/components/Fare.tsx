import type { StyleProp, TextStyle } from 'react-native'
import { Text } from './Text'

/** A small, muted boarding-fare label, e.g. "$6.7" — the **Static** honesty tier (docs/02,
 *  ADR-036): adult full fare from open data we already fetch, shown plainly, never animated.
 *  `style` lets a caller override layout bits (e.g. line-height to align with a stop name).
 *
 *  Takes the **printed** string rather than the raw decimal since WP6-6a: `$` is a composition, so it is
 *  `formatFare`'s and arrives on `RouteStopRowView.fareLabel`. A component that formatted its own would be
 *  a second answer, and — more to the point — an unprojectable one. */
export function Fare({
  label,
  className,
  style,
}: {
  label: string
  className?: string
  style?: StyleProp<TextStyle>
}) {
  return (
    <Text variant="caption" tabular className={`text-subtle ${className ?? ''}`} style={style}>
      {label}
    </Text>
  )
}
