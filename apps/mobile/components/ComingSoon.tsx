import { type Messages, t } from '@nextbus/i18n'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocale } from '../providers/LocaleProvider'
import { Text } from './Text'

export function ComingSoon({ titleKey }: { titleKey: keyof Messages }) {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  return (
    <View
      className="flex-1 items-center justify-center bg-bg px-6"
      style={{ paddingTop: insets.top }}
    >
      <Text variant="h2" className="text-text">
        {t(locale, titleKey)}
      </Text>
      <Text variant="body" className="mt-2 text-muted">
        {t(locale, 'comingSoon')}
      </Text>
    </View>
  )
}
