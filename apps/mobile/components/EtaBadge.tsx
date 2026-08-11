import { type EtaLabelParts, type EtaUrgency, etaCarriesStaleMark } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { ETA_STALE_GUTTER } from '@nextbus/ui'
import { View } from 'react-native'
import { useLocale } from '../providers/LocaleProvider'
import { Text } from './Text'

/**
 * Tone by urgency — **the client half of the line, and it belongs here** (ADR-053, applied on this
 * side of the network for once). The kernel says an arrival is `soon`; this says `soon` is
 * `text-warning`. A served `etaColor: "#f59e0b"` would look like the same information and would be
 * wrong: it renders outside iOS's colour system, so it ignores Dark Mode and Increase Contrast.
 *
 * **What used to live here was the threshold, not the tone, and it had already drifted.** This
 * component decided imminence with a literal `parts.value <= 5` — 360 s, since `value` is floored
 * minutes — while the served `warnUnderSec` was 180 and its own comment in `core/policy.ts` read
 * *"Nothing reads this yet"*. Both were true, which is how one judgement came to be written down
 * twice. In a live sample of 40 rows, 7 were coloured imminent against the policy. `etaUrgency` owns
 * the thresholds now and this owns the colours, so neither can drift from the other: neither holds
 * the other's information.
 */
const TONE: Record<EtaUrgency, string> = {
  due: 'text-positive',
  soon: 'text-warning',
  normal: 'text-text',
  none: 'text-muted',
}

/**
 * **The staleness mark** — a muted `~` in front of a reading whose board has aged past the served
 * `staleAfterMs`. The RN half; `apps/web/src/components/EtaBadge.tsx` draws the identical thing and
 * carries the long note on why the fade it replaces was the wrong cue.
 *
 * The short version: a 45% fade is noticed rather than *read* — a rider with one reading on screen has
 * nothing to compare it against — where a `~` is a mark, and it is one this app already uses for the same
 * register (a concession fare we work out rather than read prints `~$6.7`, ADR-095). It stays `text-muted`
 * whatever `TONE[urgency]` the figure is: the mark says how old the reading is, the colour says how soon
 * the bus is.
 *
 * **The figure does not move when it appears**, and that is the hard requirement. The readout reserves
 * `ETA_STALE_GUTTER` of left padding unconditionally, and this draws inside it with an equal negative
 * margin, so its contribution to the row's main axis is exactly zero. It is **not** mounted-and-hidden
 * when fresh, deliberately: the conformance walker reads text by presence rather than visibility, so a
 * permanently-mounted `~` would project from every fresh readout in the app and every state suite would
 * still pass, because they all mount settled.
 *
 * `accessibilityRole="image"` with a catalogue label, the same shape the rail's bus token uses: a bare
 * tilde announces as "tilde" or as nothing, and the opacity it replaces announced as nothing at all.
 */
function EtaStaleMark() {
  const locale = useLocale()
  return (
    <Text
      variant="caption"
      accessible
      accessibilityRole="image"
      accessibilityLabel={t(locale, 'etaStaleMark')}
      className="text-center text-muted"
      // `alignSelf: 'center'` against the row's `items-baseline`, which is a cross-axis choice and moves
      // nothing on the main axis. A tilde is a mid-height glyph: sharing a baseline with a 22px figure parks
      // it among the digits' feet and it reads as a subscript, where centred against the figure's line box
      // it reads as a mark on the number. Measured in a browser on the DOM twin, which draws the same thing.
      style={{ width: ETA_STALE_GUTTER, marginLeft: -ETA_STALE_GUTTER, alignSelf: 'center' }}
    >
      ~
    </Text>
  )
}

/**
 * Honest ETA readout (docs/09 §6, ADR-008): tabular figures, urgency colour, a muted `~` once the board
 * has aged. No client-side countdown — the value only changes when fresh data arrives. The minutes
 * number is prominent with a small, muted, **pinned** unit so only the number shifts as the
 * value changes (less width-jump); under a minute it collapses to a short "Due" status.
 * (A number-flip / split-flap animation hooks in here later.)
 *
 * Takes an already-derived label, urgency and staleness rather than an `Eta` and a clock. All three are
 * corpus-pinned kernel rules (`etaLabelParts`, `etaUrgency`, `isStale`), and a component that derives
 * them itself is a component a second renderer has to *read* rather than call.
 *
 * **Which readouts carry the mark** is the fourth of those rules, `etaCarriesStaleMark`. It was a local
 * `marked()` here and three more copies of the same boolean — the DOM badge, and both renderers' schematic
 * rails — so a new arm on `EtaLabelParts` was four edits and any three of them left the renderers
 * disagreeing about a state both component specs claim to enforce.
 */
export function EtaBadge({
  label,
  urgency,
  stale,
}: {
  label: EtaLabelParts
  urgency: EtaUrgency
  /** The reading is old enough to say so. The `~` is this component's choice; the judgement is not. */
  stale: boolean
}) {
  // `?? TONE.none` because `EtaUrgency` may grow: this file is compiled against one version of the
  // kernel and a table lookup that returned `undefined` would render an unstyled figure.
  const tone = TONE[urgency] ?? TONE.none
  return (
    // The gutter is reserved on every readout, stale or not, so a list of cards keeps one right-hand
    // column instead of stepping in and out by 12px per row. No `gap` here on purpose — a flex gap applies
    // between items, so it would reintroduce exactly the shift the negative margin exists to cancel.
    <View className="flex-row items-baseline" style={{ paddingLeft: ETA_STALE_GUTTER }}>
      {etaCarriesStaleMark(label, stale) ? <EtaStaleMark /> : null}
      {label.kind === 'mins' ? (
        <>
          <Text variant="h2" tabular className={tone}>
            {label.value}
          </Text>
          <Text variant="caption" className="ml-0.5 text-muted">
            {label.unit}
          </Text>
        </>
      ) : label.kind === 'headway' ? (
        // **The published timetable, where there is no live reading at all** (WP6-4b). Small and muted
        // rather than a figure: it is the *Static* honesty tier (docs/09) and must not be mistaken for a
        // bus that has been seen. It is the arm that stopped a saved peak-only route rendering as a card
        // with a name and nothing under it.
        <Text variant="caption" className="max-w-[120px] text-right text-subtle">
          {label.text}
        </Text>
      ) : (
        <Text variant="h2" tabular className={tone}>
          {label.kind === 'due' ? label.label : '—'}
        </Text>
      )}
    </View>
  )
}
