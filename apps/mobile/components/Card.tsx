import { ELEVATION, type ElevationLevel } from '@nextbus/ui'
import { Platform, View, type ViewProps } from 'react-native'
import { useTheme } from '../lib/useTheme'

type CardProps = ViewProps & {
  /** Elevation token (docs/09 §4). Default e1 = resting card. */
  level?: ElevationLevel
  className?: string
}

/**
 * Surface primitive. On light it carries the elevation shadow; on dark it drops
 * the shadow (reads poorly) for a `surface-2` lift + border instead — exactly
 * the rule in docs/09 §4. Components compose this rather than restyling cards.
 */
export function Card({ level = 'e1', className = '', style, children, ...rest }: CardProps) {
  const { isDark } = useTheme()
  const surface = isDark ? 'bg-surface-2 border border-border' : 'bg-surface'
  const shadow = isDark
    ? null
    : Platform.OS === 'android'
      ? ELEVATION[level].android
      : ELEVATION[level].ios
  return (
    <View {...rest} className={`rounded-lg ${surface} ${className}`} style={[shadow, style]}>
      {children}
    </View>
  )
}
