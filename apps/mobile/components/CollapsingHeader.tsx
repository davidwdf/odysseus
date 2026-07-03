import { FONT_FAMILY } from '@nextbus/ui'
import { type ReactNode, useEffect, useState } from 'react'
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
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { TAB_BAR_HEIGHT } from '../lib/tabBarLayout'
import { useTheme } from '../lib/useTheme'
import { BackButton } from './GlassIconButton'
import { GlassView } from './GlassView'

const CORNER = 16 // even top/left inset for the back button; also the content margin (list px-4)
const BACK = TAB_BAR_HEIGHT // back-lens diameter — matches the floating tab bar's height

// Collapsed pill: shares the back button's row (same top + height) and sits to its right.
const PILL_H = BACK
const PILL_LEFT = CORNER + BACK + 10 // back lens + gap
const PILL_PAD = 10 // inner horizontal padding
const INLINE_GAP = 8 // badge → label gap inside the pill
const ROW_CY = CORNER + PILL_H / 2 // vertical centre of the back-button / pill row

const COL_H = CORNER + BACK + CORNER // collapsed chrome height
/** Default expanded header height (excl. status-bar inset) — the route screen's value. */
export const DEFAULT_EXP_H = 118
const BADGE_FALLBACK = { w: 48, h: 26 } // until the badge is measured

/** Scroll distance over which the header collapses. */
export const COLLAPSE = 96
/** Scroll offset at which the collapsed pill is mounted and starts fading in. */
const PILL_APPEAR = COLLAPSE * 0.3

/** Header height including the status-bar inset — expanded (at rest) and collapsed. */
export const expandedHeaderH = (insetTop: number, expH: number = DEFAULT_EXP_H) => insetTop + expH
export const collapsedHeaderH = (insetTop: number) => insetTop + COL_H

/**
 * Collapsing floating header (ADR-033, generalising ADR-030's route header). **No bar
 * background** — the chrome floats over the scrolling content. At the top, a **`badge`**
 * (a small identity glyph — a route chip, a stop pin) sits centred over a full-width
 * `label` line. On scroll the badge **morphs left** (translate + scale) into a glass
 * **pill that sits to the right of the back lens**, while the label cross-fades from
 * centred-below into inline-in-the-pill and the pill's glass fades in. The label
 * continuously marquees (with a pause at each end) when it overflows. Tapping the header
 * chrome scrolls the list back to the top.
 *
 * Both the route header and the stop header are thin wrappers over this — same motion,
 * same glass, so the two screens feel like one family.
 */
