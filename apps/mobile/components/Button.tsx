import { Pressable } from 'react-native'
import { Text } from './Text'

/** Primary button. 44px min touch target; accent fill with contrast text (docs/09). */
export function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-[44px] items-center justify-center rounded-lg bg-accent px-5 active:opacity-80"
    >
      <Text variant="body" weight="semibold" className="text-accent-contrast">
        {label}
      </Text>
    </Pressable>
  )
}
