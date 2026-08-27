import type { RailBus, RouteVehicle, StopMarkerKind } from '@nextbus/core'
import { useLayoutEffect, useRef } from 'react'
import { BusGlyph } from './BusGlyph'

/**
 * A bus riding the route schematic's rail — the DOM twin of `apps/mobile/components/BusToken.tsx`.
 *
 * **`role="img"` with an `aria-label`, and the label is the kernel's** (`RailBus.label`). Without a name a
 * disc with a glyph in it is nothing to a screen reader, which is what the RN token was until WP6-6a: a spec's
 * vocabulary is text, so the conformance walker could not see the tokens at all, and the honest fix was to
 * name them rather than exempt them (ADR-093 decision 3). It is `aria-hidden`-free and `pointer-events: none`
 * for the same reason as the RN one — read, never focused, because it is not a control.
 *
 * **It bobs, and it draws the app's own double-decker** — both of which this file previously argued against.
 * It said the idle motion was "deliberately absent … the invariant/idiom line rather than laziness", citing
 * ADR-075's *"curve, duration, physics, whether it moves at all"*. ADR-100 moves that line: the app's
 * signature motion and material are identity, and a bobbing double-decker riding the rail is the single most
 * recognisable thing this app draws. The glyph was never a decision at all — `docs/09-theme.md` has named
 * `BusGlyph` since Wave 1 and this drew Lucide's stock `BusFront`.
 *
 * The motion is the RN token's, constant for constant, in `index.css`: the disc is static and only the glyph
 * bobs (±0.5 px), rocks (±6°) and squashes (6%, anchored at the wheels) on two clocks. What is **not** idiom
 * — which node the bus is at — is `routeDetailView.buses`', and both renderers read it from there.
 *
 * ## Where it sits is CSS, and that is the whole of ADR-110
 *
 * The token belongs to a single row, and its `top` is one of two constant expressions against that row:
 *
 *  · a bus **at** node N is `top: 13px` in row N — `NODE_CENTRE` (25) less half a token (12);
 *  · a bus **on the segment** into node N is `calc(50% + 13px)` in row **N−1**, because the midpoint of two
 *    adjacent nodes is exactly half a row below the first. `railBus` only ever emits `from: toIndex − 1`, so
 *    a segment is *always* between adjacent nodes and there is no third case.
 *
 * It used to be an overlay whose `top` was a measured row offset kept fresh by a `ResizeObserver`, which put
 * a bus in the wrong place twice (ADR-108). Nothing is measured now and nothing can go stale — what a
 * refetch reflows, the token reflows with. The travel that a re-parent costs is bought back by
 * `useRailFlip`.
 *
 * **It is the row button's sibling, never its child**, which is `RouteStopRow`'s wrapper's whole purpose: a
 * labelled `role="img"` inside a `<button>` is folded into that button's accessible name, so a nested token
 * turns *"Nathan Road · 3 min"* into *"Nathan Road · 3 min · Bus approaching Nathan Road"*. Measured in
 * Chrome's accessibility tree; `pointer-events: none` does not exempt it, and no suite here can see it,
 * because the projection reads text nodes and token labels in two separate passes.
 */
