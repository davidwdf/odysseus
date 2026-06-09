import type { LucideIcon } from 'lucide-react-native'
import { Pressable } from 'react-native'
import { useTheme } from '../lib/useTheme'
import { Icon } from './Icon'
import { Text } from './Text'

/** Primary button. 44px min touch target; accent fill with contrast text (docs/09).
 *  Optional leading Lucide icon, tinted to match the contrast text. */
export function Button({
  label,
  onPress,
  icon,
}: {
  label: string
  onPress: () => void
  icon?: LucideIcon
}) {
  const { color } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-[44px] flex-row items-center justify-center gap-2 rounded-lg bg-accent px-5 active:opacity-80"
    >
      {icon ? <Icon icon={icon} color={color('--accent-contrast')} size={18} /> : null}
      <Text variant="body" weight="semibold" className="text-accent-contrast">
        {label}
      </Text>
    </Pressable>
  )
}
