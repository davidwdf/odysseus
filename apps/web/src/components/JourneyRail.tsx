import { RotateCw } from 'lucide-react'
import { useId } from 'react'
import { JOURNEY_SLOT } from './JourneyLines'
import {
  RAIL_CHEVRON_H,
  RAIL_CHEVRON_PATHS,
  RAIL_CHEVRON_STROKE,
  RAIL_CHEVRON_W,
} from './railGlyphs'
import { SlideNumber } from './SlideNumber'

/**
 * **The route header's from/to column: the schematic, two rows tall** (ADR-170).
 *
 * A terminus square at each end carrying its sequence number, the route line between them, and one double
 * chevron on it. Every mark and every number is `RouteStopRow`'s, at the size a header can hold:
 *
 *  · **The marks are smaller than the list's**, and that is the one proportion deliberately not copied: a
 *    26 px node with a 12 px numeral is right in a 64 px row and overpowering in a header, where it is the
 *    quiet half of a line of type. 18 px with an 11 px figure keeps the *shape* and gives up the weight.
 *  · **A square is a terminus**, and it is the same square three other places draw — the map's marker, the
 *    schematic's node and (since ADR-167) the direction-swap glyph. `NODE_SHAPE.terminus` is where the
 *    shape comes from; a circle here would have been a fourth vocabulary for a fact a rider has learnt
 *    twice already.
 *  · **Filled `surface`, stroked `route`** — inverted against the line rather than matched to it, because
 *    a node in the line's own colour disappears into it.
 *  · **The stroke is a hairline at 1.5**, where the line is 4. A node is a shape and the line is a stroke
 *    (ADR-163); matching them would put a ring round the numeral and leave it no middle.
 *  · **The chevron is the list's**, not a drawing that resembles it: `railGlyphs.ts` holds the one shape and
 *    both rails cut it (ADR-171). The owner asked for exactly this, and one declaration is the only way to
 *    promise it — two hand-drawn pairs agree until someone adjusts one.
 *  · **…and it is cut out of the line, not drawn on it** (ADR-172). The first build painted it in `route`
 *    because the list paints its notch in the *row's own background* and glass has no background colour to
 *    borrow. An SVG `<mask>` removes the need for one: the arms are painted black in the mask, so the line
 *    is not drawn there at all and what shows through the notch is the map behind the card. That is the
 *    same claim the list makes — *a notch in the line, not a symbol on it* — made honestly on a
 *    translucent surface, and it is what the owner meant by the mark being transparent rather than white.
 *
 * ## The numerals slide, because the rail does not
 *
 * A direction flip changes both figures (31 → 1, 1 → 31) while the two names are still animating between
 * their slots, and a numeral that *cuts* mid-flight is the one mark on the screen contradicting the motion
 * around it. `SlideNumber` is the app's existing answer for a figure that changes — the same component the
 * arrival times use — so the rail borrows it rather than growing a second one. At rest it is one text
 * node, which is what keeps these two declared slots projectable.
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
  // **A per-instance id**, because an SVG `mask` is referenced by a document-wide id and two headers on
  // one page (a lab, a future split view) would otherwise share — and silently agree, until one changed.
  const maskId = useId()
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
        {circular ? null : (
          <defs>
            {/* White keeps the line, black removes it: the arms are drawn black over a white field, so
                the chevron is a hole in the rail rather than a mark on it. `maskUnits` is the default
                (`objectBoundingBox` is for ratios); everything here is in the same user space as the
                line it cuts. */}
            <mask id={maskId} maskUnits="userSpaceOnUse">
              <rect x="0" y="0" width={NODE} height={JOURNEY_SLOT.height} fill="white" />
              <g
                stroke="black"
                strokeWidth={RAIL_CHEVRON_STROKE}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                transform={`translate(${(NODE - RAIL_CHEVRON_W) / 2}, ${MID - RAIL_CHEVRON_H / 2})`}
              >
                {RAIL_CHEVRON_PATHS.map((d) => (
                  <path key={d} d={d} />
                ))}
              </g>
            </mask>
          </defs>
        )}
        <path
          d={`M${NODE / 2} ${TOP_CY} V${BOTTOM_CY}`}
          className="stroke-route-soft"
          strokeWidth={4}
          fill="none"
          {...(circular ? {} : { mask: `url(#${maskId})` })}
        />
        <rect
          x={0.75}
          y={TOP_CY - NODE / 2 + 0.75}
          width={NODE - 1.5}
          height={NODE - 1.5}
          className="fill-surface stroke-route"
          strokeWidth={1.5}
        />
        <rect
          x={0.75}
          y={BOTTOM_CY - NODE / 2 + 0.75}
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
        className="absolute inset-x-0 flex items-center justify-center font-medium text-route tabular-nums"
        style={{ top: TOP_CY - NODE / 2, height: NODE, fontSize: SEQ_FONT, lineHeight: 1 }}
      >
        <SlideNumber value={String(fromSeq)} />
      </span>
      <span
        className="absolute inset-x-0 flex items-center justify-center font-medium text-route tabular-nums"
        style={{ top: BOTTOM_CY - NODE / 2, height: NODE, fontSize: SEQ_FONT, lineHeight: 1 }}
      >
        <SlideNumber value={String(toSeq)} />
      </span>
    </span>
  )
}

/**
 * The node's side. **Smaller than the slot it sits in** — the row is as tall as its type, and the mark is
 * a mark. It is centred in the slot rather than filling it, which is what stops the column reading as two
 * boxes with a line between them.
 */
const NODE = 18
/** Where each node's centre sits: the middle of its own slot, so a name lines up with its number. */
const TOP_CY = JOURNEY_SLOT.slot / 2
const BOTTOM_CY = JOURNEY_SLOT.height - JOURNEY_SLOT.slot / 2
const MID = JOURNEY_SLOT.height / 2
/**
 * The numeral, in px rather than a type step. The scale's smallest is `caption` at 12, which is the list's
 * own figure in a 26 px node; at 18 px the same 12 fills the square edge to edge and the node stops
 * reading as a node. 11 is off the scale on purpose and says so — it is a *mark's* label, not text.
 */
const SEQ_FONT = 11
