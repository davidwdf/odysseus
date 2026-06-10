import { etaLabelParts, type Locale } from '@nextbus/core'
import { FONT_FAMILY } from '@nextbus/ui'
import { useEffect, useState } from 'react'
import { Text as RNText, StyleSheet, View } from 'react-native'
import Animated, {
  FadeOut,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../lib/useTheme'

const DUR = 260

/**
 * Honest per-stop arrivals (ADR-008) with two on-change transitions, no client clock:
 *  1) when the soonest time passes, its slot fades out and the rest **slide over**
 *     (Reanimated layout transition, keyed by arrival minute so a bus keeps its slot);
 *  2) when a value changes, the text does an **odometer slide** (old up/out, new up/in).
 * The first slot is emphasised (larger + urgency colour). The unit ("min") is shown on **every**
 * value — "12 min  27 min  42 min". Resting state is always fully visible — the animations are
 * layered on top, never a prerequisite for legibility.
 */
export function EtaTimes({
  arrivals,
  now,
  locale,
}: {
  arrivals: string[]
  now: number
  locale: Locale
}) {
  return (
    <View
      className="mt-1 flex-row flex-wrap items-center gap-x-3 gap-y-0.5"
      style={{ minHeight: 22 }}
    >
      {arrivals.map((iso, i) => (
        <Animated.View
          key={iso}
          layout={LinearTransition.duration(DUR)}
          exiting={FadeOut.duration(160)}
        >
          <TimeSlot iso={iso} now={now} locale={locale} first={i === 0} withUnit />
        </Animated.View>
      ))}
    </View>
  )
}

function TimeSlot({
  iso,
  now,
  locale,
  first,
  withUnit,
}: {
  iso: string
  now: number
  locale: Locale
  first: boolean
  /** Append the "min" unit. Every slot sets this, so the row reads "12 min  27 min  42 min".
   *  A "Due" slot never takes it. */
  withUnit: boolean
}) {
  const { color } = useTheme()
  const parts = etaLabelParts(iso, now, locale)
  const tone =
    parts.kind === 'due'
      ? '--positive'
      : parts.kind === 'mins' && parts.value <= 5
        ? '--warning'
        : '--text'
  const value =
    parts.kind === 'due'
      ? parts.label
      : parts.kind === 'mins'
        ? withUnit
          ? `${parts.value} ${parts.unit}`
          : `${parts.value}`
        : '—'
  return (
    <SlideNumber
      value={value}
      color={first ? color(tone) : color('--text-muted')}
      size={first ? 16 : 14}
      bold={first}
    />
  )
}

/**
 * Odometer-style value transition: the current value is always rendered at rest (visible
 * even if animations no-op on web). On change, the previous value slides up & fades while
 * the new one slides up into place — driven by a timing value, not entering/exiting.
 */
function SlideNumber({
  value,
  color,
  size,
  bold,
}: {
  value: string
  color: string
  size: number
  bold: boolean
}) {
  const [display, setDisplay] = useState(value)
  // The transition only animates the part that actually changed: the common prefix and
  // suffix stay put, the differing middle slides. So "52 min" → "51 min" slides just the
  // "2"→"1"; "1 min" → "Due" (no shared prefix) slides the whole thing.
  const [seg, setSeg] = useState<null | {
    prefix: string
    suffix: string
    prevMid: string
    nextMid: string
  }>(null)
  const t = useSharedValue(1)

  useEffect(() => {
    if (value === display) return
    const a = display
    const b = value
    let p = 0
    const min = Math.min(a.length, b.length)
    while (p < min && a[p] === b[p]) p++
    let s = 0
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
    setSeg({
      prefix: b.slice(0, p),
      suffix: s > 0 ? b.slice(b.length - s) : '',
      prevMid: a.slice(p, a.length - s),
      nextMid: b.slice(p, b.length - s),
    })
    setDisplay(b)
    t.value = 0
    t.value = withTiming(1, { duration: DUR }, (done) => {
      if (done) runOnJS(setSeg)(null)
    })
  }, [value, display, t])

  const rise = size * 0.85
  const base = {
    fontSize: size,
    lineHeight: size + 5,
    color,
    fontFamily: bold ? FONT_FAMILY.semibold : FONT_FAMILY.regular,
    fontVariant: ['tabular-nums' as const],
  }
  const incoming = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: (1 - t.value) * rise }],
  }))
  const outgoing = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [{ translateY: -t.value * rise }],
  }))

  // Resting: a single static text. The animation machinery only mounts mid-transition.
  if (!seg) return <RNText style={base}>{display}</RNText>

  const widerMid = seg.nextMid.length >= seg.prevMid.length ? seg.nextMid : seg.prevMid
  return (
    <View style={{ flexDirection: 'row' }}>
      {seg.prefix ? <RNText style={base}>{seg.prefix}</RNText> : null}
      <View style={{ overflow: 'hidden' }}>
        {/* sizer (wider of the two mids) keeps the sliding box from clipping */}
        <RNText style={[base, { opacity: 0 }]}>{widerMid || ' '}</RNText>
        <Animated.Text style={[StyleSheet.absoluteFill, base, incoming]}>
          {seg.nextMid}
        </Animated.Text>
        <Animated.Text style={[StyleSheet.absoluteFill, base, outgoing]}>
          {seg.prevMid}
        </Animated.Text>
      </View>
      {seg.suffix ? <RNText style={base}>{seg.suffix}</RNText> : null}
    </View>
  )
}
