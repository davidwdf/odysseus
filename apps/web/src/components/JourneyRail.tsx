import { RotateCw } from 'lucide-react'
import { JOURNEY_SLOT } from './JourneyLines'

/**
 * **The route header's from/to column: the schematic, two rows tall** (ADR-170).
 *
 * A terminus square at each end carrying its sequence number, the route line between them, and one double
 * chevron on it. Every mark and every number is `RouteStopRow`'s, at the size a header can hold:
 *
 *  · **A square is a terminus**, and it is the same square three other places draw — the map's marker, the
 *    schematic's node and (since ADR-167) the direction-swap glyph. `NODE_SHAPE.terminus` is where the
 *    shape comes from; a circle here would have been a fourth vocabulary for a fact a rider has learnt
 *    twice already.
 *  · **Filled `surface`, stroked `route`** — inverted against the line rather than matched to it, because
 *    a node in the line's own colour disappears into it.
 *  · **The stroke is a hairline at 1.5**, where the line is 4. A node is a shape and the line is a stroke
 *    (ADR-163); matching them would put a ring round the numeral and leave it no middle.
 *  · **The chevron's apexes are 5.3 apart for a 2 px stroke**, which is the ratio that keeps the pair
 *    reading as `> >` rather than `>>` — the number the rail arrived at by measuring the map's.
 *
 * ## The numbers are the point, not a flourish
 *
 * A rider who reads *"34"* beside the destination meets the same square with the same figure at the bottom
 * of the list, and the map draws it a third time on the focused marker. That is ADR-162's argument for the
 * marker's numeral, one screen up — and it is why the figures come from `header.originSeq` /
 * `header.destinationSeq` rather than from indexing the stop list here: the wire's `seq` is not the array
 * index, and a header that counted rows would print a figure the list beside it disagrees with.
 *
 * ## A loop keeps its two nodes and changes what is between them
 *
 * On a circular route the first and last rows are the **same pole** (ADR-046), and the first instinct —
 * collapse the column to a single loop glyph — turned out to say the wrong thing twice: the list still
 * has a row 1 and a row 12, and the spec declares both figures, so a column with no numbers on it is a
 * header that has stopped agreeing with the list beside it.
 *
 * What is actually different about a loop is not its ends but its **middle**, so that is what changes:
 * two numbered squares as always, and the double chevron between them becomes the loop glyph. The squares
 * say *these are the two ends of the list*; the mark between them says what the journey does — onward, or
 * back to where it started. That is the same division `routeDetailView` makes in words, where the second
 * name becomes *"Circular via …"* rather than disappearing.
 *
 * ## Why it is a sibling of `JourneyLines` rather than part of it
 *
 * The flip animates the two names between two slots; this column does not move. Keeping it outside means
 * the animation has one subject and the rail has none, and it keeps `JourneyLines` at exactly two text
 * nodes at rest — the property `journey-swap.test.tsx` exists to hold. The two share `JOURNEY_SLOT`, so
 * there is one declaration of where a row's centre is.
 */
export function JourneyRail({
  fromSeq,
  toSeq,
  circular,
}: {
  /** The first stop's sequence number, from the kernel's header. */
  fromSeq: number | undefined
  toSeq: number | undefined
  circular: boolean
}) {
  // Nothing to number is nothing to draw: an empty payload has no ends, and a rail with no nodes on it
  // would be a line claiming a journey the header cannot name.
  if (fromSeq === undefined || toSeq === undefined) return null

  return (
    <span className="relative block shrink-0" style={{ width: NODE, height: JOURNEY_SLOT.height }}>
      <svg
        width={NODE}
        height={JOURNEY_SLOT.height}
        viewBox={`0 0 ${NODE} ${JOURNEY_SLOT.height}`}
        aria-hidden="true"
        className="absolute inset-0"
      >
        <path
          d={`M${NODE / 2} ${TOP_CY} V${BOTTOM_CY}`}
          className="stroke-route-soft"
          strokeWidth={4}
          fill="none"
        />
        {circular ? null : (
          <g
            className="stroke-route"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            <path
              d={`M${NODE / 2 - 2.8} ${MID - 4.2} ${NODE / 2} ${MID - 1.4} ${NODE / 2 + 2.8} ${MID - 4.2}`}
            />
            <path
              d={`M${NODE / 2 - 2.8} ${MID + 1.1} ${NODE / 2} ${MID + 3.9} ${NODE / 2 + 2.8} ${MID + 1.1}`}
            />
          </g>
        )}
        <rect
          x={0.75}
          y={0.75}
          width={NODE - 1.5}
          height={NODE - 1.5}
          className="fill-surface stroke-route"
          strokeWidth={1.5}
        />
        <rect
          x={0.75}
          y={JOURNEY_SLOT.height - NODE + 0.75}
          width={NODE - 1.5}
          height={NODE - 1.5}
          className="fill-surface stroke-route"
          strokeWidth={1.5}
        />
      </svg>
      {circular ? (
        // The loop, in the line's own colour, on the line's own background — `bg-bg` rather than a
        // transparent glyph so the 4 px rail does not run through the middle of it.
        <span
          aria-hidden="true"
          className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex items-center justify-center rounded-full bg-bg text-route"
          style={{ width: 16, height: 16 }}
        >
          <RotateCw size={13} aria-hidden />
        </span>
      ) : null}
      {/*
        The two figures, as **text nodes over the drawing** rather than SVG `<text>` inside it — the same
        arrangement `RouteStopRow` uses for a node's number, and for a better reason than symmetry: these
        are declared content (`originSeq`/`destinationSeq` in `route-detail.spec.json`), so they have to
        be text a projection can read — and a projection reads text nodes, not SVG geometry. The
        **drawing** is `aria-hidden` and the **figures** are not: a screen reader gets the two numbers and
        the two names, and no description of a square.
      */}
      <span
        className="absolute inset-x-0 flex items-center justify-center text-caption font-medium text-route tabular-nums"
        style={{ top: 0, height: NODE }}
      >
        {fromSeq}
      </span>
      <span
        className="absolute inset-x-0 flex items-center justify-center text-caption font-medium text-route tabular-nums"
        style={{ top: JOURNEY_SLOT.height - NODE, height: NODE }}
      >
        {toSeq}
      </span>
    </span>
  )
}

/** The node's side, which is also the row's height — one number, from `JourneyLines`. */
const NODE = JOURNEY_SLOT.slot
const TOP_CY = NODE / 2
const BOTTOM_CY = JOURNEY_SLOT.height - NODE / 2
const MID = JOURNEY_SLOT.height / 2
