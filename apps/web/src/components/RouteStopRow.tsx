import type { EtaUrgency, RouteStopArrival, RouteStopRowView } from '@nextbus/core'
import { Star } from 'lucide-react'
import { RAIL_WIDTH } from './RailBusToken'
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
  onPress,
  registerRow,
}: {
  row: RouteStopRowView
  /** Position in the list — what `RailBus`'s `index`/`from`/`to` name. */
  index: number
  onPress: (row: RouteStopRowView) => void
  /** Reports this row's element so the rail overlay can place a bus at its node — geometry, not a decision. */
  registerRow: (index: number, el: HTMLElement | null) => void
}) {
  const { here, first, last } = row
  return (
    <button
      type="button"
      ref={(el) => registerRow(index, el)}
      onClick={() => onPress(row)}
      // `scroll-mt` is the whole of this renderer's auto-scroll: `scrollIntoView` then lands the boarding row
      // below the sticky header without this screen computing an offset, and honours the rider's
      // reduced-motion setting without owning that decision either (ADR-045 is idiom). 7rem clears the
      // header — measured in a browser at 112 px, where 5rem left the anchored row half under it.
      className={`relative flex w-full scroll-mt-28 gap-0 border-0 border-border border-b bg-transparent px-0 py-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
        here ? 'bg-surface-2' : ''
      }`}
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
          <Star
            size={13}
            className="absolute fill-accent text-accent"
            style={{ top: NODE_TOP - 4, left: (RAIL_WIDTH - NODE) / 2 + NODE - 8 }}
            aria-hidden
          />
        ) : null}
      </span>

      <span className="min-w-0 flex-1 pt-3 pr-4 pb-4">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 flex-1">
            <StopName name={row.name} />
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
          <span className={`tabular-nums ${size} ${tone}`}>{label.value}</span>
          <span className={`${first ? 'text-caption' : 'text-caption'} text-muted`}>
            {label.unit}
          </span>
        </>
      ) : label.kind === 'due' ? (
        <span className={`tabular-nums ${size} ${tone}`}>{label.label}</span>
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
