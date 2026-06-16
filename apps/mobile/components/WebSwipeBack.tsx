import { router } from 'expo-router'
import { useMemo } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'

// A rightward drag that starts within this strip of the left edge counts as a back-swipe…
const EDGE_WIDTH = 24
// …and pops once it's travelled this far (or is flung fast enough).
const TRIGGER_DX = 64
const TRIGGER_VX = 600

/**
 * Web-only left-edge swipe-back (ADR-043). The native stack has its own edge-swipe on iOS, but on
 * the web PWA there's no swipe-back — so we recognise a rightward drag from the left edge and call
 * `router.back()`. (On web the back itself is an instant cut; native gets the slide-off reveal.) A
 * thin edge strip keeps the gesture off the rest of the screen; `failOffsetY` yields to vertical
 * scrolling and the pop is a no-op when there's nothing to go back to (e.g. a root tab).
 *
 * Mounted once at the root over the navigator, so the rule lives in one place — never per page.
 */
export function WebSwipeBack() {
  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Run the callback on the JS thread so we can call the router directly (no worklet hop).
        .runOnJS(true)
        // Only claim the gesture once it's clearly a rightward drag; bail to scrolling on vertical.
        .activeOffsetX(12)
        .failOffsetY([-16, 16])
        .onEnd((e) => {
          if ((e.translationX > TRIGGER_DX || e.velocityX > TRIGGER_VX) && router.canGoBack()) {
            router.back()
          }
        }),
    [],
  )

  // Native already has a working swipe; this layer is the PWA's stand-in only.
  if (Platform.OS !== 'web') return null

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.edge} pointerEvents="box-only" />
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: EDGE_WIDTH, zIndex: 50 },
})
