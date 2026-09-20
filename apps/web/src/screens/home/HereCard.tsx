import type { StopCardName } from '@nextbus/core'
import { LocateFixed, MapPin } from 'lucide-react'
import { BACK_LENS_INSET, BACK_LENS_SIZE } from '../../shell/BackButton'
import { CONTENT_INSET_TOP } from '../../shell/layout'

/**
 * **Where you are** — Home's floating card, over the map (`proposals/07` Q4, option A, ADR-183).
 *
 * ## What it says, and why that was a choice between three
 *
 * Route detail's card names the thing the screen is *about* — the route, its destination, its facts.
 * Home's equivalent had to answer the same question one level up, and the owner picked **where you
 * are**: the place the ranking is anchored on, how fresh that anchor is, and a way to re-anchor it.
 * The alternatives were the section the sheet is scrolled to, and both-by-state; the owner's note was
 * *"let's go with A for now, can revisit later after playing with it more"*, which is recorded here so
 * the revisit starts from a decision rather than from a blank.
 *
 * It also gives `lastKnownLocation` somewhere legible. On Nearby it was a grey subtitle under the title
 * that nobody read; here it is the second line of the one thing on screen that is about the rider's
 * position — and on this screen that sentence governs the **ranking** as well as the times, because
 * *saved outranks near* is measured from it.
 *
 * ## The anchor is a stop name, and it says so
 *
 * *"Near Pak Hoi Street"* rather than *"Yau Ma Tei"*, because nothing in the app reverse-geocodes yet.
 * A bare place name beside a pin would read as *you are at this stop*, which is a claim we cannot make
 * — the preposition is the honesty. `homeView` supplies the name; picking *which* place is nearest is
 * an ordering decision and stays in the kernel.
 *
 * ## No collapse, deliberately, and that is the smaller half of a decision
 *
 * Route detail's card collapses because it is tall — a badge, a journey, four fact pills — and the map
 * under it is the point. This is two short lines and a control; there is nothing to reclaim, and a
 * collapse that saves 20 px would be motion for its own sake. If the card grows (a locality, a weather
 * line, a service alert) that changes, and the taxonomy already has the shape to borrow.
 */
export function HereCard({
  anchor,
  nearLabel,
  freshness,
  stale,
  recentreLabel,
  onRecentre,
}: {
  /** The nearest place, from `homeView`. Absent with no fix, or with nothing around the rider. */
  anchor: StopCardName | undefined
  /** The catalogue's "Near {place}", already composed by the caller. */
  nearLabel: string | undefined
  /** "Updated just now" / "Last known position" — the screen's own sentence about its anchor. */
  freshness: string
  /** Colours the freshness line as a caveat rather than a status. */
  stale: boolean
  recentreLabel: string
  onRecentre: () => void
}) {
  return (
    <div
      className="glass-pane pointer-events-auto fixed z-30 flex items-center gap-3 rounded-pill border border-border px-3 py-2"
      style={{
        top: `calc(${CONTENT_INSET_TOP} + ${BACK_LENS_INSET}px)`,
        left: BACK_LENS_INSET,
        // Clear of the Settings lens, which sits in the opposite corner at the same inset. One number,
        // stated once: the lens's own size plus two gaps.
        right: BACK_LENS_INSET * 2 + BACK_LENS_SIZE,
      }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2">
        <MapPin aria-hidden width={16} height={16} className="text-muted" />
      </span>
      <span className="min-w-0 flex-1">
        {anchor === undefined ? null : (
          <span className="block truncate font-semibold text-body text-text">{nearLabel}</span>
        )}
        <span className={`block truncate text-caption ${stale ? 'text-warning' : 'text-muted'}`}>
          {freshness}
        </span>
      </span>
      <button
        type="button"
        aria-label={recentreLabel}
        onClick={onRecentre}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-70"
      >
        <LocateFixed aria-hidden width={16} height={16} />
      </button>
    </div>
  )
}
