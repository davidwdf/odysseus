import { t } from '@nextbus/i18n'
import { Pressable } from 'react-native'
import { usePreferences } from '../lib/preferences'
import { useLocale } from '../providers/LocaleProvider'
import { Text } from './Text'

/** Favorite toggle for a canonical stop id. Text pill (no icon) until the Lucide
 *  pass lands; `saved` fills with the accent. Accessible via role + selected state. */
export function SaveButton({ stopId }: { stopId: string }) {
  const locale = useLocale()
  const saved = usePreferences((s) => s.favorites.includes(stopId))
  const toggle = usePreferences((s) => s.toggleFavorite)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: saved }}
      onPress={() => toggle(stopId)}
      className={`min-h-[36px] justify-center rounded-full border px-3 active:opacity-70 ${
        saved ? 'border-accent bg-accent' : 'border-border'
      }`}
    >
      <Text
        variant="label"
        weight="semibold"
        className={saved ? 'text-accent-contrast' : 'text-muted'}
      >
        {t(locale, saved ? 'saved' : 'save')}
      </Text>
    </Pressable>
  )
}
