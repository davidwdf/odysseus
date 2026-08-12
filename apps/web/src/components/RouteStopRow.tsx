import type { EtaUrgency, RouteStopArrival, RouteStopRowView } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { Star } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useLocale } from '../providers/LocaleProvider'
import { NODE, NODE_CENTRE, NODE_TOP, RAIL_WIDTH } from './RailBusToken'
import { SlideNumber } from './SlideNumber'
import { StopName } from './StopName'

/**
 * One stop on the route schematic — the DOM twin of the `RouteStopRow` inside
 * `apps/mobile/app/route/[id].tsx`, and a pure projection of `RouteStopRowView`.
 *
 * The rail is a fixed gutter with a 2 px line behind a numbered node, and `first`/`last` decide which
 * connectors it draws — the kernel's flags, because a route whose last row drew a connector below it would
 * dangle a line into the page and nothing would fail. The saved-stop star sits on the node's corner, as it
 * does on the RN rail.
 *
 * **The whole row is one `<button>`**, which the spec's `sibling-not-nested` check requires and HTML would
 * otherwise forbid: the RN row is a single `Pressable`, so a DOM row with a nested control for the fare or
 * the star would be a tap target inside a tap target (ADR-024).
 */
export function RouteStopRow({
  row,
  index,
  animateIn,
  tokens,
  onPress,
  registerRow,
}: {
  row: RouteStopRowView
  /** Position in the list — what `RailBus`'s `index`/`from`/`to` name, and the cascade's per-row delay. */
  index: number
  /**
   * Play the staggered fade-and-rise entrance. True on a direction flip, false on a first load — where the
   * screen has its own reveal and a second one on top of it would read as a stutter (ADR-046).
   */
  animateIn: boolean
  /**
   * The buses this row carries — a bus **at** its node, and a bus on the segment leading into the *next*
   * row's node, which is half of this row below its own top.
   *
   * They ride against this row's own box rather than in an overlay over the list, which is what deletes the
   * measurement (ADR-110): where a bus sits is two constant CSS expressions, so a reflow moves the row and
   * its bus together and neither can go stale. Handed in already built, because their **order** is the
   * kernel's and belongs to the screen that reads `view.buses` — a row given two of them must not put them
   * in an order of its own.
   */
  tokens: ReactNode
  onPress: (row: RouteStopRowView) => void
  /** Reports this row's element so the reveal can scroll to it — geometry, not a decision. */
  registerRow: (index: number, el: HTMLElement | null) => void
}) {
  const { here, first, last } = row
  const locale = useLocale()
  // **Read once, at mount** — `useState`'s initial value is ignored on every later render, which is exactly
  // what the RN row gets from `useSharedValue(animateIn ? 0 : 1)` plus an effect with empty deps.
  //
  // Not a micro-optimisation. The nonce advances on the *tap*, and the reverse payload lands a tick later,
  // so for that tick the rows still on screen are the current direction's — and adding an animation class to
  // a mounted element *starts* it. Without this the outbound list blinks out and back in before the inbound
  // list arrives. A flip animates the rows that mount fresh because of it, and nothing else.
  const [rise] = useState(animateIn)
  return (
    /*
      A wrapper, and the bus tokens are the button's **siblings** rather than its children — the one
      structural consequence of placing the rail in CSS.

      `RailBusToken` is a `role="img"` with an `aria-label`, and a labelled graphic inside a button is folded
      into that button's accessible name: measured in Chrome's accessibility tree, a nested token turned
      *"Nathan Road · 3 min"* into *"Nathan Road · 3 min · Bus approaching Nathan Road"*. `pointer-events:
      none` does not exempt it, and no suite here would have caught it — the projection reads text nodes and
      token labels in two separate passes, so both stay identical while every row with a bus beside it starts
      announcing that bus twice.

      The wrapper's height **is** the button's — one full-width in-flow child, no margins — which is what
      keeps `calc(50% + 13px)` resolving against the row's own box. It is not interactive, so the spec's
      `sibling-not-nested` check and the interactive count are untouched. And the flip cascade's transform
      stays on the button, so a token does not ride it, which is `apps/mobile`'s behaviour too: its tokens are
      placed from `onLayout` values, and a transform does not move those.
    */
    <div className="relative">
      <button
        type="button"
        ref={(el) => registerRow(index, el)}
        onClick={() => onPress(row)}
        // The cascade's per-row beat, capped so a 60-stop route does not drag for two seconds — the delay
        // `apps/mobile` applies with `withDelay(Math.min(index, 10) * 26, …)`, value for value.
        style={
          rise ? { animationDelay: `${Math.min(index, CASCADE_CAP) * CASCADE_STEP}ms` } : undefined
        }
        // `scroll-mt` is the whole of this renderer's auto-scroll: `scrollIntoView` then lands the boarding row
        // below the sticky header without this screen computing an offset, and honours the rider's
        // reduced-motion setting without owning that decision either (ADR-045 is idiom). 7rem clears the
        // header — measured in a browser at 112 px, where 5rem left the anchored row half under it.
        // **No divider, and `min-h-16` in its place.** The RN schematic has no rules between stops at all —
        // the rail *is* the separator — and the 1 px border here was doing two jobs, one of which was holding
        // the row's rhythm: without a minimum a stop with no arrivals line collapses to about 52 px where the
        // RN row is a flat 64 (`minHeight: 64`).
        //
        // The two backgrounds are mutually exclusive rather than layered. They were `bg-transparent` in the
        // static list and `bg-surface-2` appended conditionally — two unvariant `background-color` utilities
        // of equal specificity, so the winner was whichever Tailwind happened to emit last, and it was the
        // transparent one. That is why the rider's boarding stop had no lighter background.
        className={`relative flex min-h-16 w-full scroll-mt-28 gap-0 border-0 px-0 py-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
          here ? 'bg-surface-2' : 'bg-transparent'
        } ${rise ? 'row-rise' : ''}`}
      >
        {/* The rail gutter: a continuous line behind a top-aligned node. */}
        <span className="relative shrink-0" style={{ width: RAIL_WIDTH }}>
          {!first ? (
            <span
              className="absolute bg-border"
              style={{ top: 0, height: NODE_CENTRE, width: 2, left: RAIL_WIDTH / 2 - 1 }}
            />
          ) : null}
          {!last ? (
            <span
              className="absolute bg-border"
              style={{ top: NODE_CENTRE, bottom: 0, width: 2, left: RAIL_WIDTH / 2 - 1 }}
            />
          ) : null}
          <span
            className={`absolute flex items-center justify-center rounded-full border text-caption tabular-nums ${
              here
                ? 'border-accent bg-accent text-accent-contrast'
                : 'border-border bg-surface text-subtle'
            }`}
            style={{ top: NODE_TOP, left: (RAIL_WIDTH - NODE) / 2, width: NODE, height: NODE }}
          >
            {row.seq}
          </span>
          {row.saved ? (
            // Drawn on the node's corner, and — as on the RN rail — the node itself is unchanged, so a saved
            // stop still scans as an ordinary sequence node with a flag on it (ADR-042).
            //
            // **Two stars, not one**: a slightly larger `--surface` one behind the accent one, which is what
            // gives the flag its outline and makes it read as a bordered sticker over the rail rather than a
            // disc floating on it. The RN overlay does the same with `BADGE = 15`, and draws it *after* the
            // bus tokens for a stated reason — a passing bus must not hide a rider's favourite. `z-10` is
            // this renderer's equivalent, since the star lives inside the row rather than in an overlay pass.
            <span
              className="pointer-events-none absolute z-10 flex items-center justify-center"
              style={{
                top: NODE_TOP - 6,
                left: (RAIL_WIDTH - NODE) / 2 + NODE - 9,
                width: 15,
                height: 15,
              }}
            >
              <Star size={15} className="absolute fill-surface text-surface" aria-hidden />
              <Star size={11} className="absolute fill-accent text-accent" aria-hidden />
            </span>
          ) : null}
        </span>

        <span className="min-w-0 flex-1 pt-3 pr-4 pb-4">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0 flex-1">
              <StopName name={row.name} emphasis={here} />
            </span>
            {row.fareLabel ? (
              <span className="shrink-0 text-caption text-subtle tabular-nums">
                {row.fareLabel}
              </span>
            ) : null}
          </span>
          {row.arrivals.length > 0 ? (
            <span className="mt-1 flex flex-wrap items-baseline gap-x-3">
              {row.arrivals.map((arrival, slot) => (
                // Keyed on the arrival's own timestamp, which is why the model carries it: a bus keeps its slot
                // when the round refreshes rather than the third time sliding into the first slot's box.
                <ArrivalSlot key={arrival.iso} arrival={arrival} first={slot === 0} />
              ))}
            </span>
          ) : null}
          {row.incomplete ? (
            // **Why a row says this and the screen does not.** A live route watch asks each pole separately, so
            // one kerb can refuse while the other forty answer (ADR-116) — and `liveArrivals`, which is the
            // screen-level sentence, cannot express that without lying in one direction or the other. The same
            // words a card uses for the same fact (ADR-077), in the same muted label as every other secondary
            // line here, because it is an explanation and not an alarm.
            //
            // **Beside the times rather than instead of them**, which is not a layout choice: a refused pole
            // keeps its *previous* readings (`retainFailedPoles`, ADR-073), so the honest render is the ageing
            // time and the reason it is not moving. Drawing only the time hides the outage; drawing only the
            // sentence throws away the rider's last known bus.
            <span className="mt-1 block text-label text-muted">{t(locale, 'etasUnavailable')}</span>
          ) : null}
        </span>
      </button>
      {tokens}
    </div>
  )
}

