import type { RouteDetailView } from '@nextbus/core'
import { ArrowRight } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { JourneyRail } from '../../components/JourneyRail'
import { MarqueeText } from '../../components/MarqueeText'
import { RouteChip } from '../../components/RouteChip'
import { useBoxFlip } from '../../hooks/useFlip'
import { BACK_LENS_INSET, BACK_LENS_SIZE } from '../../shell/BackButton'
import { CONTENT_INSET_TOP } from '../../shell/layout'

/** The direction-swap control's box — 36 px, matching the fact pills' touch height. */
const SWAP_SIZE = 36

/** The `lg` route chip's rendered height, and how far it laps the island's top edge (the owner's 6 px). */
const BADGE_H = 34
const ISLAND_LAP = 6

/**
 * How long the box takes to change shape — `useFlip`'s own duration, restated here because this component
 * has to hold the outgoing content for exactly as long as the animation it cannot see.
 *
 * Two numbers that must agree, in two files. The alternative is exporting the hook's constant, which is
 * the right move the moment a third thing needs it; today it would export a private timing as API for one
 * caller. The comment is the seam: change one and the outgoing content is cut off early or lingers.
 */
const MORPH_MS = 500

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
  const card = useRef<HTMLDivElement | null>(null)
  /**
   * **The badge does not move, and the bubble changes shape around it** (ADR-171).
   *
   * It used to travel: `useFlip` carried it from the centre of the expanded card to the left end of a
   * pill, and the owner's read of that was *jarring* even once the height was animated with it. The
   * reason is that three things were moving at once and none of them was the thing being revealed. What
   * he asked for instead is the motion the shapes already suggest: *"the blurred background bubble
   * expands to reveal the content behind it and then collapses around the destination."*
   *
   * So the badge is rendered **once, in the same place in both states** — centred, `BADGE_TOP` below the
   * card's own top edge — and the only thing that animates is the pane: `useBoxFlip` eases its width and
   * height between the two shapes while `overflow-hidden` does the revealing. Expanding, the content is
   * already laid out and the box grows past it; collapsing, the box closes around a destination that is
   * already where it will end up.
   *
   * **The key carries the direction as well as the state**, so a flip eases the card's height too. The
   * reverse direction's names wrap differently and its fare strip is its own, so the block's height
   * changes under the rider's hands — and a box that animates when they press *collapse* and cuts when
   * they press *swap* is worse than one that never animates. `useBoxFlip`'s docblock warns against
   * keying on content for a good reason (a card must not twitch when a fact arrives); a direction flip
   * is not content arriving, it is the rider asking for a different journey.
   *
   * The geometry that makes it work is one number in two places. The container's top is the **badge's**
   * top, so the badge needs no offset at all; the pane is then pulled up by `BADGE_TOP + BADGE_H` when
   * expanded (its first row is the back control's box, and the badge sits over it) and pushed down by the
   * lap when collapsed. Two margins, one badge, no travel.
   */
  useBoxFlip(card, collapsed ? 'island' : `card:${header.destination}`)

  /**
   * **The card's content is still there while the box closes over it** (ADR-174).
   *
   * Two rounds of this animation were wrong in the same way and the owner named it both times: *"expands
   * to reveal the other info and then hides the other info as it collapses"* is a description of content
   * being **clipped**, and what the card actually did was swap its children in one frame and then resize
   * an empty box. Easing curves and clamps were real bugs on top of that, but they were not the thing.
   *
   * So a collapse now has a *leaving* phase. For `MORPH_MS` the expanded content stays mounted, **taken
   * out of flow** — which is the whole trick, because that lets the island row decide the pane's new
   * height while the old content sits behind it at its old position, fading, and the shrinking box cuts
   * it off from the bottom. `useBoxFlip` measures exactly the same two boxes it did before; what changed
   * is what is inside the second one.
   *
   * It is the shape `JourneyLines` and `SlideNumber` already use — an outgoing copy, a timer, and a
   * resting state that is clean. Clean matters here for two reasons beyond tidiness: a projection reads
   * text by presence (ADR-097), and a collapsed card that still held its expanded content would announce
   * the whole journey to a screen reader. While it is leaving it is `aria-hidden` and `inert`, so neither
   * is true for the 500 ms it exists.
   */
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (!collapsed) {
      setLeaving(false)
      return
    }
    setLeaving(true)
    const timer = setTimeout(() => setLeaving(false), MORPH_MS)
    return () => clearTimeout(timer)
  }, [collapsed])

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-20 flex justify-center"
      style={{ top: `calc(${CONTENT_INSET_TOP} + 12px + ${BADGE_TOP}px)` }}
    >
      <div
        className={`pointer-events-auto relative flex flex-col items-center ${
          collapsed ? 'max-w-[calc(100%-136px)]' : 'w-full'
        }`}
        style={
          collapsed ? undefined : { paddingLeft: BACK_LENS_INSET, paddingRight: BACK_LENS_INSET }
        }
      >
        {/*
          **The badge, in one place in both states.** Collapsed it laps the island's top edge; expanded it
          sits in the middle of the card's first row, which is the back control's own 48 px box. Same
          coordinates either way, so there is nothing for it to travel between.
        */}
        <span className="relative z-10">
          <RouteChip operator={header.operator} routeNo={header.routeNo} size="lg" />
        </span>

        <div
          ref={card}
          className={`glass-pane relative flex flex-col overflow-hidden border border-border ${
            collapsed
              ? 'max-w-full items-center gap-0 rounded-pill px-3 py-2'
              : 'w-full gap-2 rounded-sheet px-2 pt-0 pb-2'
          }`}
          style={{ marginTop: collapsed ? -ISLAND_LAP : -(BADGE_TOP + BADGE_H) }}
        >
          {collapsed ? (
            // **`w-full min-w-0`, and both halves are load-bearing.** A flex item does not shrink below
            // its content unless it is told it may, so without these the row laid itself out at its
            // natural width — 307 px inside a 254 px pill — and the pill clipped 26 px off each end: the
            // arrow and the chevron, gone, with the destination sitting flush to both edges. It read as a
            // marquee with no furniture rather than as a row that had overflowed, which is how it
            // survived a screenshot.
            <div className="island-in flex w-full min-w-0 items-center gap-1.5">
              {/* **An arrow, from the number to where it is going.** A badge beside a place name states
                  two facts and no relation between them, and the relation is the point of a route. Not
                  on a circular service, where an arrow to a destination you are also leaving from would
                  be a claim rather than a shorthand — the line ADR-160 draws about the $2 Scheme. */}
              {header.circular ? null : (
                <ArrowRight size={14} aria-hidden className="shrink-0 text-subtle" />
              )}
              <span className="min-w-0 text-label font-semibold text-text">
                <MarqueeText>{header.destination}</MarqueeText>
              </span>
              {/* Decorative: the overlay below is the target, and a button inside a button is what
                  ADR-024 forbids. It stays at the **end** of the pill, where a rider has always found
                  it. */}
              <Chevron direction="down" />
            </div>
          ) : null}

          {/* **The expanded content**, which outlives the collapse by `MORPH_MS`. Out of flow while it
              leaves, so the island row below decides the pane's height and this is simply cut off by the
              closing box — and `inert` while it does, so nothing here is focusable or announced. */}
          {collapsed && !leaving ? null : (
            <div
              className={`flex w-full flex-col gap-2 ${
                leaving ? 'card-leaving pointer-events-none absolute inset-x-0 top-0 px-2' : ''
              }`}
              aria-hidden={leaving ? 'true' : undefined}
              // `inert` as a boolean: React 19 types it, and an inert subtree is unfocusable and
              // untargetable — which is what "this is on its way out" should mean to a keyboard and to a
              // screen reader, not merely invisible.
              inert={leaving}
            >
              {/*
                **One row, 48 px tall and unpadded at the top** — the box the screen's fixed
                `<BackButton />` occupies, so the arrow lands exactly where it always does and the card's
                glass runs *under* it. Both slots are spacers: the back control is drawn by the screen and
                the badge by the container above. There is one back button on this screen, it never moves,
                and what changes while the card is open is its material (`BackButton`'s `flat`).
              */}
              <div className="flex h-12 w-full items-center gap-2">
                <span aria-hidden="true" className="shrink-0" style={{ width: BACK_LENS_SIZE }} />
                <span className="flex-1" />
                {/* The collapse control, balancing the back lens across the badge. Right-aligned because
                    that is where its counterpart sits on the island, so the one glyph a rider learns is
                    always in the same corner. */}
                <span className="flex shrink-0 justify-end" style={{ width: BACK_LENS_SIZE }}>
                  <ChevronButton direction="up" label={collapseLabel} onPress={onCollapse} />
                </span>
              </div>

              {/* The journey, as two rows of the schematic: a numbered terminus square at each end of a
                  rail, the two names beside them. The rail is the card's, because the figures are on
                  `header`; the names are the screen's, because the flip's swap lives with them. */}
              <div className="flex w-full items-start gap-2 px-1">
                <JourneyRail
                  fromSeq={header.originSeq}
                  toSeq={header.destinationSeq}
                  circular={header.circular}
                />
                <div className="min-w-0 flex-1 text-left">{journey}</div>
                {/* The direction swap acts **on** the journey, so it shares its row rather than sitting
                    beside the route number, where it read as a property of the number. */}
                <span className="flex shrink-0 justify-end" style={{ width: SWAP_SIZE }}>
                  {swap}
                </span>
              </div>

              {/* Left-aligned with the block above it. The strip was centred while the journey was, and
                  two axes in one card is what made the first left-aligned draft look broken. */}
              {facts ? <div className="flex w-full justify-start px-1">{facts}</div> : null}
            </div>
          )}
        </div>

        {/* The whole island is the target, badge included — it is one object, and a rider who presses
            the number has pressed the thing. Expanded, the card holds controls of its own and the
            chevron is the way out, so there is no overlay at all (ADR-024). */}
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

/** The badge's top, measured from the card's own top edge: centred in a 48 px first row. */
const BADGE_TOP = (BACK_LENS_SIZE - BADGE_H) / 2

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
