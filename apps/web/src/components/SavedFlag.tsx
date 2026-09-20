import { Star } from 'lucide-react'

/** The halo star's box, and the accent star inside it. Declared, never derived — see `SavedFlag`. */
const HALO = 15
const MARK = 11

/**
 * **The saved flag — two stars, not one**, and the second one is the point.
 *
 * A slightly larger star sits *behind* the accent one, filled with whatever the flag is standing on, so the
 * mark reads as a bordered sticker cut out of its background rather than a shape floating on it. That
 * matters wherever the flag laps over something busy — a rail with a bus token passing under it, a route
 * chip in an operator livery, a map marker over a dense basemap — because an accent star with no outline
 * loses its silhouette against any colour near it, and `--accent` is *ink* on light and *paper* on dark, so
 * there is no single colour it is safely legible over.
 *
 * ## This is an extraction, not a new idea
 *
 * The treatment already existed, written inline in `RouteStopRow` for the saved stop on the schematic —
 * *"Two stars, not one: a slightly larger `--surface` one behind the accent one, which is what gives the
 * flag its outline"* — and the RN overlay does the same with `BADGE = 15`. It is here as a component
 * because the owner's Home design (`proposals/07`) puts the same flag on a **route chip**, and two
 * hand-written copies of a two-layer mark is exactly the shape that drifts: one of them gets retuned, the
 * other does not, and a rider sees two different "saved" marks on two screens.
 *
 * **One size, always** — 15 behind, 11 in front, the rail's own pair. Not a `size` prop with the ratio
 * applied to it, for two reasons. `check-no-derivation` flagged the multiplication, and it was right to:
 * *"a number the renderer computes is a number the other renderer computes differently"*, and a native port
 * scaling 15 : 11 by its own rounding would land somewhere else. And the flag has no business being
 * resizable — it is a fixed mark, the same call `routeMarkerElement` makes for the map marker (*"One size,
 * always"*). 11 is the smallest gap that still reads as an outline at token size; the halo is not a stroke
 * and cannot be thinned to a hairline without the mark collapsing back into a plain star.
 *
 * ## `halo` is the caller's, because only the caller knows what it is standing on
 *
 * The rail's flag sits on a row, so its halo is `--surface`. A flag on a route chip in a card sits over the
 * card, so its halo is `--bg`. Both are semantic tokens (CLAUDE.md rule 4) and neither is derivable from
 * here — passing the wrong one is visible immediately, which is the right failure mode for a two-value
 * choice.
 *
 * ## It carries no text, deliberately
 *
 * `aria-hidden`, and no text node anywhere. A projection compares text, so a word here would appear in
 * every row's projection on one renderer only — the trap ADR-093 found in the bus token. Whether the *row*
 * announces that it is saved is the row's decision and belongs to its own accessible name; this is the
 * drawing.
 */
export function SavedFlag({
  halo = 'surface',
}: {
  /** Which surface the flag is standing on — see the note above. */
  halo?: 'surface' | 'bg'
}) {
  return (
    <span
      aria-hidden
      className="pointer-events-none relative inline-flex shrink-0 items-center justify-center"
      style={{ width: HALO, height: HALO }}
    >
      <Star
        size={HALO}
        className={`absolute ${halo === 'bg' ? 'fill-bg text-bg' : 'fill-surface text-surface'}`}
      />
      <Star size={MARK} className="absolute fill-accent text-accent" />
    </span>
  )
}