/**
 * Urgency → tone, the DOM's own table. A deliberate duplicate of the RN row's, and the correct kind: both map
 * a kernel *name* to their platform's colour system, which is what a native client will also do. What must
 * never be duplicated is the number that decides which name (ADR-053) — that is `etaUrgency`'s, and neither
 * renderer sees it.
 */
const TONE: Record<EtaUrgency, string> = {
  due: 'text-positive',
  soon: 'text-warning',
  normal: 'text-text',
  none: 'text-muted',
}

/**
 * One arrival on a stop row: the figure and its unit, the status word, or a dash.
 *
 * Written here rather than reusing `EtaBadge` because that component is sized for a card's right-hand side
 * (an `h2` figure), and a schematic row carries up to three of them on one line. The **text nodes are
 * identical** either way, which is what the spec pins; the sizes are this row's business.
 *
 * Staleness dims and does not recolour (ADR-008: never colour alone) — and the value itself does not move,
 * because a reading only changes when a fresh one arrives.
 *
 * **Exported for the action sheet** (ADR-115), which shows this route's times at one stop when the route view
 * has none of its own. Not for reuse in general: it is exported so there is exactly ONE renderer of a route
 * arrival rather than a third copy of the same three arms. The sheet's own docblock records what nearly
 * happened when a stop's *name* was written twice eleven lines apart; a time is worse.
 */
