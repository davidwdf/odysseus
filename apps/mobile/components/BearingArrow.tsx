import { ArrowUp } from 'lucide-react-native'
import { View } from 'react-native'
import { Icon, type IconTone } from './Icon'

/**
 * A compass arrow rotated to a place's travel bearing (0° = North = up, increasing
 * clockwise), so it points the physical way buses leave the stop. Pairs with the
 * "Northeast-bound" label to make the direction legible at a glance (ADR-042).
 *
 * The rotation lives on a wrapping `View`, not the SVG itself: an SVG `transform`
 * rotates about the (0,0) origin and spins the glyph out of its own box (clipped /
 * blank), whereas a View rotates about its centre.
 */
export function BearingArrow({
  bearingDeg,
  size = 13,
  tone = 'subtle',
}: {
  bearingDeg: number
  size?: number
  tone?: IconTone
}) {
  return (
    <View style={{ transform: [{ rotate: `${Math.round(bearingDeg)}deg` }] }}>
      <Icon icon={ArrowUp} tone={tone} size={size} />
    </View>
  )
}
