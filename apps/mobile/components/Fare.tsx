import { formatFare } from '@nextbus/core'
import type { StyleProp, TextStyle } from 'react-native'
import { Text } from './Text'

/** A small, muted boarding-fare label, e.g. "$6.7" — the **Static** honesty tier (docs/02,
 *  ADR-036): adult full fare from open data we already fetch, shown plainly, never animated.
 *  `style` lets a caller override layout bits (e.g. line-height to align with a stop name). */
export function Fare({
  fare,
  className,
  style,
}: {
  fare: string
  className?: string
  style?: StyleProp<TextStyle>
}) {
  return (
    <Text variant="caption" tabular className={`text-subtle ${className ?? ''}`} style={style}>
      {formatFare(fare)}
    </Text>
  )
}