export function ArrivalSlot({ arrival, first }: { arrival: RouteStopArrival; first: boolean }) {
  const { label } = arrival
  const tone = first ? (TONE[arrival.urgency] ?? TONE.none) : 'text-muted'
  const size = first ? 'text-body font-semibold' : 'text-caption'
  return (
    <span className="flex items-baseline gap-1">
      {label.kind === 'mins' ? (
        <>
          {/* `String(...)` because a schematic arrival carries its minutes as a number where the card's
              `EtaLabelParts` carries a string — the odometer diffs characters, so it takes the rendered
              form rather than the value's own type. */}
          <SlideNumber value={String(label.value)} className={`tabular-nums ${size} ${tone}`} />
          <span className={`${first ? 'text-caption' : 'text-caption'} text-muted`}>
            {label.unit}
          </span>
        </>
      ) : label.kind === 'due' ? (
        <SlideNumber value={label.label} className={`tabular-nums ${size} ${tone}`} />
      ) : label.kind === 'headway' ? (
        <span className="text-caption text-subtle">{label.text}</span>
      ) : (
        <span className={`tabular-nums ${size} ${tone}`}>—</span>
      )}
    </span>
  )
}

/** The flip cascade's beat and its cap — `apps/mobile`'s `Math.min(index, 10) * 26`, value for value. */
const CASCADE_STEP = 26
const CASCADE_CAP = 10
