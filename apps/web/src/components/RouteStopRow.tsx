import type { EtaUrgency, RouteStopArrival, RouteStopRowView } from '@nextbus/core'
import { Star } from 'lucide-react'
import { useState } from 'react'
import { RAIL_WIDTH } from './RailBusToken'
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
  onPress: (row: RouteStopRowView) => void
  /** Reports this row's element so the rail overlay can place a bus at its node — geometry, not a decision. */
  registerRow: (index: number, el: HTMLElement | null) => void
}) {
  const { here, first, last } = row
  // **Read once, at mount** — `useState`'s initial value is ignored on every later render, which is exactly
  // what the RN row gets from `useSharedValue(animateIn ? 0 : 1)` plus an effect with empty deps.
  //
  // Not a micro-optimisation. The nonce advances on the *tap*, and the reverse payload lands a tick later,
  // so for that tick the rows still on screen are the current direction's — and adding an animation class to
  // a mounted element *starts* it. Without this the outbound list blinks out and back in before the inbound
  // list arrives. A flip animates the rows that mount fresh because of it, and nothing else.
  const [rise] = useState(animateIn)
  return (
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
            <span className="shrink-0 text-caption text-subtle tabular-nums">{row.fareLabel}</span>
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
      </span>
    </button>
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
 */
function ArrivalSlot({ arrival, first }: { arrival: RouteStopArrival; first: boolean }) {
  const { label } = arrival
  const tone = first ? (TONE[arrival.urgency] ?? TONE.none) : 'text-muted'
  const size = first ? 'text-body font-semibold' : 'text-caption'
  return (
    <span className={`flex items-baseline gap-1 ${arrival.stale ? 'opacity-45' : ''}`}>
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

/** The node's size and where its centre falls — the connectors meet it there. */
const NODE = 26
const NODE_TOP = 12
const NODE_CENTRE = NODE_TOP + NODE / 2

/** The flip cascade's beat and its cap — `apps/mobile`'s `Math.min(index, 10) * 26`, value for value. */
const CASCADE_STEP = 26
const CASCADE_CAP = 10
