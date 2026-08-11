import '../global.css'

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { vars } from 'nativewind'
import { useEffect } from 'react'
import { Platform, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { WebSwipeBack } from '../components/WebSwipeBack'
import { useRootStackScreenOptions } from '../lib/navTransitions'
import { usePreferences } from '../lib/preferences'
import { registerServiceWorker } from '../lib/serviceWorker'
import { useTheme } from '../lib/useTheme'
import { LocaleProvider, useLocale } from '../providers/LocaleProvider'
import { QueryProvider } from '../providers/QueryProvider'

// Hold the splash until Inter is loaded so the first paint is in-brand, not a
// system-font flash (docs/09 §3).
void SplashScreen.preventAutoHideAsync()

// PWA offline support (WP0-3). At module scope, not in an effect: this must run once per
// document, not once per mount, and it no-ops off a production web build.
registerServiceWorker()

export default function RootLayout() {
  // The theme is just a set of semantic-token values injected as CSS vars; every
  // component reads them through NativeWind classes (bg-bg, text-text…). See docs/09.
  const { vars: themeVars, isDark, color } = useTheme()
  const prefsHydrated = usePreferences((s) => s.hydrated)
  const bgColor = color('--bg')
  // The single set of root-stack transition rules (slide in / reveal on back), reduced-motion
  // aware — see lib/navTransitions / ADR-043. Animates on native; an instant cut on web.
  const stackScreenOptions = useRootStackScreenOptions()

  // Inter is loaded as discrete weight cuts; the <Text> primitive maps each weight
  // to its exact registered family (CJK glyphs fall back to the OS face).
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  })

  // Hold the splash until both fonts AND the persisted theme are ready, so the
  // first paint is in-brand and on the user's chosen appearance (no theme flash).
  const ready = fontsLoaded && prefsHydrated

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync()
  }, [ready])

  // The themed background lives on a RN <View>; the web document's html/body stay
  // their default white, so overscroll rubber-band reveals white in dark mode. Paint
  // html/body with the active theme bg (NativeWind vars() only reach the View subtree).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    document.documentElement.style.backgroundColor = bgColor
    document.body.style.backgroundColor = bgColor
  }, [bgColor])

  if (!ready) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryProvider>
          <LocaleProvider>
            <DocumentLanguage />
            <View style={[{ flex: 1 }, vars(themeVars)]}>
              <StatusBar style={isDark ? 'light' : 'dark'} />
              <Stack screenOptions={stackScreenOptions} />
              <WebSwipeBack />
            </View>
          </LocaleProvider>
        </QueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

/**
 * `<html lang>` follows the active locale — the web build only, and nothing at all on native.
 *
 * The PWA shipped with `lang="en"`: expo's web template writes the attribute once, at export, from
 * `app.json`'s `langIsoCode` — a build-time constant in a document that is then never told the rider
 * changed language. That mis-announces every Chinese word on the page to a screen reader (a synthesizer
 * picks its voice and its pronunciation from this attribute) and takes the browser's own CJK font
 * selection and line-breaking with it. `apps/web` carries the same fix in its `LocaleProvider`; both
 * renderers were wrong in the same way, which is why `docs/07` filed it against both.
 *
 * **No mapping table, deliberately.** `Locale` is `'en' | 'zh-Hant' | 'zh-Hans'` — the contract's
 * `LocaleSchema`, and already the BCP-47 tags a browser wants — so the value passes straight through. A
 * second table would be a second thing to keep in step.
 *
 * It is a component rather than an effect in `RootLayout` because the locale is only readable *inside*
 * `LocaleProvider`, and it renders nothing: it is one attribute on a node no React tree owns, the same
 * shape as the html/body background above.
 */
function DocumentLanguage() {
  const locale = useLocale()
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    document.documentElement.lang = locale
  }, [locale])
  return null
}