export function RailBusToken({
  bus,
  ordinal,
  shape = 'stop',
  vehicle = 'bus',
}: {
  bus: RailBus
  ordinal: number
  /**
   * The shape of the node this bus is standing at, so the token matches it (see {@link TOKEN_SHAPE}).
   * Defaults to `stop` — a disc — which is what a bus on a segment gets and what every caller that has
   * no opinion should leave it as.
   */
  shape?: StopMarkerKind
  /**
   * Which vehicle to draw — the kernel's word, never this component's guess. `routeVehicle` decides it from
   * the operator, because selecting on data and reaching into an id are both things a view may not do.
   */
  vehicle?: RouteVehicle
}) {
  const disc = useRef<HTMLSpanElement>(null)
  /**
   * Put this token's three idle clocks on the **document's** timeline rather than on its own element's age.
   *
   * A bus that moves between rows is a new element, so its bob, rock and squash would restart from their
   * `from` keyframes: the rock snaps up to 12° in a single frame, at exactly the moment the rider's eye is
   * on the token because it just moved. Anchoring `startTime` to the timeline origin makes the phase a pure
   * function of the current time, identical for a token created this frame and one drawn a minute ago — so
   * a re-parent is invisible, and a wart that predates this change closes with it: a bus appearing
   * mid-session used to bob out of step with the ones already on the rail, for ever.
   *
   * `{ subtree: true }` is required — the animations are on the three child spans, not on this element.
   * Empty deps, so it runs once per created element, and it runs *before* the screen's FLIP effect (a
   * child's layout effects run before its parent's), which is why that animation is never in this list.
   * Optional-chained for jsdom, exactly as `BottomSheet` is and for the same reason.
   */
  useLayoutEffect(() => {
    const el = disc.current
    if (el === null) return
    for (const animation of el.getAnimations?.({ subtree: true }) ?? []) animation.startTime = 0
  }, [])
  return (
    <span
      ref={disc}
      role="img"
      aria-label={bus.label}
      // Its identity across a commit, for `useRailFlip` — the ordinal `view.buses` gives it, which is the
      // identity `key` has used since ADR-030. In the DOM rather than in a registry, because a re-parented
      // token is a *different element* and there is nothing else to compare across the move.
      data-bus-ordinal={ordinal}
      /*
        **Where it is along the route, as one number** — a node is its own index, a segment is the half-step
        between the two it spans. `useRailFlip` reads it for two separate questions and it is worth knowing
        that they are separate:

         · **identity** — unchanged means the list reflowed underneath a stationary bus, not that the bus
           moved, so there is nothing to animate;
         · **plausibility** — a bus travels *forward* along a route, so a token that would have to come from
           much further down the rail is not the same bus. That is what stops the re-index (ADR-030's ordinal
           identity) from sliding a bus that reached the terminus back up to the origin.

        A single ordered coordinate answers both, where the ordinal answers neither.
      */
      data-bus-at={bus.kind === 'node' ? bus.index : bus.from + HALF_STEP}
      {...{ [BUS_SHAPE_ATTR]: shape }}
      className="bus-shape pointer-events-none absolute flex items-center justify-center bg-accent"
      style={{
        // **A custom property, not `clip-path` itself**, and that indirection is what makes the morph
        // possible. `useRailFlip` starts a travelling token at the shape it is leaving by writing an
        // inline `clip-path`, then clears it — and clearing has to fall back to the *destination*
        // shape, which it cannot do if the destination is the very declaration being cleared. The
        // stylesheet reads `clip-path: var(--bus-clip)`, so the inline value is an override and the
        // variable is the resting truth.
        //
        // `clip-path` at all — rather than `border-radius` — because a clip is what one shape can
        // become another through. Safe here where it would not be on the rail node: the token is a
        // flat fill with no outline for a clip to cut away.
        ...({ '--bus-clip': TOKEN_CLIP[shape] } as React.CSSProperties),
        top: bus.kind === 'node' ? AT_NODE : ON_SEGMENT,
        left: RAIL_WIDTH / 2 - TOKEN / 2,
        width: TOKEN,
        height: TOKEN,
        zIndex: TOKEN_Z,
      }}
    >
      {/* Three nested spans because three transforms run on three clocks and CSS allows one `transform`
          per element.

          **The bob is outermost and the rock inside it, which is not the obvious order.** The RN token
          writes `transform: [translateY, rotateZ]` on one view, and a transform list composes left-to-right
          — translate applied *last*. Nested elements compose outermost-last, so matching that means the
          translate has to be the outer span. With the rock outside, the bob's 0.75 px was itself rotated by
          up to 6°, which showed up as a measured ±0.11 px sideways wobble on a glyph that should only ever
          move vertically. Free to fix, and it removes a divergence rather than adding one.

          The disc itself is deliberately left with no transform, which is what leaves it free to carry the
          travel — see `useRailFlip`. */}
      <span className="bus-bob flex">
        <span className="bus-rock flex">
          <span className="bus-squash flex text-accent-contrast">
            <BusGlyph vehicle={vehicle} size={TOKEN * 0.66} />
          </span>
        </span>
      </span>
    </span>
  )
}

/**
 * The rail's geometry — layout, and the DOM screen's own numbers (ADR-093, where a 52 px RN rail and a
 * 44 px DOM gutter reach the same answer from different constants). Declared once, here, because both the
 * row that draws the node and the token that rides it need the same centre line.
 */
