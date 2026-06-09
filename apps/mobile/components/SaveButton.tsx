import { t } from '@nextbus/i18n'
import { Star } from 'lucide-react-native'
import { Pressable } from 'react-native'
import { usePreferences } from '../lib/preferences'
import { useTheme } from '../lib/useTheme'
import { useLocale } from '../providers/LocaleProvider'
import { Icon } from './Icon'

/** Favourite toggle for a canonical stop id. A Lucide star that fills with the
 *  accent when saved (docs/09 §8). Round 44px target; labelled for screen readers. */
export function SaveButton({ stopId }: { stopId: string }) {
  const locale = useLocale()
  const { color } = useTheme()
  const saved = usePreferences((s) => s.favorites.includes(stopId))
  const toggle = usePreferences((s) => s.toggleFavorite)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(locale, saved ? 'saved' : 'save')}
      accessibilityState={{ selected: saved }}
      hitSlop={8}
      onPress={() => toggle(stopId)}
      className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
    >
      <Icon
        icon={Star}
        tone={saved ? 'accent' : 'muted'}
        fill={saved ? color('--accent') : 'transparent'}
      />
    </Pressable>
  )
}