export function CollapsingHeader({
  badge,
  label,
  collapsedLabel,
  expandedSlot,
  scrollY,
  insetTop,
  onBack,
  onTitlePress,
  backAccessibilityLabel,
  expH = DEFAULT_EXP_H,
  badgeCyExp = 42,
  labelExpTop = 86,
  badgeExpScale = 1.45,
  expLabelSize = 15,
  colLabelSize = 13,
  labelColor = '--text-muted',
}: {
  /** The morphing identity glyph (route chip / stop pin). Measured for the morph maths. */
  badge: ReactNode
  /** The marquee line beneath the badge (route `A → B`, the stop name). */
  label: string
  /** Collapsed-pill marquee text, when it should differ from `label` (e.g. `→ dest` on the
   *  route screen, matching the stop-card form). Defaults to `label`. */
  collapsedLabel?: string
  /** Custom expanded content rendered in place of the centred label marquee (e.g. the route
   *  screen's from/to card, which carries the direction toggle). Fades out on collapse. */
  expandedSlot?: ReactNode
  scrollY: SharedValue<number>
  insetTop: number
  onBack: () => void
  /** Tap the header (anywhere but the back button) → scroll the list to the top. */
  onTitlePress?: () => void
  backAccessibilityLabel?: string
  /** Expanded header height, excl. status-bar inset. */
  expH?: number
  /** Expanded badge centre, below the status-bar inset. */
  badgeCyExp?: number
  /** Expanded label-line top (opens the gap below the badge). */
  labelExpTop?: number
  /** Expanded badge scale (shrinks to 1 when collapsed). */
  badgeExpScale?: number
  /** Label font size, expanded vs collapsed. */
  expLabelSize?: number
  colLabelSize?: number
  /** Theme colour token for the label text. */
  labelColor?: `--${string}`
}) {
  const { width: screenW } = useWindowDimensions()
  const [badgeSize, setBadgeSize] = useState(BADGE_FALLBACK)

  // Badge anchor points (centre x/y) for the two ends of the collapse.
  const cxExp = screenW / 2
  const cyExp = insetTop + badgeCyExp
  const cxCol = PILL_LEFT + PILL_PAD + badgeSize.w / 2
  const cyCol = insetTop + ROW_CY

  // The badge is one element that travels + shrinks; scaling is centre-anchored, so translating its
  // centre to the target keeps it put. Always opaque — it bridges the two label states visually.
  const badgeStyle = useAnimatedStyle(() => {
    const s = interpolate(scrollY.value, [0, COLLAPSE], [badgeExpScale, 1], Extrapolation.CLAMP)
    const cx = interpolate(scrollY.value, [0, COLLAPSE], [cxExp, cxCol], Extrapolation.CLAMP)
    const cy = interpolate(scrollY.value, [0, COLLAPSE], [cyExp, cyCol], Extrapolation.CLAMP)
    return {
      transform: [
        { translateX: cx - badgeSize.w / 2 },
        { translateY: cy - badgeSize.h / 2 },
        { scale: s },
      ],
    }
  })

  // Pill glass + the inline (collapsed) label fade in late; the expanded label fades out early — so
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
  const expLabelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, COLLAPSE * 0.4], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [0, COLLAPSE * 0.4], [0, -6], Extrapolation.CLAMP) },
    ],
  }))
  const colLabelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [COLLAPSE * 0.5, COLLAPSE], [0, 1], Extrapolation.CLAMP),
  }))

  const pillW = Math.max(0, screenW - PILL_LEFT - CORNER)
  const colLabelLeft = cxCol + badgeSize.w / 2 + INLINE_GAP
  const colLabelW = Math.max(0, screenW - CORNER - PILL_PAD - colLabelLeft)
  // Inset the expanded title to the content margin (`CORNER`, matching the list's `px-4`) so the
  // title band lines up with the rows below it rather than sitting narrower.
  const expLabelW = Math.max(0, screenW - 2 * CORNER)

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, top: 0, height: insetTop + expH }}
    >
      {/* Tap-to-top: a low-z catcher over the chrome band (below every visible element, and below
          the back lens — which sits above it and handles its own tap). Tapping the header title/pill
          while scrolled scrolls the list back to the top. Bounded to the collapsed-chrome band so
          stops scrolling under the lower header stay tappable. */}
      {onTitlePress ? (
        <Pressable
          accessibilityRole="button"
          onPress={onTitlePress}
          // Above the pill/label/badge (z1–3) so it actually catches the tap, below the back
          // lens (z4) so Back still works. The chrome above it is non-interactive anyway.
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: insetTop + COL_H,
            zIndex: 3,
          }}
        />
      ) : null}

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

      {/* Expanded content beneath the big badge, fades out first. Either a centred label marquee
          (default) or a custom slot (the route screen's from/to card + toggle). The slot carries
          interactive controls, so it sits above the tap-to-top catcher (z4) and its host positions
          it below the collapsed-chrome band via `labelExpTop`. */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: insetTop + labelExpTop,
            alignItems: expandedSlot ? 'stretch' : 'center',
            paddingHorizontal: expandedSlot ? CORNER : 0,
            zIndex: expandedSlot ? 4 : 2,
          },
          expLabelStyle,
        ]}
      >
        {expandedSlot ?? (
          <Marquee width={expLabelW} text={label} size={expLabelSize} color={labelColor} />
        )}
      </Animated.View>

      {/* Collapsed label line — inline inside the pill, fades in last */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            left: colLabelLeft,
            top: insetTop + CORNER,
            height: PILL_H,
            justifyContent: 'center',
            zIndex: 2,
          },
          colLabelStyle,
        ]}
      >
        <Marquee
          width={colLabelW}
          text={collapsedLabel ?? label}
          size={colLabelSize}
          color={labelColor}
        />
      </Animated.View>

      {/* The badge — a single element morphing from big-centre to small-in-pill */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left: 0, top: 0, zIndex: 3 }, badgeStyle]}
      >
        <View
          onLayout={(e) =>
            setBadgeSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
          }
        >
          {badge}
        </View>
      </Animated.View>

      {/* Back lens — evenly pinned in the top-left corner, above the pill (the shared
          standard back button). */}
      <BackButton
        onPress={onBack}
        size={BACK}
        accessibilityLabel={backAccessibilityLabel}
        style={{ position: 'absolute', left: CORNER, top: insetTop + CORNER, zIndex: 4 }}
      />
    </View>
  )
}

/** One-line label that, when it overflows `width`, **continuously** marquees — scroll to the end,
 *  pause, scroll back, pause, repeat — on an infinite loop. Static when it fits: centred by default,
 *  or pinned left (`align="left"`, e.g. the route header's from/to card). Non-interactive (taps fall
 *  through to the header's tap-to-top catcher). Exported so hosts can reuse the exact motion. */
export function Marquee({
  width,
  text,
  size = 14,
  color = '--text-muted',
  align = 'center',
  lineHeight,
}: {
  width: number
  text: string
  size?: number
  color?: `--${string}`
  align?: 'left' | 'center'
  /** Fix the line box height so callers can position lines in exact slots. */
  lineHeight?: number
}) {
  const { color: themeColor } = useTheme()
  const [textW, setTextW] = useState(0)
  const x = useSharedValue(0)
  const overflow = Math.max(0, textW - width)

  // Continuous loop with a hold at each end: wait → reveal the end → wait → return → repeat.
  useEffect(() => {
    cancelAnimation(x)
    x.value = 0
    if (overflow <= 1) return
    const dur = Math.max(1400, overflow * 24)
    const ease = Easing.inOut(Easing.ease)
    x.value = withRepeat(
      withSequence(
        withDelay(1200, withTiming(-overflow, { duration: dur, easing: ease })),
        withDelay(1200, withTiming(0, { duration: dur, easing: ease })),
      ),
      -1, // forever
      false,
    )
    return () => cancelAnimation(x)
  }, [overflow, x])

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  // Centre a fitting label (unless pinned left); always pin left while marqueeing.
  const centerOffset = overflow > 0 || align === 'left' ? 0 : Math.max(0, (width - textW) / 2)

  return (
    <View pointerEvents="none" style={{ width, overflow: 'hidden' }}>
      {/* The row is given far more width than any label so the text never wraps and is
          never ellipsised; the clip above shows a window onto it and we scroll it. */}
      <Animated.View
        style={[{ flexDirection: 'row', width: 1200, marginLeft: centerOffset }, style]}
      >
        <Text
          onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
          numberOfLines={1}
          style={{
            fontFamily: FONT_FAMILY.regular,
            fontSize: size,
            color: themeColor(color),
            ...(lineHeight ? { lineHeight } : {}),
          }}
        >
          {text}
        </Text>
      </Animated.View>
    </View>
  )
}
