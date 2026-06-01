import '../global.css'

import { themes } from '@nextbus/ui'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { vars } from 'nativewind'
import { useColorScheme, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { LocaleProvider } from '../providers/LocaleProvider'
import { QueryProvider } from '../providers/QueryProvider'

export default function RootLayout() {
  const scheme = useColorScheme()
  // The theme is just a set of semantic-token values injected as CSS vars; every
  // component reads them through NativeWind classes (bg-bg, text-text…). See docs/09.
  // (Livery selection + manual override lands in the polish slice.)
  const theme = scheme === 'dark' ? themes.dark : themes.light

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryProvider>
          <LocaleProvider>
            <View style={[{ flex: 1 }, vars(theme)]}>
              <StatusBar style="auto" />
              <Stack screenOptions={{ headerShown: false }} />
            </View>
          </LocaleProvider>
        </QueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
