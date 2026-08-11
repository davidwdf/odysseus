import { type EtaUrgency, etaCarriesStaleMark, type RouteStopArrival } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { ETA_STALE_GUTTER, ETA_STALE_MARK_SIZE, FONT_FAMILY } from '@nextbus/ui'
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
import { useLocale } from '../providers/LocaleProvider'

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
    // `gap-x-2` where this was `gap-x-3`, and the two numbers are one decision: each slot now reserves a
    // 12px gutter of its own for the staleness `~`, so slot-to-slot separation is 8 + 12 = 20px against the
    // 12px it was. The owner asked for the times "just a little farther apart" so the mark is not crowding
    // the figure before it; the gutter alone would have made it 24px, which reads as three columns rather
    // than a run of times. `apps/web/src/components/RouteStopRow.tsx` holds the identical pair.
    <View
      className="mt-1 flex-row flex-wrap items-center gap-x-2 gap-y-0.5"
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

/**
 * **The staleness mark** — the RN twin of `EtaBadge`'s, drawn here rather than shared because this row
 * animates raw `RNText` and cannot use the `<Text>` primitive's variant plumbing. Same glyph, same
 * `ETA_STALE_GUTTER`, same cancellation, same catalogue label.
 *
 * The width is the gutter and the margin is its negative, so the mark costs the row **zero** main-axis
 * width and the figure beside it does not move by a pixel when a board ages. Mounted only when the board
 * is stale — never mounted-and-hidden, because the conformance walker reads text by presence rather than
 * visibility and a permanently-mounted `~` would project from every fresh readout in the app.
 */
function StaleMark({ colour }: { colour: string }) {
  const locale = useLocale()
  return (
    <RNText
      accessible
      accessibilityRole="image"
      accessibilityLabel={t(locale, 'etaStaleMark')}
      style={{
        width: ETA_STALE_GUTTER,
        marginLeft: -ETA_STALE_GUTTER,
        // Cross-axis only, so the main-axis cancellation above is untouched: a tilde is a mid-height glyph
        // and a shared baseline with the first slot's larger figure reads as a subscript.
        alignSelf: 'center',
        textAlign: 'center',
        fontSize: ETA_STALE_MARK_SIZE,
        color: colour,
        fontFamily: FONT_FAMILY.regular,
      }}
    >
      ~
    </RNText>
  )
}

function TimeSlot({ arrival, first }: { arrival: RouteStopArrival; first: boolean }) {
  const { color } = useTheme()
  const { label } = arrival
  const tone = TONE[arrival.urgency] ?? TONE.none
  // The mark rides a figure and only a figure — `~ —` would be a claim about nothing, and a published
  // headway was never a reading. Both component specs declare the mark inside the `mins` and `due` arms
  // for the same reason, and the rule itself is the kernel's (`etaCarriesStaleMark`) rather than this
  // row's: it was spelled out here and in three sibling components, so a new arm on `EtaLabelParts` was
  // four edits in two apps.
  const marked = etaCarriesStaleMark(label, arrival.stale)
  // The unit rides on every numeric slot, so the row reads "12 min  27 min  42 min"; a "Due" slot has
  // no unit to take. `headway` cannot reach this row — `upcoming` yields arrivals, and a published
  // frequency is not one — but the union carries the arm, so it renders as the text it is rather than
  // falling through to the dash and losing a real sentence.
  const size = first ? 16 : 14
  const figure = first ? color(tone) : color('--text-muted')
  // **The unit is its own node and never animates**, which the spec found: the row composed
  // `${value} ${unit}` into one animated string, so the odometer slid a "min" that cannot change and the
  // DOM twin — which styles the figure and the unit differently, as the model's two fields invite — read
  // as a divergence. Two nodes, the figure animated and the unit static and muted. The whole point of
  // `EtaLabelParts` carrying `value` and `unit` separately is that they are styled apart (`@nextbus/core`).
  if (label.kind === 'mins') {
    return (
      // The gutter is reserved whether or not the mark is drawn, so a board ageing between two rounds
      // moves nothing on the rail. No `gap` on this row: a flex gap applies *between* items and would
      // reintroduce exactly the shift the mark's negative margin exists to cancel.
      <View className="flex-row items-baseline" style={{ paddingLeft: ETA_STALE_GUTTER }}>
        {marked ? <StaleMark colour={color('--text-muted')} /> : null}
        <SlideNumber value={String(label.value)} color={figure} size={size} bold={first} />
        <RNText
          style={{
            fontSize: 12,
            lineHeight: size + 5,
            marginLeft: 3,
            color: color('--text-muted'),
            fontFamily: FONT_FAMILY.regular,
          }}
        >
          {label.unit}
        </RNText>
      </View>
    )
  }
  const value = label.kind === 'due' ? label.label : label.kind === 'headway' ? label.text : '—'
  return (
    // A row rather than a bare `View`, so the mark can sit beside the word the way it sits beside a figure
    // — and it reserves the same gutter as the numeric arm, so a "Due" slot and a "12 min" slot line up.
    <View className="flex-row items-baseline" style={{ paddingLeft: ETA_STALE_GUTTER }}>
      {marked ? <StaleMark colour={color('--text-muted')} /> : null}
      <SlideNumber value={value} color={figure} size={size} bold={first} />
    </View>
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
