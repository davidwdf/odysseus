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
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { TAB_BAR_HEIGHT } from '../lib/tabBarLayout'
import { useTheme } from '../lib/useTheme'
import { GlassView } from './GlassView'
import { Icon } from './Icon'
import { RouteChip } from './RouteChip'

const CORNER = 16 // even top/left inset for the back button
const BACK = TAB_BAR_HEIGHT // back-lens diameter — matches the floating tab bar's height
const PAD = 16

// Collapsed pill: shares the back button's row (same top + height) and sits to its right.
const PILL_H = BACK
const PILL_LEFT = CORNER + BACK + 10 // back lens + gap
const PILL_PAD = 10 // inner horizontal padding
const INLINE_GAP = 8 // badge → route gap inside the pill
const ROW_CY = CORNER + PILL_H / 2 // vertical centre of the back-button / pill row

// Expanded title: a big centred badge with the route line centred beneath it.
const BADGE_EXP_SCALE = 1.45
const BADGE_CY_EXP = 42 // expanded badge centre (below the status-bar inset)
const ROUTE_EXP_TOP = 72 // expanded route-line top
const BADGE_FALLBACK = { w: 48, h: 26 } // until the chip is measured

const COL_H = CORNER + BACK + CORNER // collapsed chrome height
const EXP_H = 132 // expanded header height (excl. status-bar inset)

/** Scroll distance over which the header collapses. */
export const COLLAPSE = 96
/** Scroll offset at which the collapsed pill is mounted and starts fading in. */
const PILL_APPEAR = COLLAPSE * 0.3

/** Header height including the status-bar inset — expanded (at rest) and collapsed. */
export const expandedHeaderH = (insetTop: number) => insetTop + EXP_H
export const collapsedHeaderH = (insetTop: number) => insetTop + COL_H

