import type { LucideIcon } from 'lucide-react-native'
import { type ReactNode, useCallback, useRef } from 'react'
import { type LayoutChangeEvent, Pressable, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../lib/useTheme'
import { Icon, type IconTone } from './Icon'
import { Text } from './Text'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

// Drag thresholds for dismiss-by-fling.
const DISMISS_DISTANCE = 90
const DISMISS_VELOCITY = 850
// Extra glass painted below the screen edge so an upward rubber-band stretch reveals more
// sheet, never the scrim behind it.
const UNDERLAP = 320
const RADIUS = 26
// Entrance overshoot, in **pixels** — the panel eases a fixed 7px past rest, then settles. This is
// deliberately a constant, NOT `Easing.back` (whose overshoot is a *fraction of the travel*, so a
// tall sheet — which starts further down and travels further — visibly bounced more than a short one).
const OVERSHOOT = 7

/**
 * A bottom sheet. A solid `--surface` panel over a dimmed scrim; it slides up on mount and
 * **animates out** on dismiss. (It was a liquid-glass pane, but animating a moving element that
 * carries a `backdrop-filter` is too costly on web — the filter re-samples the backdrop every
 * frame — so the panel is solid; the scrim does the separation.) The grab handle is
 * **draggable** — drag down (past a threshold or with a flick) to dismiss, or drag up a little
 * for a rubber-band stretch that springs back. Mount/unmount from the parent
 * (`{open ? <BottomSheet/> : null}`); `onClose` fires once the slide-out completes.
 *
 * `children` may be a render function receiving `close()` — call it from an action to dismiss
 * with the same slide-out (e.g. after toggling a favourite).
 */
export function BottomSheet({
  onClose,
  header,
  closeLabel,
  children,
}: {
  /** Called after the slide-out finishes — unmount the sheet here. */
  onClose: () => void
  /** Content above the actions (e.g. what's being favourited). */
  header?: ReactNode
  /** Accessible label for the scrim's tap-to-dismiss target. */
  closeLabel?: string
  children: ReactNode | ((close: () => void) => ReactNode)
}) {
  const insets = useSafeAreaInsets()
  const { color } = useTheme()
  const { height: screenH } = useWindowDimensions()
  // translateY of the panel: 0 = open, +visibleHeight = fully below the screen.
  const ty = useSharedValue(screenH)
  // Measured panel height (content + paddings + UNDERLAP); seeds the close/scrim maths.
  const panelH = useSharedValue(screenH)
  const opened = useRef(false)

  const close = useCallback(() => {
    ty.value = withTiming(
      panelH.value - UNDERLAP,
      { duration: 220, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onClose)()
      },
    )
  }, [onClose, ty, panelH])

  const onPanelLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height
    panelH.value = h
    if (!opened.current) {
      opened.current = true
      ty.value = h - UNDERLAP // jump just below the edge (instant), then slide up
      // Slide up a fixed 7px past rest, then settle down — one gentle bounce, the same size for a
      // short or tall sheet (the overshoot is a constant, not a fraction of the slide distance).
      ty.value = withSequence(
        withTiming(-OVERSHOOT, { duration: 330, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) }),
      )
    }
  }

  // Drag the handle: down → 1:1 (dismiss past threshold); up → resisted rubber-band.
  const pan = Gesture.Pan()
    .onBegin(() => {
      cancelAnimation(ty)
    })
    .onUpdate((e) => {
      ty.value = e.translationY >= 0 ? e.translationY : -Math.sqrt(-e.translationY) * 2.5
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        ty.value = withTiming(
          panelH.value - UNDERLAP,
          { duration: 200, easing: Easing.in(Easing.cubic) },
          (finished) => {
            if (finished) runOnJS(onClose)()
          },
        )
      } else {
        // Return to rest with a plain ease-out — no overshoot here, so a small drag-and-release
        // doesn't bounce; the single gentle bounce is reserved for the entrance.
        ty.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) })
      }
    })

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }))
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [0, panelH.value - UNDERLAP], [1, 0], Extrapolation.CLAMP),
  }))

  return (
    <View
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}
      pointerEvents="box-none"
    >
      {/* Scrim — dims the content behind and separates the sheet (no blur now). Fades with the slide. */}
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={close}
        style={[
          { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
          { backgroundColor: 'rgba(0,0,0,0.45)' },
          scrimStyle,
        ]}
      />
      {/* Solid surface panel — a top hairline + rounded top corners; `overflow:hidden` clips the
          corners. UNDERLAP extends it below the edge so an upward stretch never bares the scrim. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: -UNDERLAP,
            borderTopLeftRadius: RADIUS,
            borderTopRightRadius: RADIUS,
            overflow: 'hidden',
            backgroundColor: color('--surface'),
            borderTopWidth: 1,
            borderColor: color('--border'),
          },
          panelStyle,
        ]}
      >
        <View onLayout={onPanelLayout} style={{ paddingBottom: UNDERLAP + insets.bottom + 10 }}>
          {/* Draggable grab handle (+ header) */}
          <GestureDetector gesture={pan}>
            <View>
              <View className="items-center pt-3 pb-1.5">
                <View className="h-1.5 w-10 rounded-full bg-border" />
              </View>
              {header ? <View className="px-5 pt-1 pb-3">{header}</View> : null}
            </View>
          </GestureDetector>
          <View className="pt-1">
            {typeof children === 'function' ? children(close) : children}
          </View>
        </View>
      </Animated.View>
    </View>
  )
}

/** A single tappable row inside a `BottomSheet`: leading icon + label. */
export function SheetAction({
  icon,
  iconFill,
  label,
  tone = 'text',
  onPress,
}: {
  icon: LucideIcon
  /** Fill colour for the glyph (e.g. a filled star when already saved). */
  iconFill?: string
  label: string
  tone?: IconTone
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3.5 px-5 py-3.5 active:opacity-60"
    >
      <Icon icon={icon} tone={tone} size={22} fill={iconFill ?? 'none'} />
      <Text variant="body" className="text-text">
        {label}
      </Text>
    </Pressable>
  )
}
