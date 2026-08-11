import { type EtaLabelParts, type EtaUrgency, etaCarriesStaleMark } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { ETA_STALE_GUTTER } from '@nextbus/ui'
import { useLocale } from '../providers/LocaleProvider'
import { SlideNumber } from './SlideNumber'

/**
 * Tone by urgency — the client half of ADR-053's line, and the DOM's copy of the *colour* decision
 * only. The thresholds are `etaUrgency`'s; this table is what `soon` looks like here.
 *
 * It is a deliberate duplicate of `apps/mobile/components/EtaBadge.tsx`'s table, and the duplication is
 * the correct kind: both map a kernel name to their own platform's colour system, which is exactly what
 * a native client will also do. What must never be duplicated is the number that decides which name.
 */
const TONE: Record<EtaUrgency, string> = {
  due: 'text-positive',
  soon: 'text-warning',
  normal: 'text-text',
  none: 'text-muted',
}

/**
 * **The staleness mark** — a muted `~` in front of a reading whose board has aged past the served
 * `staleAfterMs`. The DOM half; `apps/mobile/components/EtaBadge.tsx` draws the identical thing.
 *
 * ## What it replaces, and why
 *
 * Until now staleness was `opacity-45` on the whole readout. The owner's objection is the right one: a
 * fade is not *communicated*, it is only noticed — a rider with one reading on screen has nothing to
 * compare it against, and someone who has never seen the fresh version cannot tell a dimmed number from
 * a design choice. A `~` is a mark you can read, and it is a mark this app already uses for the same
 * register: a concession fare we work out rather than read from a feed prints `~$6.7` (ADR-095), and the
 * FAQ says so. One glyph, one meaning — *we are telling you roughly*.
 *
 * ## The figure does not move by one pixel, and that is CSS rather than luck
 *
 * The readout reserves `ETA_STALE_GUTTER` of left padding **always**, and the mark is a flex item whose
 * width is cancelled by an equal negative margin — so it draws inside the reserved gutter and contributes
 * exactly zero to the line. Fresh and stale, the figure's left edge is the container's border box plus
 * the same 12px.
 *
 * Two ways of getting there were rejected. **Mounting a `~` always and hiding it when fresh** is the one
 * that would have shipped: this repo's conformance walker reads text by *presence, not visibility*, so
 * every fresh readout on every screen would project a `~` for ever and no state suite would catch it —
 * they all mount settled. (It has bitten twice: the FAQ's collapsed `<details>`, and `SlideNumber`'s
 * invisible sizer copy that made a mid-flight readout project "5112 min".) **Leaning on the flex `gap`**
 * fails differently and quietly: a gap applies *between* items, so a mark that cancels its own width still
 * pushes the figure over by one gap. The readout containers here have no `gap` for that reason, and the
 * unit carries its own `ml-*`.
 *
 * ## It is muted whatever the figure is
 *
 * `text-muted`, never `TONE[urgency]`. The mark says how old the reading is; the colour says how soon the
 * bus is. Against a green "Due" the grey tilde reads as an aside on the figure rather than as part of it,
 * which is the point — and ADR-008's "never colour alone" is satisfied either way, because the mark is a
 * glyph and not a hue.
 *
 * ## And it says what it means to a screen reader
 *
 * `role="img"` with an `aria-label`, so the tilde is announced as a sentence rather than as "tilde" or as
 * nothing. The treatment it replaces announced *nothing at all*, in every locale, so this is the first
 * time the cue exists for a rider who cannot see it. The label is a catalogue key, and the glyph is not:
 * `~` is a marker like the `→` before a destination, which the specs declare as a `literal` for the same
 * reason. `useLocale()` rather than a prop, because both of this component's callers would otherwise have
 * to learn about it and one of them (`PlaceRow`) has no locale to give (CLAUDE.md rule 5).
 */
export function EtaStaleMark() {
  const locale = useLocale()
  return (
    <span
      role="img"
      aria-label={t(locale, 'etaStaleMark')}
      // `self-center` and not the row's `items-baseline`, which is a **cross-axis** choice and therefore
      // moves nothing: measured in Chrome, the figure's left edge is identical either way. A tilde is a
      // mid-height glyph, so sharing a baseline with a 22px figure parks it down among the digits' feet and
      // it reads as a subscript. Centred against the figure's line box it reads as what it is — a mark on
      // the number. Worth knowing on the schematic, where the secondary slots are 12px and the two
      // alignments are almost the same thing; the card's `h2` readout is where the difference shows.
      className="shrink-0 self-center text-center text-caption text-muted"
      // Inline rather than `w-3 -ml-3`, so the cancellation is a pair of numbers a test can read straight
      // back off the node — `test/eta-stale-cue.test.tsx` asserts `width + marginLeft === 0` on the
      // rendered element, which is the only form of "the figure did not move" that jsdom, which has no
      // layout engine, can actually measure.
      style={{ width: ETA_STALE_GUTTER, marginLeft: -ETA_STALE_GUTTER }}
    >
      ~
    </span>
  )
}

/** Honest ETA readout (ADR-008): tabular figures, urgency colour, a muted `~` when the board has aged,
 *  and no client-side countdown — the value changes only when fresh data arrives.
 *
 *  **Which readouts carry the mark is `etaCarriesStaleMark`'s**, not this component's. It used to be a
 *  local `marked()` here and three more copies of the same boolean across the two renderers' badges and
 *  rails; it is a corpus-pinned kernel rule now, so a sixth arm on `EtaLabelParts` cannot be answered one
 *  way here and another way on the schematic. See `@nextbus/core/eta` for why the *geometry* of the mark
 *  stayed in `@nextbus/ui` while the judgement did not. */
export function EtaBadge({
  label,
  urgency,
  stale,
}: {
  label: EtaLabelParts
  urgency: EtaUrgency
  stale: boolean
}) {
  const tone = TONE[urgency] ?? TONE.none
  return (
    // The gutter is reserved on every readout, stale or not and figure or dash, so the right-hand column
    // of a card stays aligned down the list rather than stepping in and out by 12px per row.
    <span className="flex shrink-0 items-baseline" style={{ paddingLeft: ETA_STALE_GUTTER }}>
      {etaCarriesStaleMark(label, stale) ? <EtaStaleMark /> : null}
      {label.kind === 'mins' ? (
        <>
          <SlideNumber
            value={String(label.value)}
            className={`text-h2 font-semibold tabular-nums ${tone}`}
          />
          <span className="ml-0.5 text-caption text-muted">{label.unit}</span>
        </>
      ) : label.kind === 'headway' ? (
        // The published timetable, where there is no live reading at all (WP6-4b) — small and muted rather
        // than a figure, because it is the *Static* honesty tier and must not read as a bus that has been
        // seen. See the RN twin for the longer note.
        <span className="max-w-[120px] text-right text-caption text-subtle">{label.text}</span>
      ) : (
        <span className={`text-h2 font-semibold tabular-nums ${tone}`}>
          {label.kind === 'due' ? label.label : '—'}
        </span>
      )}
    </span>
  )
}
