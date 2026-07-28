import type { LocalizedString } from '@nextbus/i18n'
import { ArrowLeft, type LucideIcon } from 'lucide-react-native'
import { Pressable, type StyleProp, type ViewStyle } from 'react-native'
import { GlassView } from './GlassView'
import type { IconTone } from './Icon'
import { Icon } from './Icon'

/** Default lens diameter — the floating chrome standard (matches the route header's back lens). */
export const GLASS_BUTTON_SIZE = 48

/**
 * A circular liquid-glass icon button — the app's standard floating-chrome control
 * (the route-header back lens, the search launcher, the search page's back button).
 * Glass material + accent icon, so it reads on any scrolling content beneath it.
 */
export function GlassIconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = GLASS_BUTTON_SIZE,
  tone = 'accent',
  iconSize = 24,
  style,
}: {
  icon: LucideIcon
  onPress: () => void
  accessibilityLabel: LocalizedString
  size?: number
  tone?: IconTone
  iconSize?: number
  style?: StyleProp<ViewStyle>
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={8}
      style={style}
    >
      <GlassView
        elevated
        radius={size / 2}
        tintClassName="bg-surface/60"
        strength={45}
        depth={8}
        blur={5}
        className="items-center justify-center active:opacity-70"
        style={{ width: size, height: size }}
      >
        {/* `accent` matches the tab bar's active tint (white in dark, dark in light). */}
        <Icon icon={icon} tone={tone} size={iconSize} />
      </GlassView>
    </Pressable>
  )
}

/**
 * The standard back button: a glass lens with a left arrow.
 *
 * `accessibilityLabel` is **required**. It used to default to the literal `'Back'`, so every caller
 * that omitted it shipped English to a screen reader in a Chinese UI — and the default is precisely
 * what made the omission legal and therefore invisible. Callers pass `t(locale, 'back')`.
 */
export function BackButton({
  onPress,
  accessibilityLabel,
  size,
  style,
}: {
  onPress: () => void
  accessibilityLabel: LocalizedString
  size?: number
  style?: StyleProp<ViewStyle>
}) {
  return (
    <GlassIconButton
      icon={ArrowLeft}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      size={size}
      style={style}
    />
  )
}
