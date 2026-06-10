import { MapPin } from 'lucide-react-native'
import { View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import { CollapsingHeader } from './CollapsingHeader'
import { Icon } from './Icon'

/**
 * The stop-detail header: a `CollapsingHeader` whose morphing **badge** is a pin glyph and
 * whose marquee **label** is the stop name. Same motion + glass as the route header (ADR-033),
 * so Stop and Route detail read as one family — at the top the name sits big and centred over
 * the pin; on scroll it morphs into the glass pill beside the back lens.
 */
export function StopHeader({
  stopName,
  scrollY,
  insetTop,
  onBack,
  onTitlePress,
  backLabel,
}: {
  /** The clean, title-cased stop name (no operator code). */
  stopName: string
  scrollY: SharedValue<number>
  insetTop: number
  onBack: () => void
  onTitlePress?: () => void
  backLabel?: string
}) {
  return (
    <CollapsingHeader
      badge={
        <View className="h-7 w-7 items-center justify-center rounded-full bg-surface-2">
          <Icon icon={MapPin} tone="accent" size={16} />
        </View>
      }
      label={stopName}
      labelColor="--text"
      expLabelSize={20}
      colLabelSize={15}
      scrollY={scrollY}
      insetTop={insetTop}
      onBack={onBack}
      onTitlePress={onTitlePress}
      backAccessibilityLabel={backLabel}
    />
  )
}
