import { t } from '@nextbus/i18n'
import { FONT_FAMILY } from '@nextbus/ui'
import { Tabs } from 'expo-router'
import { useTheme } from '../../lib/useTheme'
import { useLocale } from '../../providers/LocaleProvider'

// The tab bar can't use Tailwind classes (React Navigation takes colour values),
// so it reads resolved semantic tokens via useTheme — keeping it on-system.
// (Lucide tab icons land in the polish slice; labels are localized already.)
export default function TabsLayout() {
  const locale = useLocale()
  const { color } = useTheme()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color('--accent'),
        tabBarInactiveTintColor: color('--text-subtle'),
        tabBarStyle: { backgroundColor: color('--surface'), borderTopColor: color('--border') },
        tabBarLabelStyle: { fontFamily: FONT_FAMILY.medium, fontSize: 12 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t(locale, 'tabNearby') }} />
      <Tabs.Screen name="routes" options={{ title: t(locale, 'tabRoutes') }} />
      <Tabs.Screen name="favorites" options={{ title: t(locale, 'tabFavorites') }} />
      <Tabs.Screen name="settings" options={{ title: t(locale, 'tabSettings') }} />
    </Tabs>
  )
}
