import { t } from '@nextbus/i18n'
import { ELEVATION, FONT_FAMILY } from '@nextbus/ui'
import { Tabs } from 'expo-router'
import { type LucideIcon, MapPin, Route, Settings, Star } from 'lucide-react-native'
import { type ColorValue, Platform, StyleSheet } from 'react-native'
import { GlassView } from '../../components/GlassView'
import { Icon } from '../../components/Icon'
import { TAB_BAR_RADIUS, useTabBarLayout } from '../../lib/tabBarLayout'
import { useTheme } from '../../lib/useTheme'
import { useLocale } from '../../providers/LocaleProvider'

// The tab bar can't use Tailwind classes (React Navigation takes colour values),
// so it reads resolved semantic tokens via useTheme — keeping it on-system.
// Navigation hands tabBarIcon the active/inactive tint, so the Lucide glyph takes
// that colour directly (the sanctioned explicit-colour case on <Icon>).
const tabIcon =
  (glyph: LucideIcon) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <Icon icon={glyph} color={color as string} size={size} />
  )

export default function TabsLayout() {
  const locale = useLocale()
  const { color, isDark } = useTheme()
  // Floating glass pill: position:absolute lifts it off the bottom edge with side +
  // bottom margins (safe-area inset via the layout hook), and a liquid-glass material
  // (GlassView, below) lets the content scrolling underneath show through, blurred
  // (docs/09 §1). The bar surface is transparent — the glass *is* the surface; a full
  // hairline border defines it (esp. on dark, where shadows read poorly — §4); on light
  // it also gets the e3 shadow to float.
  const layout = useTabBarLayout()
  const shadow = isDark ? null : Platform.OS === 'android' ? ELEVATION.e3.android : ELEVATION.e3.ios
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color('--accent'),
        // Inactive icons/labels sit on translucent glass — `subtle` was too low-contrast
        // to read, so use the brighter `muted` for legibility (active stays the accent).
        tabBarInactiveTintColor: color('--text-muted'),
        // The glass pane provides the rounded, blurred, bordered surface.
        tabBarBackground: () => (
          <GlassView
            radius={TAB_BAR_RADIUS}
            tintClassName="bg-surface/60"
            blur={5}
            strength={45}
            depth={8}
            style={StyleSheet.absoluteFill}
          />
        ),
        tabBarStyle: {
          position: 'absolute',
          left: layout.side,
          right: layout.side,
          bottom: layout.bottom,
          height: layout.height,
          borderRadius: TAB_BAR_RADIUS,
          // React Navigation's BottomTabBar always paints a default `borderTopWidth`
          // hairline in the *light* nav theme's border colour (Expo Router's Stack sets
          // no dark nav theme), which reads as a harsh light line along the top in dark
          // mode. `borderWidth` doesn't override the per-side `borderTopWidth`, so zero it
          // explicitly — the GlassView pane already supplies the hairline rim/border.
          borderWidth: 0,
          borderTopWidth: 0,
          backgroundColor: 'transparent',
          ...shadow,
        },
        // Always stack the glyph above its label. React Navigation otherwise switches to
        // a beside-icon layout at wide widths (e.g. the PWA on a desktop viewport), which
        // breaks the mobile-first floating-pill look — pin it to below-icon everywhere so
        // the bar reads the same as on a phone (and as the workbench shows it).
        tabBarLabelPosition: 'below-icon',
        // The bar is taller than the icon+label stack; the item defaults to
        // justify-content:flex-start, so without this the content hugs the top
        // (top-heavy). Centre the stack vertically within each tab.
        tabBarItemStyle: { justifyContent: 'center' },
        tabBarLabelStyle: { fontFamily: FONT_FAMILY.medium, fontSize: 12, lineHeight: 16 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t(locale, 'tabNearby'), tabBarIcon: tabIcon(MapPin) }}
      />
      <Tabs.Screen
        name="routes"
        options={{ title: t(locale, 'tabRoutes'), tabBarIcon: tabIcon(Route) }}
      />
      <Tabs.Screen
        name="favorites"
        options={{ title: t(locale, 'tabFavorites'), tabBarIcon: tabIcon(Star) }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: t(locale, 'tabSettings'), tabBarIcon: tabIcon(Settings) }}
      />
    </Tabs>
  )
}
