import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../lib/useTheme'
import { BusGlyph } from './BusGlyph'

// Decorative idle motion (tweak to taste). The disc stays put; only the glyph moves.
// Two independent eased oscillations — like a pair of CSS keyframe animations — bound
// straight to the transform. The easing curve does all the shaping; there is no JS clock.
const BOB_PX = 1.0 // vertical bounce amplitude
const TILT_DEG = 6 // side-to-side lean amplitude
const BOB_MS = 700 // one leg of the bounce (up, or down)
const ROCK_MS = 2800 // one leg of the lean (to a side) — ~4× slower, so it sways gently

// ease-in-out sine: velocity eases to zero at each turning point — the natural, un-mechanical
// feel of something rocking on a spring.
const EASE = Easing.inOut(Easing.sin)

/**
 * The bus marker that rides the schematic rail. The accent disc is *stationary*; only the
 * double-decker glyph inside it animates. It bobs up and down (BOB_MS) while a much slower
 * lean (ROCK_MS) sways it side to side; because the lean is ~4× slower, it bounces a couple
 * of times near one side, glides through the middle, then bounces near the other side. Both
 * are plain reanimated timings with an ease-in-out curve and `reverse` — declarative, native
 * driven, no per-frame JS. Purely decorative idle motion: it conveys *motion*, never an ETA
 * value, so it doesn't touch the ADR-008 honesty rule. Position along the rail is animated by
 * the parent on real data change.
 */
export function BusToken({ size = 26 }: { size?: number }) {
  const { color } = useTheme()
  const bob = useSharedValue(0) // 0..1, reverses
  const rock = useSharedValue(0) // 0..1, reverses

  useEffect(() => {
    bob.value = withRepeat(withTiming(1, { duration: BOB_MS, easing: EASE }), -1, true)
    rock.value = withRepeat(withTiming(1, { duration: ROCK_MS, easing: EASE }), -1, true)
  }, [bob, rock])

  // Inline styles (not NativeWind className) — className is unreliable on Animated.View.
  // Map each 0..1 oscillation to a symmetric range about centre; this is a plain binding,
  // not a computation loop.
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: BOB_PX * (bob.value * 2 - 1) },
      { rotateZ: `${TILT_DEG * (rock.value * 2 - 1)}deg` },
    ],
  }))

  // Disc is a plain (static) View; the animated glyph rides inside it.
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color('--accent'),
      }}
    >
      <Animated.View style={style}>
        <BusGlyph size={size * 0.66} color={color('--accent-contrast')} />
      </Animated.View>
    </View>
  )
}