/**
 * Collapsing route header (ADR-033, refining ADR-030's header). **No bar background** — the chrome
 * floats over the scrolling content. At the top, a big **centred badge** sits over a full-width
 * `A → B` line. On scroll the badge **morphs left** (translate + scale) into a glass **pill that
 * sits to the right of the back lens**, while the route label cross-fades from centred-below into
 * inline-in-the-pill and the pill's glass fades in. `A → B` does a one-shot marquee (auto on first
 * appear, and on tap) if it overflows.
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
  const [badge, setBadge] = useState(BADGE_FALLBACK)

  // Badge anchor points (centre x/y) for the two ends of the collapse.
  const cxExp = screenW / 2
  const cyExp = insetTop + BADGE_CY_EXP
  const cxCol = PILL_LEFT + PILL_PAD + badge.w / 2
  const cyCol = insetTop + ROW_CY

  // The badge is one element that travels + shrinks; scaling is centre-anchored, so translating its
  // centre to the target keeps it put. Always opaque — it bridges the two label states visually.
  const badgeStyle = useAnimatedStyle(() => {
    const s = interpolate(scrollY.value, [0, COLLAPSE], [BADGE_EXP_SCALE, 1], Extrapolation.CLAMP)
    const cx = interpolate(scrollY.value, [0, COLLAPSE], [cxExp, cxCol], Extrapolation.CLAMP)
    const cy = interpolate(scrollY.value, [0, COLLAPSE], [cyExp, cyCol], Extrapolation.CLAMP)
    return {
      transform: [{ translateX: cx - badge.w / 2 }, { translateY: cy - badge.h / 2 }, { scale: s }],
    }
  })

  // Pill glass + the inline (collapsed) route fade in late; the expanded route fades out early — so
  // the two labels never overlap, and the morphing badge carries the motion across the gap.
  const pillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [PILL_APPEAR, COLLAPSE * 0.85],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }))

  // Mount the pill **fresh** each time the header collapses, rather than keeping one element and
  // fading its opacity through 0 ↔ 1: Chromium drops a backdrop-filter's compositing once its
  // element's opacity hits 0 and returns (the blur turns transparent after a scroll-to-top-and-back),
  // but a first appearance always composites. So we unmount it near the top and re-mount on collapse.
  const [pillMounted, setPillMounted] = useState(false)
  useAnimatedReaction(
    () => scrollY.value > PILL_APPEAR,
    (on, prev) => {
      if (on !== prev) runOnJS(setPillMounted)(on)
    },
  )
  const expRouteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, COLLAPSE * 0.4], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [0, COLLAPSE * 0.4], [0, -6], Extrapolation.CLAMP) },
    ],
  }))
  const colRouteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [COLLAPSE * 0.5, COLLAPSE], [0, 1], Extrapolation.CLAMP),
  }))

  const pillW = Math.max(0, screenW - PILL_LEFT - CORNER)
  const colRouteLeft = cxCol + badge.w / 2 + INLINE_GAP
  const colRouteW = Math.max(0, screenW - CORNER - PILL_PAD - colRouteLeft)
  const expRouteW = Math.max(0, screenW - 2 * (CORNER + PAD))

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, top: 0, height: insetTop + EXP_H }}
    >
      {/* Glass pill — fades in to the right of the back lens, sharing its row. Mounted only while
          collapsed (see pillMounted) so it's a fresh backdrop-filter element each time; the fade
          opacity rides on the GlassView root itself, never a wrapper (an opacity-<1 ancestor would
          isolate the backdrop-filter and drop the blur mid-scroll). */}
      {pillMounted ? (
        <GlassView
          pointerEvents="none"
          elevated
          radius={PILL_H / 2}
          tintClassName="bg-surface/60"
          strength={45}
          depth={8}
          blur={5}
          style={[
            {
              position: 'absolute',
              left: PILL_LEFT,
              top: insetTop + CORNER,
              zIndex: 1,
              width: pillW,
              height: PILL_H,
            },
            pillStyle,
          ]}
        />
      ) : null}

      {/* Expanded route line — centred beneath the big badge, fades out first */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: insetTop + ROUTE_EXP_TOP,
            alignItems: 'center',
            zIndex: 2,
          },
          expRouteStyle,
        ]}
      >
        <Marquee width={expRouteW} text={routeLabel} size={15} />
      </Animated.View>

      {/* Collapsed route line — inline inside the pill, fades in last */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            left: colRouteLeft,
            top: insetTop + CORNER,
            height: PILL_H,
            justifyContent: 'center',
            zIndex: 2,
          },
          colRouteStyle,
        ]}
      >
        <Marquee width={colRouteW} text={routeLabel} size={13} />
      </Animated.View>

      {/* The badge — a single element morphing from big-centre to small-in-pill */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left: 0, top: 0, zIndex: 3 }, badgeStyle]}
      >
        <View
          onLayout={(e) =>
            setBadge({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
          }
        >
          <RouteChip operator={operator} routeNo={routeNo} />
        </View>
      </Animated.View>

      {/* Back lens — evenly pinned in the top-left corner, above the pill */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        hitSlop={8}
        style={{ position: 'absolute', left: CORNER, top: insetTop + CORNER, zIndex: 4 }}
      >
        <GlassView
          elevated
          radius={BACK / 2}
          tintClassName="bg-surface/60"
          strength={45}
          depth={8}
          blur={5}
          className="items-center justify-center active:opacity-70"
          style={{ width: BACK, height: BACK }}
        >
          <Icon icon={ArrowLeft} tone="text" size={24} />
        </GlassView>
      </Pressable>
    </View>
  )
}

/** Centred one-line label that, when it overflows `width`, does a **single** marquee round-trip
 *  (auto-played once on mount, and again on tap) then rests at the start. Centred + static when it fits. */
function Marquee({ width, text, size = 14 }: { width: number; text: string; size?: number }) {
  const { color } = useTheme()
  const [textW, setTextW] = useState(0)
  const x = useSharedValue(0)
  const overflow = Math.max(0, textW - width)

  // One round-trip: a short beat, scroll to reveal the end, hold there, then return to the start
  // and **stop** — it rests at the start until tapped again (no continuous loop).
  const play = useCallback(() => {
    cancelAnimation(x)
    x.value = 0
    if (overflow <= 1) return
    const dur = Math.max(1400, overflow * 24)
    const ease = Easing.inOut(Easing.ease)
    x.value = withSequence(
      withDelay(900, withTiming(-overflow, { duration: dur, easing: ease })),
      withDelay(1400, withTiming(0, { duration: dur, easing: ease })),
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
      <Animated.View
        style={[{ flexDirection: 'row', width: 1200, marginLeft: centerOffset }, style]}
      >
        <Text
          onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
          numberOfLines={1}
          style={{ fontFamily: FONT_FAMILY.regular, fontSize: size, color: color('--text-muted') }}
        >
          {text}
        </Text>
      </Animated.View>
    </Pressable>
  )
}
