import type { OperatorId } from '@nextbus/core'
import { FONT_FAMILY } from '@nextbus/ui'
import { ArrowLeft } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, Text, useWindowDimensions, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../lib/useTheme'
import { GlassView } from './GlassView'
import { Icon } from './Icon'
import { RouteChip } from './RouteChip'

const CORNER = 16 // even top/left inset for the back button
const BACK = 44
const PAD = 16
const COL_H = 76 // collapsed bar height (CORNER + BACK + CORNER) — back sits evenly in the corner
const EXP_H = 150 // expanded header height (excl. status-bar inset)
const BADGE_EXP_SCALE = 1.5
const GAP_COL = 6 // badge → route gap, collapsed
const GAP_EXP = 28 // badge → route gap, expanded (more breathing room at the top)

/** Scroll distance over which the header collapses. */
export const COLLAPSE = 96

/** Header height including the status-bar inset — expanded (at rest) and collapsed. */
export const expandedHeaderH = (insetTop: number) => insetTop + EXP_H
export const collapsedHeaderH = (insetTop: number) => insetTop + COL_H

/**
 * Collapsing route header (ADR-030/027/028). The badge sits **centred** with the `A → B`
 * line centred beneath it; on scroll the badge **shrinks in place** (stays centred) and the
 * gap tightens — the whole stack stays a centred column, it just gets smaller. The back
 * lens is pinned evenly in the top-left corner. `A → B` marquees if it overflows (and on tap).
 */
export function RouteHeader({
  operator,
  routeNo,
  routeLabel,
  scrollY,
  insetTop,
  onBack,
}: {
  operator: OperatorId
  routeNo: string
  routeLabel: string
  scrollY: SharedValue<number>
  insetTop: number
  onBack: () => void
}) {
  const { width: screenW } = useWindowDimensions()

  const headerStyle = useAnimatedStyle(() => ({
    height:
      insetTop + interpolate(scrollY.value, [0, COLLAPSE], [EXP_H, COL_H], Extrapolation.CLAMP),
  }))
  const badgeStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(scrollY.value, [0, COLLAPSE], [BADGE_EXP_SCALE, 1], Extrapolation.CLAMP),
      },
    ],
  }))
  const gapStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, COLLAPSE], [GAP_EXP, GAP_COL], Extrapolation.CLAMP),
  }))
  const routeStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(scrollY.value, [0, COLLAPSE], [1.08, 1], Extrapolation.CLAMP) },
    ],
  }))

  // The route line keeps clear of the corner back button on both sides so it stays centred.
  const routeWidth = Math.max(0, screenW - 2 * (CORNER + BACK + PAD))

  return (
    <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0 }, headerStyle]}>
      <GlassView
        tintClassName="bg-bg/80"
        bordered={false}
        className="flex-1"
        style={{ paddingTop: insetTop }}
      >
        {/* Back lens — evenly pinned in the top-left corner */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={8}
          style={{ position: 'absolute', left: CORNER, top: insetTop + CORNER, zIndex: 2 }}
        >
          <GlassView
            lens
            radius={BACK / 2}
            tintClassName="bg-surface/40"
            className="items-center justify-center active:opacity-70"
            style={{ width: BACK, height: BACK }}
          >
            <Icon icon={ArrowLeft} tone="text" size={22} />
          </GlassView>
        </Pressable>

        {/* Centred badge-over-route stack */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={badgeStyle}>
            <RouteChip operator={operator} routeNo={routeNo} />
          </Animated.View>
          <Animated.View style={gapStyle} />
          <Animated.View style={routeStyle}>
            <Marquee width={routeWidth} text={routeLabel} />
          </Animated.View>
        </View>
      </GlassView>
    </Animated.View>
  )
}

/** Centred one-line label that marquees back and forth when it overflows `width` (pausing
 *  at each end, and on tap). Centred and static when it fits. */
function Marquee({ width, text }: { width: number; text: string }) {
  const { color } = useTheme()
  const [textW, setTextW] = useState(0)
  const x = useSharedValue(0)
  const overflow = Math.max(0, textW - width)

  const play = useCallback(() => {
    cancelAnimation(x)
    x.value = 0
    if (overflow <= 1) return
    const dur = Math.max(1400, overflow * 24)
    const ease = Easing.inOut(Easing.ease)
    x.value = withRepeat(
      withSequence(
        withDelay(2000, withTiming(-overflow, { duration: dur, easing: ease })),
        withDelay(2000, withTiming(0, { duration: dur, easing: ease })),
      ),
      -1,
      false,
    )
  }, [overflow, x])

  useEffect(() => {
    play()
    return () => cancelAnimation(x)
  }, [play, x])

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  // Centre the label when it fits; pin left and marquee when it overflows.
  const centerOffset = overflow > 0 ? 0 : Math.max(0, (width - textW) / 2)

  return (
    <Pressable onPress={play} style={{ width, overflow: 'hidden' }}>
      {/* The row is given far more width than any label so the text never wraps and is
          never ellipsised; the clip above shows a window onto it and we scroll it. */}
      <Animated.View style={[{ flexDirection: 'row', width: 1200, marginLeft: centerOffset }, style]}>
        <Text
          onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
          numberOfLines={1}
          style={{ fontFamily: FONT_FAMILY.regular, fontSize: 14, color: color('--text-muted') }}
        >
          {text}
        </Text>
      </Animated.View>
    </Pressable>
  )
}
