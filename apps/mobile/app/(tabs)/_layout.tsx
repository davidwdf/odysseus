import { t } from '@nextbus/i18n'
import { Tabs } from 'expo-router'
import { useLocale } from '../../providers/LocaleProvider'

// Tab icons (Lucide) land in the polish slice; labels are localized already.
export default function TabsLayout() {
  const locale = useLocale()
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: t(locale, 'tabNearby') }} />
      <Tabs.Screen name="routes" options={{ title: t(locale, 'tabRoutes') }} />
      <Tabs.Screen name="favorites" options={{ title: t(locale, 'tabFavorites') }} />
      <Tabs.Screen name="settings" options={{ title: t(locale, 'tabSettings') }} />
    </Tabs>
  )
}
