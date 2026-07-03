import type { Locale, OperatorId } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { FONT_FAMILY } from '@nextbus/ui'
import { ArrowDown, RotateCw } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../lib/useTheme'
import { CollapsingHeader, collapsedHeaderH, expandedHeaderH, Marquee } from './CollapsingHeader'
import { DirectionSwapIcon } from './DirectionSwapIcon'
import { Icon } from './Icon'
import { RouteChip } from './RouteChip'

// Route + stop headers share one collapsing-chrome implementation (ADR-033 → CollapsingHeader),
// so the two screens feel like one family. Re-export the height helpers the route screen imports.
export { collapsedHeaderH, expandedHeaderH }

/** Expanded route-header height — taller than the shared default to fit the from/to card plus a
 *  little breathing room beneath it before the content. The route screen sizes its spacer with this. */
export const ROUTE_EXP_H = 168
// The card sits *below* the collapsed-chrome band (COL_H) so its toggle button is tappable
// (the tap-to-top catcher only covers that band).
const CARD_TOP = 96

// From/to name box: two fixed-height slots so the swap animation can move a line between exact
// positions. Origin is small/muted on top; destination is larger/text below.
const O_SIZE = 13
const D_SIZE = 15
const O_LH = 18
const D_LH = 22
const GAP = 2
const O_TOP = 0
const D_TOP = O_LH + GAP // 20
const BOX_H = D_TOP + D_LH // 42

/**
 * The route-detail header (ADR-046, the direction-toggle "F" layout): the route chip is the
 * morphing badge; beneath it a **from/to card** shows the journey — full origin → destination stop
 * names with a down arrow — and, when a reverse direction exists, a **reverse toggle sits inside the
 * card** on its right. On scroll the card fades into the collapsed pill (`→ destination`).
 *
 * The flip runs a **lyrics-style swap**: the old destination rises into the origin slot and shrinks
 * to origin style (it *is* the new origin), the old origin slides up and out, and the new
 * destination rises in from the bottom. Triggered on the name change (not the raw tap) so it never
 * animates stale text; long names marquee at rest.
 */
