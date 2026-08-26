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
  journey,
  swap,
  facts,
  collapsed,
  onExpand,
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
      {/*
        **Collapsed is a button; expanded is not**, and that is structural rather than stylistic. The
        expanded card *contains* controls — the swap link and the fact pills — and a button cannot
        contain a button: it is invalid HTML and folds into one control for a screen reader, which is
        the same rule the row's `⋯` follows (ADR-024). Two elements, one at a time.
      */}
      {collapsed ? (
        <button
          type="button"
          onClick={onExpand}
          className="glass-pane pointer-events-auto flex h-12 w-full items-center gap-2 overflow-hidden rounded-lg border border-border px-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          <RouteBadge routeNo={header.routeNo} compact />
          <span className="truncate font-semibold text-body text-text">{header.destination}</span>
        </button>
      ) : (
        <div className="glass-pane pointer-events-auto flex w-full flex-col gap-2 overflow-hidden rounded-lg border border-border px-3 py-3">
          {/*
            **The badge is centred, not leading**, and that is round 4's actual arrangement rather
            than a preference. The card runs *under* the floating back lens, so anything at its left
            edge is hidden by a 48 px circle — the first build put the badge there and it vanished.
            Centring it also does the other half of the job the mockup describes: it pushes the
            journey text clear of the lens without the card needing to know the lens is there.
          */}
          <div className="flex w-full items-center justify-center gap-2 pl-9">
            <RouteBadge routeNo={header.routeNo} />
            <div className="min-w-0 flex-1 text-center">{journey}</div>
            {swap}
          </div>
          {/* The facts fold away first: they are what a rider reads once, where the destination is
              what they check repeatedly. */}
          {facts}
        </div>
      )}
    </div>
  )
}

/** The route number, at the two sizes the card has. Extracted so the pair cannot drift apart. */
function RouteBadge({ routeNo, compact = false }: { routeNo: string; compact?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-md bg-accent px-2 font-semibold text-accent-contrast tabular-nums ${
        compact ? 'text-body' : 'text-title'
      }`}
    >
      {routeNo}
    </span>
  )
}
