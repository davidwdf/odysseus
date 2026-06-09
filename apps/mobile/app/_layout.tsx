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
import { usePreferences } from '../lib/preferences'
import { useTheme } from '../lib/useTheme'
import { LocaleProvider } from '../providers/LocaleProvider'
import { QueryProvider } from '../providers/QueryProvider'

// Hold the splash until Inter is loaded so the first paint is in-brand, not a
// system-font flash (docs/09 §3).
void SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  // The theme is just a set of semantic-token values injected as CSS vars; every
  // component reads them through NativeWind classes (bg-bg, text-text…). See docs/09.
  const { vars: themeVars, isDark, color } = useTheme()
  const prefsHydrated = usePreferences((s) => s.hydrated)
  const bgColor = color('--bg')

  // Inter is loaded as discrete weight cuts; the <Text> primitive maps each weight
  // to its exact registered family (CJK glyphs fall back to the OS face).
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  })

  // Hold the splash until both fonts AND the persisted theme are ready, so the
  // first paint is in-brand and on the user's chosen livery (no theme flash).
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
            <View style={[{ flex: 1 }, vars(themeVars)]}>
              <StatusBar style={isDark ? 'light' : 'dark'} />
              <Stack screenOptions={{ headerShown: false }} />
            </View>
          </LocaleProvider>
        </QueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