export function RouteHeader({
  operator,
  routeNo,
  origin,
  destination,
  canReverse,
  circular,
  onFlip,
  swapNonce,
  scrollY,
  insetTop,
  onBack,
  onTitlePress,
  locale,
}: {
  operator: OperatorId
  routeNo: string
  /** Localized names for the two card lines. For a bidirectional route these are the full first/
   *  last stop names; for a circular route, the boarding terminus and a "Circular via …" line. */
  origin: string
  destination: string
  /** A reverse direction exists (dataset carries the opposite bound) → show the toggle. */
  canReverse: boolean
  /** This route loops back to its origin → loop connector + no toggle (ADR-046). */
  circular: boolean
  onFlip: () => void
  /** Increments on each flip → arms the swap animation (which fires when the new names arrive). */
  swapNonce: number
  scrollY: SharedValue<number>
  insetTop: number
  onBack: () => void
  /** Tap the header chrome (but not a control) → scroll the list to the top. */
  onTitlePress?: () => void
  locale: Locale
}) {
  const { color } = useTheme()
  const textColor = color('--text')
  const mutedColor = color('--text-muted')

  // The name box measures its own width so the names can marquee (never ellipsis) at rest.
  const [nameW, setNameW] = useState(220)

  // `shown` = names at rest; `incoming` = the flip target while the swap animates. A flip is *armed*
  // on the nonce bump but only *fired* when the names actually change (the reverse loads a tick
  // later), so we never animate the still-current names.
  const [shown, setShown] = useState({ o: origin, d: destination })
  const [incoming, setIncoming] = useState<{ o: string; d: string } | null>(null)
  const latest = useRef({ o: origin, d: destination })
  latest.current = { o: origin, d: destination }
  const reduceMotion = useReducedMotion()
  const lastNonce = useRef(swapNonce)
  const armed = useRef(false)
  const p = useSharedValue(0) // 0 → 1 across a swap

  // biome-ignore lint/correctness/useExhaustiveDependencies: arm on nonce; the props effect fires it
  useEffect(() => {
    if (swapNonce === lastNonce.current) return
    lastNonce.current = swapNonce
    if (!reduceMotion) armed.current = true
  }, [swapNonce])

  // biome-ignore lint/correctness/useExhaustiveDependencies: run the swap (or plainly mirror props)
  useEffect(() => {
    if (armed.current) {
      armed.current = false
      setIncoming({ o: origin, d: destination })
      p.value = 0
      p.value = withTiming(1, { duration: 380, easing: Easing.inOut(Easing.quad) }, (done) => {
        if (done) runOnJS(finishSwap)()
      })
    } else if (!incoming) {
      setShown({ o: origin, d: destination })
    }
  }, [origin, destination])

  const finishSwap = () => {
    setShown(latest.current)
    setIncoming(null)
  }

  // Old origin: slides up and fades out.
  const exitStyle = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [{ translateY: -O_LH * p.value }],
  }))
  // Old destination → new origin: rises from the destination slot to the origin slot, shrinking to
  // origin size and fading from text to muted.
  const riseStyle = useAnimatedStyle(() => ({
    color: interpolateColor(p.value, [0, 1], [textColor, mutedColor]),
    transform: [
      { translateY: (D_TOP - O_TOP) * (1 - p.value) },
      { scale: 1 - (1 - O_SIZE / D_SIZE) * p.value },
    ],
  }))
  // New destination: rises into the destination slot from just below, fading in.
  const inStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.4, 1], [0, 0, 1]),
    transform: [{ translateY: D_LH * (1 - p.value) }],
  }))

  const baseText = { left: 0, width: nameW, fontFamily: FONT_FAMILY.regular } as const

  return (
    <CollapsingHeader
      badge={<RouteChip operator={operator} routeNo={routeNo} />}
      label={circular ? destination : `${origin} → ${destination}`}
      collapsedLabel={circular ? destination : `→ ${destination}`}
      expandedSlot={
        <View className="flex-row items-center gap-2 rounded-2xl border border-border bg-surface py-2 pr-2 pl-3.5">
          {/* Loop glyph for circular routes; direction-of-travel arrow otherwise. */}
          <Icon icon={circular ? RotateCw : ArrowDown} tone="subtle" size={18} />
          <View
            className="min-w-0 flex-1"
            style={{ height: BOX_H, overflow: 'hidden' }}
            onLayout={(e) => setNameW(e.nativeEvent.layout.width)}
          >
            {incoming ? (
              <>
                <Animated.Text
                  numberOfLines={1}
                  style={[
                    {
                      position: 'absolute',
                      top: O_TOP,
                      ...baseText,
                      fontSize: O_SIZE,
                      lineHeight: O_LH,
                      color: mutedColor,
                    },
                    exitStyle,
                  ]}
                >
                  {shown.o}
                </Animated.Text>
                <Animated.Text
                  numberOfLines={1}
                  style={[
                    {
                      position: 'absolute',
                      top: O_TOP,
                      ...baseText,
                      fontSize: D_SIZE,
                      lineHeight: D_LH,
                      transformOrigin: 'left top',
                    },
                    riseStyle,
                  ]}
                >
                  {incoming.o}
                </Animated.Text>
                <Animated.Text
                  numberOfLines={1}
                  style={[
                    {
                      position: 'absolute',
                      top: D_TOP,
                      ...baseText,
                      fontSize: D_SIZE,
                      lineHeight: D_LH,
                      color: textColor,
                    },
                    inStyle,
                  ]}
                >
                  {incoming.d}
                </Animated.Text>
              </>
            ) : (
              <>
                <View style={{ position: 'absolute', top: O_TOP, left: 0, right: 0 }}>
                  <Marquee
                    width={nameW}
                    text={shown.o}
                    size={O_SIZE}
                    lineHeight={O_LH}
                    color="--text-muted"
                    align="left"
                  />
                </View>
                <View style={{ position: 'absolute', top: D_TOP, left: 0, right: 0 }}>
                  <Marquee
                    width={nameW}
                    text={shown.d}
                    size={D_SIZE}
                    lineHeight={D_LH}
                    color="--text"
                    align="left"
                  />
                </View>
              </>
            )}
          </View>
          {canReverse ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(locale, 'reverseDirection')}
              onPress={onFlip}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2 active:opacity-70"
            >
              <DirectionSwapIcon nonce={swapNonce} size={18} />
            </Pressable>
          ) : null}
        </View>
      }
      scrollY={scrollY}
      insetTop={insetTop}
      onBack={onBack}
      onTitlePress={onTitlePress}
      expH={ROUTE_EXP_H}
      labelExpTop={CARD_TOP}
    />
  )
}
