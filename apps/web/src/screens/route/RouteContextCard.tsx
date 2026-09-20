import type { RouteDetailView } from '@nextbus/core'
import { ArrowRight } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { JourneyRail } from '../../components/JourneyRail'
import { RouteChip } from '../../components/RouteChip'
import { useFlip, useHeightFlip } from '../../hooks/useFlip'
import { BACK_LENS_INSET, BACK_LENS_SIZE } from '../../shell/BackButton'
import { CONTENT_INSET_TOP } from '../../shell/layout'

/** The direction-swap control's box — 36 px, matching the fact pills' touch height. */
const SWAP_SIZE = 36

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
  onCollapse,
  expandLabel,
  collapseLabel,
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
  /** Tapping the expanded card's chevron puts it away. */
  onCollapse: () => void
  /** The collapsed pill's accessible name — its content is a badge and a place, neither of which says
   *  what pressing it does. */
  expandLabel: string
  /** The expanded card's chevron is a glyph; this is the whole of what a screen reader gets. */
  collapseLabel: string
}) {
  const badge = useRef<HTMLSpanElement | null>(null)
  const card = useRef<HTMLDivElement | null>(null)
  // The badge travels between the two layouts rather than being re-drawn in each. See `useFlip`.
  useFlip(badge, collapsed ? 'pill' : 'card')
  // …and the card's own height travels with it, over the same 500 ms. Without this the box cut from
  // ~135 px to ~44 px in one frame while the edge and the badge were still moving, which is the thing
  // the owner read as jarring — see `useHeightFlip`.
  useHeightFlip(card, collapsed ? 'pill' : 'card')

  /**
   * **Collapsed, the card is an island**: the badge over a compact pill, lapping its top edge — the
   * iOS-Messages stack, as the *collapsed* state (ADR-170).
   *
   * Three things it buys over the pill it replaces, and none of them is the look:
   *  · **It clears the floating back lens by construction.** Centred, it needs neither the 72 px left
   *    inset the old pill started at nor "the width that is left" beside the lens — so it takes the width
   *    its text needs, and the destination that truncated at 46 px of pill fits.
   *  · **The badge is the subject**, at `lg`. It is the only identity left on the screen at this size.
   *  · **The chevron stays at the end of the pill**, where it has always been (the owner's ask). It is
   *    decorative — the overlay behind it is the target, and a button inside a button is what ADR-024
   *    forbids — but it is the one glyph that says the card opens downward, and moving it would cost a
   *    rider the thing they already know.
   *
   * The lap is 6 px and the padding is equal top and bottom, which are the owner's numbers and are one
   * decision rather than two: a deeper lap needs a deeper top padding to clear the badge, and the pill
   * then reads as having slipped down inside itself.
   */
  if (collapsed) {
    return (
      <div
        className="pointer-events-none fixed inset-x-0 z-20 flex justify-center"
        style={{ top: `calc(${CONTENT_INSET_TOP} + 12px)` }}
      >
        <div className="pointer-events-auto relative flex max-w-[calc(100%-96px)] flex-col items-center">
          <span className="relative z-10">
            <RouteChip
              operator={header.operator}
              routeNo={header.routeNo}
              size="lg"
              chipRef={badge}
            />
          </span>
          <div
            ref={card}
            className="-mt-1.5 glass-pane flex max-w-full items-center gap-1.5 rounded-pill border border-border px-3 py-2"
          >
            {/* **An arrow, from the number to where it is going.** A badge beside a place name states
                two facts and no relation between them, and the relation is the point of a route. Not on
                a circular service, where an arrow to a destination you are also leaving from would be a
                claim rather than a shorthand — the same line ADR-160 draws about the $2 Scheme. */}
            {header.circular ? null : (
              <ArrowRight size={14} aria-hidden className="shrink-0 text-subtle" />
            )}
            <span className="min-w-0 truncate text-label font-semibold text-text">
              {header.destination}
            </span>
            <Chevron direction="down" />
          </div>
          {/* The whole island is the target, badge included — it is one object, and a rider who presses
              the number has pressed the thing. */}
          <button
            type="button"
            onClick={onExpand}
            aria-label={expandLabel}
            className="absolute inset-0 cursor-pointer border-0 bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className="pointer-events-none fixed right-3 z-20"
      style={{ top: `calc(${CONTENT_INSET_TOP} + 12px)`, left: BACK_LENS_INSET }}
    >
      {/*
        **The expanded card is one pane, and the collapsed island is another** (ADR-170). They were one
        element until the island landed, and the argument for that — a radius, a padding and a `left`
        that transition rather than cut — stopped applying the moment the two states stopped being the
        same shape: one is full-width and encloses the back control, the other is a centred pill half the
        width with a badge over its edge. What still carries the change is the pair of hooks: `useFlip`
        travels the badge (it keeps the previous *rect*, so a different element on each side is fine) and
        `useHeightFlip` animates the box's height.

        The card holds controls of its own — the swap link, the fact pills, the collapse chevron — so it
        cannot itself be a button (ADR-024). It does not need to be: the chevron is the control here, and
        the overlay target belongs to the island.
      */}
      <div
        ref={card}
        className="glass-pane pointer-events-auto relative flex w-full flex-col gap-2 overflow-hidden rounded-sheet border border-border px-2 pt-0 pb-2"
      >
        {/*
          **One row, 48 px tall and unpadded at the top** — the box the screen's fixed `<BackButton />`
          occupies, so the arrow lands exactly where it always does and the card's glass runs *under* it
          rather than beside it. The left slot is a spacer, not a second control: there is one back button
          on this screen, it never moves, and what changes while the card is open is its material (it
          drops its own glass — see `BackButton`'s `flat`).

          The badge is centred in what is left, which is now a choice rather than a workaround: it used to
          be centred to push the destination clear of the lens it slid under.
        */}
        <div className="flex h-12 w-full items-center gap-2">
          <span aria-hidden="true" className="shrink-0" style={{ width: BACK_LENS_SIZE }} />
          <span className="flex flex-1 justify-center">
            <RouteChip
              operator={header.operator}
              routeNo={header.routeNo}
              size="lg"
              chipRef={badge}
            />
          </span>
          {/* The collapse control, balancing the back lens across the badge. Right-aligned because that
              is where its counterpart sits on the island, so the one glyph a rider learns is always in
              the same corner. */}
          <span className="flex shrink-0 justify-end" style={{ width: BACK_LENS_SIZE }}>
            <ChevronButton direction="up" label={collapseLabel} onPress={onCollapse} />
          </span>
        </div>

        {/* The journey, as two rows of the schematic: a numbered terminus square at each end of a rail,
            the two names beside them. The rail is the card's, because the figures are on `header`; the
            names are the screen's, because the flip's lyrics-style swap lives with them. */}
        <div className="flex w-full items-start gap-2 px-1">
          <JourneyRail
            fromSeq={header.originSeq}
            toSeq={header.destinationSeq}
            circular={header.circular}
          />
          <div className="min-w-0 flex-1 text-left">{journey}</div>
          {/* The direction swap acts **on** the journey, so it shares its row rather than sitting beside
              the route number, where it read as a property of the number. */}
          <span className="flex shrink-0 justify-end" style={{ width: SWAP_SIZE }}>
            {swap}
          </span>
        </div>

        {/* Left-aligned with the block above it. The strip was centred while the journey was, and two
            axes in one card is what made the first left-aligned draft look broken. */}
        {facts ? <div className="flex w-full justify-start px-1">{facts}</div> : null}
      </div>
    </div>
  )
}

/**
 * The expand/collapse hint — **a normal chevron**, muted, in the same corner in both states.
 *
 * It was a 28 px-wide flattened one, on the theory that a wide mark reads as an edge of the card. It
 * read as a stretched icon instead: everything else in this app uses ordinary glyph proportions, and
 * one deliberately distorted mark looks like a mistake rather than a motif.
 *
 * A chevron over a "menu" or "expand" glyph because it is the only one of the three that says which
 * *way* — a rider sees both that something is hidden and where it will come from. The other two say
 * only "there is more", which they can already guess.
 */
function Chevron({ direction }: { direction: 'up' | 'down' }) {
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center justify-center text-subtle">
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
      >
        <path
          d={direction === 'down' ? 'M4.5 7 L9 11.5 L13.5 7' : 'M4.5 11.5 L9 7 L13.5 11.5'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

/**
 * The same chevron as a control, for the expanded card — where there is no overlay to tap because the
 * card holds controls of its own.
 *
 * Named, because its content is a glyph: a rider on a screen reader gets "collapse route details"
 * rather than a button with no label at all.
 */
function ChevronButton({
  direction,
  label,
  onPress,
}: {
  direction: 'up' | 'down'
  label: string
  onPress: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full border-0 bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      <Chevron direction={direction} />
    </button>
  )
}
