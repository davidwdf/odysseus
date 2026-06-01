import { type Messages, t } from '@nextbus/i18n'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocale } from '../providers/LocaleProvider'

export function ComingSoon({ titleKey }: { titleKey: keyof Messages }) {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  return (
    <View
      className="flex-1 items-center justify-center bg-bg px-6"
      style={{ paddingTop: insets.top }}
    >
      <Text className="text-xl font-bold text-text">{t(locale, titleKey)}</Text>
      <Text className="mt-2 text-muted">{t(locale, 'comingSoon')}</Text>
    </View>
  )
}
