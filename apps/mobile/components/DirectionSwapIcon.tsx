import { GitCompareArrows } from 'lucide-react-native'
import { useEffect, useRef } from 'react'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../lib/useTheme'

/**
 * The direction-reverse glyph (ADR-046): Lucide's `git-compare-arrows` — two nodes with arrows
 * flowing between them, which reads as "toggle between the two directions". Each `nonce` bump
 * turns it a half-turn: the two end dots visibly orbit corner-to-corner and swap, so the reversal
 * is legible (a plain `⇄` is point-symmetric with nothing to track, so its spin looks like a
 * wobble). Eases out so it leaps on tap; honours reduced motion (snaps instead of animating).
 */
export function DirectionSwapIcon({
  nonce,
  size = 18,
  colorToken = '--text',
}: {
  /** Advances on each flip → plays a half-turn. */
  nonce: number
  size?: number
  colorToken?: `--${string}`
}) {
  const { color } = useTheme()
  const reduceMotion = useReducedMotion()
  const spin = useSharedValue(0)
  const last = useRef(nonce)

  // biome-ignore lint/correctness/useExhaustiveDependencies: turn only when the flip nonce advances
  useEffect(() => {
    if (nonce === last.current) return
    last.current = nonce
    spin.value = reduceMotion
      ? spin.value - 180
      : withTiming(spin.value - 180, { duration: 460, easing: Easing.out(Easing.cubic) })
  }, [nonce])

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }))

  return (
    <Animated.View style={style}>
      <GitCompareArrows size={size} color={color(colorToken)} strokeWidth={2} />
    </Animated.View>
  )
}
