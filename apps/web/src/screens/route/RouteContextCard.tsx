import type { RouteDetailView } from '@nextbus/core'
import { forwardRef, type ReactNode, useRef } from 'react'
import { useFlip } from '../../hooks/useFlip'
import { BACK_LENS_INSET, BACK_LENS_SIZE } from '../../shell/BackButton'
import { CONTENT_INSET_TOP } from '../../shell/layout'

/**
 * **The route's identity, floating over the map** — round 4 of the mockups, which was the owner's own
 * counter-proposal and the shape the design settled on (`docs/proposals/06 §8`).
 *
 * Two states, and what separates them is *what the rider is doing*:
 *
 * | | |
 * |---|---|
 * | **Expanded** | Full width, tucked **behind** the floating back lens, with a large badge and the route's facts. What you get on arrival, when the question is "what am I looking at". |
 * | **Collapsed** | A pill starting to the **right** of the lens, taking the width that is left. What you get once the rider has begun reading the map or the list — the question has become "where does this go", and the card is in the way of the answer. |
 *
 * The collapse is not the expanded card shrinking in place: it **steps aside**. Expanded, the card
 * runs under the lens and a large centred badge pushes the destination clear of it; collapsed, its
 * left edge moves past the lens entirely, so the pill is a clean rectangle rather than a shape with a
 * bite out of it. That is the part the mockup got right and the reason to copy it exactly.
 *
 * ## Why this is its own file
 *
 * It is one of four things Route detail is made of, and the alternative is a screen that owns a map, a
 * sheet, a rail, a header and their interactions at once. Handed a view model and a boolean, this
 * renders — no queries, no effects, and no knowledge of the sheet that collapses it.
 */
