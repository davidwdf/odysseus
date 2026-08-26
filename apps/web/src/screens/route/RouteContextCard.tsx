import type { RouteDetailView } from '@nextbus/core'
import type { ReactNode } from 'react'
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
  facts,
  collapsed,
  onExpand,
}: {
  header: RouteDetailView['header']
  /** The facts strip, already rendered by the screen — this decides only whether there is room. */
  facts?: ReactNode
  collapsed: boolean
  /** Tapping a collapsed pill expands it again. Ignored while expanded. */
  onExpand: () => void
}) {
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
      <button
        type="button"
        // Only a target when there is something to do. An expanded card is a label, and a label that
        // reports itself as a control is worse than one that does not: a screen reader offers it, and
        // pressing it does nothing.
        {...(collapsed ? { onClick: onExpand } : { disabled: true, tabIndex: -1 })}
        className={`glass-pane pointer-events-auto flex w-full items-center gap-2 overflow-hidden rounded-lg border border-border text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
          collapsed ? 'h-12 px-3' : 'flex-col px-3 py-3'
        }`}
      >
        <span
          className={`flex items-center gap-2 ${collapsed ? 'w-full' : 'w-full justify-center'}`}
        >
          <span
            className={`shrink-0 rounded-md bg-accent px-2 font-semibold text-accent-contrast tabular-nums ${
              collapsed ? 'text-body' : 'text-title'
            }`}
          >
            {header.routeNo}
          </span>
          <span
            className={`truncate font-semibold text-text ${collapsed ? 'text-body' : 'text-title'}`}
          >
            {header.destination}
          </span>
        </span>
        {/* The facts fold away first: they are what a rider reads once, where the destination is what
            they check repeatedly. */}
        {collapsed ? null : facts}
      </button>
    </div>
  )
}
