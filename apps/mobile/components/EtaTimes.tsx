import type { EtaUrgency, RouteStopArrival } from '@nextbus/core'
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
}: {
  /**
   * The readouts, already derived — `routeDetailView`'s since WP6-6a.
   *
   * It used to take raw ISO strings plus a locale and a policy, and call `etaLabelParts`/`etaUrgency`
   * itself. Those are kernel calls, so it was never *deriving* — but it did compose the visible string
   * (`${value} ${unit}`, else the word, else a dash), and the composition is what two renderers get
   * subtly different. **`now` and `policy` went with it**, which is the part worth noticing: this
   * component was the *fourth* place the imminence band had been written down, and it now has no clock and
   * no threshold to be wrong about — the odometer's identity is the arrival's own `iso`, and the
   * animations are driven by value changes rather than by time passing (ADR-008: no client-side
   * countdown).
   */
  arrivals: readonly RouteStopArrival[]
}) {
  return (
    <View
      className="mt-1 flex-row flex-wrap items-center gap-x-3 gap-y-0.5"
      style={{ minHeight: 22 }}
    >
      {arrivals.map((arrival, i) => (
        <Animated.View
          key={arrival.iso}
          layout={LinearTransition.duration(DUR)}
          exiting={FadeOut.duration(160)}
        >
          <TimeSlot arrival={arrival} first={i === 0} />
        </Animated.View>
      ))}
    </View>
  )
}

/** Urgency → theme variable, the same mapping `EtaBadge` makes in Tailwind classes. Two tables for one
 *  decision is a duplication worth naming: this component colours through `useTheme().color(var)`
 *  because it animates a raw `RNText`, so it cannot use a class. The *thresholds* are shared — which is
 *  the half that was actually drifting. */
const TONE: Record<EtaUrgency, `--${string}`> = {
  due: '--positive',
  soon: '--warning',
  normal: '--text',
  none: '--text',
}

function TimeSlot({ arrival, first }: { arrival: RouteStopArrival; first: boolean }) {
  const { color } = useTheme()
  const { label } = arrival
  const tone = TONE[arrival.urgency] ?? TONE.none
  // The unit rides on every numeric slot, so the row reads "12 min  27 min  42 min"; a "Due" slot has
  // no unit to take. `headway` cannot reach this row — `upcoming` yields arrivals, and a published
  // frequency is not one — but the union carries the arm, so it renders as the text it is rather than
  // falling through to the dash and losing a real sentence.
  const value =
    label.kind === 'due'
      ? label.label
      : label.kind === 'mins'
        ? `${label.value} ${label.unit}`
        : label.kind === 'headway'
          ? label.text
          : '—'
  return (
    <SlideNumber
      value={value}
      color={first ? color(tone) : color('--text-muted')}
      size={first ? 16 : 14}
      bold={first}
      stale={arrival.stale}
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
  stale,
}: {
  value: string
  color: string
  size: number
  bold: boolean
  /** Old enough to say so (ADR-008) — dimmed, and never colour alone: the value stops moving too,
   *  because a stale reading only changes when a fresh one arrives. */
  stale: boolean
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
    opacity: stale ? 0.45 : 1,
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