export function RouteContextCard({
  header,
  journey,
  swap,
  facts,
  collapsed,
  onExpand,
  expandLabel,
}: {
  header: RouteDetailView['header']
  /**
   * Both ends of the journey — origin above, destination below — rendered by the screen so this file
   * stays free of the flip's lyrics-style swap and of the circular-route wording (ADR-046).
   *
   * **Expanded only, and the origin is why.** The collapsed pill is a reminder, and what a rider needs
   * reminding of is where they are *going*; the origin is behind them. It is also a declared slot in
   * `route-detail.spec.json`, so dropping it from the screen entirely would be a real reduction rather
   * than a layout choice — it moves out of sight when collapsed, not out of the document.
   */
  journey: ReactNode
  /** The reverse-direction control. Expanded only: a pill has room for the destination and nothing else. */
  swap?: ReactNode
  /** The facts strip, already rendered by the screen — this decides only whether there is room. */
  facts?: ReactNode
  collapsed: boolean
  /** Tapping a collapsed pill expands it again. Ignored while expanded. */
  onExpand: () => void
  /** The collapsed pill's accessible name — its content is a badge and a place, neither of which says
   *  what pressing it does. */
  expandLabel: string
}) {
  const badge = useRef<HTMLSpanElement | null>(null)
  // The badge travels between the two layouts rather than being re-drawn in each. See `useFlip`.
  useFlip(badge, collapsed ? 'pill' : 'card')

  // Clear of the lens when collapsed, running underneath it when expanded. One number, two states.
  const left = collapsed ? BACK_LENS_INSET * 2 + BACK_LENS_SIZE : BACK_LENS_INSET

  return (
    <div
      className="pointer-events-none fixed right-3 z-20"
      style={{
        top: `calc(${CONTENT_INSET_TOP} + 12px)`,
        left,
        transition: 'left 240ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {/*
        **One card element in both states, with the collapsed tap target as an overlay** — not a
        `<button>` swapped for a `<div>`, which is what this was.

        The expanded card *contains* controls (the swap link, the fact pills) and a button cannot
        contain a button (ADR-024), so the card itself cannot be the target. An absolutely positioned
        overlay gives the collapsed state a full-size one without nesting anything.

        What that buys is the **card**: its radius, padding and `left` are one element's properties
        across the change, so they transition rather than cut. It is *not* what makes the badge travel
        — measured, the badge is a different node on each side, and `useFlip` works anyway because it
        keeps the previous rect rather than the previous element.
      */}
      <div
        className={`glass-pane pointer-events-auto relative flex w-full flex-col overflow-hidden rounded-pill border border-border ${
          collapsed ? 'gap-0 px-3 py-2' : 'gap-2 px-3 pt-3 pb-1'
        }`}
      >
        {collapsed ? (
          <div className="flex w-full items-center gap-2">
            <RouteBadge ref={badge} routeNo={header.routeNo} compact />
            <span className="min-w-0 flex-1 truncate font-semibold text-body text-text">
              {header.destination}
            </span>
            <Chevron direction="down" />
          </div>
        ) : (
          /*
            **A three-column grid, not a centred flex row**, and the difference is the whole point: a
            flex row centres the *group* — badge plus swap — which leaves the badge left of the card's
            middle by half the swap's width, and the swap sitting next to it instead of at the edge.
            Fixed side columns the width of the back lens put the badge dead centre and balance the
            lens against the swap, so the row reads as chrome at both ends with the number between them.

            The badge is **the back lens's height**, which is what buys the line below it the card's
            whole width: a badge that shares a line with the journey takes a third of it, and HK
            destination names need all of it.
          */
          <div
            className="grid w-full items-center gap-2"
            style={{ gridTemplateColumns: `${BACK_LENS_SIZE}px 1fr ${BACK_LENS_SIZE}px` }}
          >
            <span aria-hidden="true" />
            <span className="flex justify-center">
              <RouteBadge ref={badge} routeNo={header.routeNo} />
            </span>
            <span className="flex justify-end">{swap}</span>
          </div>
        )}

        {collapsed ? null : (
          <>
            {/* The journey gets its own line and the **whole width** of it — which is the point of
                putting the badge on its own row. HK destination names are long, and a name that has to
                share a line with a badge and a control loses a third of the space it needs. */}
            <div className="w-full text-center">{journey}</div>
            {/* Centred, because the strip is a row of facts about the route rather than a list that
                begins somewhere — ragged-left pills under a centred journey read as a mistake. */}
            {facts ? <div className="flex w-full justify-center">{facts}</div> : null}
            {/* Pointing UP while expanded: the affordance is symmetrical, so a rider who found the
                card by tapping the chevron can put it away the same way. */}
            <Chevron direction="up" />
          </>
        )}

        {collapsed ? (
          <button
            type="button"
            onClick={onExpand}
            aria-label={expandLabel}
            className="absolute inset-0 cursor-pointer border-0 bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          />
        ) : null}
      </div>
    </div>
  )
}

/**
 * The expand/collapse hint — **wide and muted**, so it reads as an edge of the card rather than as a
 * control competing with the badge beside it.
 *
 * A chevron over a "menu" or "expand" glyph because it is the only one of the three that says which
 * *way*: a rider seeing it pointing down learns both that something is hidden and where it will come
 * from. The other two say only "there is more", which they can already guess.
 */
function Chevron({ direction }: { direction: 'up' | 'down' }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none flex shrink-0 justify-center text-subtle ${
        direction === 'down' ? '' : 'w-full'
      }`}
    >
      {/*  on the SVG as well as its wrapper: the hint is decoration, and the control it
          hints at carries its own name. A <title> here would announce "chevron" to a screen reader,
          which is the glyph rather than the meaning. */}
      <svg
        aria-hidden="true"
        width="28"
        height="10"
        viewBox="0 0 28 10"
        fill="none"
        stroke="currentColor"
      >
        <path
          d={direction === 'down' ? 'M2 2.5 L14 7.5 L26 2.5' : 'M2 7.5 L14 2.5 L26 7.5'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

/**
 * The route number, at the two sizes the card has — and it is **one element**, forwarded a ref, so it
 * can travel between them (`useFlip`).
 *
 * Expanded it is sized to the back lens: same height, so the two read as one row of chrome and the
 * journey below gets the card's whole width. Collapsed it is the pill's own height.
 */
const RouteBadge = forwardRef<HTMLSpanElement, { routeNo: string; compact?: boolean }>(
  function RouteBadge({ routeNo, compact = false }, ref) {
    return (
      <span
        ref={ref}
        className={`flex shrink-0 items-center justify-center rounded-md bg-accent font-semibold text-accent-contrast tabular-nums ${
          compact ? 'h-7 px-2 text-body' : 'px-3 text-title'
        }`}
        style={compact ? undefined : { height: BACK_LENS_SIZE, minWidth: BACK_LENS_SIZE }}
      >
        {routeNo}
      </span>
    )
  },
)