export const RAIL_WIDTH = 44
/**
 * **The token wears the shape of the node it is standing at** — a square at a terminus, a hexagon at an
 * interchange, a disc everywhere else — so the map, the rail and the bus all speak one vocabulary.
 *
 * Only where the bus is **at a node**. A bus on the segment *between* two stops is at no stop at all,
 * and giving it the shape of one it has not reached would be the token making a claim the data does not
 * support — the same reason it sits at a midpoint rather than a fraction of the way along (ADR-030).
 * Those stay discs, which is also the shape they have always had.
 *
 * ## Why all three are 24-point polygons
 *
 * So they can **morph into one another**. A browser interpolates `clip-path: polygon()` only between
 * polygons with the same number of points, so a disc drawn as `border-radius` and a hexagon drawn as
 * six vertices cannot tween — there is no correspondence between them to animate. Giving every shape
 * the same 24 vertices, with the extra ones spread evenly along each edge, creates that correspondence:
 * a square's edge midpoints slide out into a circle's arc, a hexagon's into its own.
 *
 * 24 because it divides by 4 and by 6, and because at 26 px a 24-gon is a disc — no eye can find the
 * flats, and generating them from `cos`/`sin` in a build step would be three constants' worth of
 * machinery to save nothing.
 */
const TOKEN_CLIP: Record<StopMarkerKind, string> = {
  stop: 'polygon(100.00% 50.00%, 98.30% 62.94%, 93.30% 75.00%, 85.36% 85.36%, 75.00% 93.30%, 62.94% 98.30%, 50.00% 100.00%, 37.06% 98.30%, 25.00% 93.30%, 14.64% 85.36%, 6.70% 75.00%, 1.70% 62.94%, 0.00% 50.00%, 1.70% 37.06%, 6.70% 25.00%, 14.64% 14.64%, 25.00% 6.70%, 37.06% 1.70%, 50.00% 0.00%, 62.94% 1.70%, 75.00% 6.70%, 85.36% 14.64%, 93.30% 25.00%, 98.30% 37.06%)',
  terminus:
    'polygon(85.36% 85.36%, 73.57% 85.36%, 61.79% 85.36%, 50.00% 85.36%, 38.21% 85.36%, 26.43% 85.36%, 14.64% 85.36%, 14.64% 73.57%, 14.64% 61.79%, 14.64% 50.00%, 14.64% 38.21%, 14.64% 26.43%, 14.64% 14.64%, 26.43% 14.64%, 38.21% 14.64%, 50.00% 14.64%, 61.79% 14.64%, 73.57% 14.64%, 85.36% 14.64%, 85.36% 26.43%, 85.36% 38.21%, 85.36% 50.00%, 85.36% 61.79%, 85.36% 73.57%)',
  interchange:
    'polygon(100.00% 50.00%, 93.75% 60.83%, 87.50% 71.65%, 81.25% 82.48%, 75.00% 93.30%, 62.50% 93.30%, 50.00% 93.30%, 37.50% 93.30%, 25.00% 93.30%, 18.75% 82.48%, 12.50% 71.65%, 6.25% 60.83%, 0.00% 50.00%, 6.25% 39.17%, 12.50% 28.35%, 18.75% 17.52%, 25.00% 6.70%, 37.50% 6.70%, 50.00% 6.70%, 62.50% 6.70%, 75.00% 6.70%, 81.25% 17.52%, 87.50% 28.35%, 93.75% 39.17%)',
}

/** The attribute a token carries its shape in, so `useRailFlip` can see what it is morphing *from*. */
export const BUS_SHAPE_ATTR = 'data-bus-shape'

/** The polygons, exported so the travel can start a token at the shape it is leaving. */
export { TOKEN_CLIP }

export const NODE = 26
export const NODE_TOP = 12
export const NODE_CENTRE = NODE_TOP + NODE / 2
const TOKEN = 24

/** A segment sits midway between the nodes it spans — see `data-bus-at`. */
const HALF_STEP = 0.5

/**
 * The two resting places, as CSS.
 *
 * `NODE_CENTRE` is 25 (`NODE_TOP` 12 + half of a 26 px node) and half a token is 12, so a bus on a node sits
 * 13 px down its own row. The segment case adds half the *from* row, which is what `50%` is — and it is a
 * percentage rather than a number precisely so that a row growing an arrivals line moves the bus with it.
 */
const AT_NODE = `${NODE_CENTRE - TOKEN / 2}px`
const ON_SEGMENT = `calc(50% + ${NODE_CENTRE - TOKEN / 2}px)`

/**
 * Above the rail and the rows' own backgrounds, and **below the saved-stop star's `z-10`**.
 *
 * Both halves are needed. A segment token overhangs its row by 5 px on a `min-h-16` row — which is correct
 * geometry, since the midpoint of two node centres genuinely falls below the first row's box — and without
 * a z-index the next row's rail connector slices the disc flat. The upper bound is ADR-042's rule, and the
 * reason `apps/mobile` draws its stars in a later overlay pass: a passing bus must not hide a favourite.
 */
const TOKEN_Z = 5
