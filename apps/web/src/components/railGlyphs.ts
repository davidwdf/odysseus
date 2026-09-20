/**
 * **The rail's marks, declared once** — the schematic's double chevron, and the geometry a caller needs to
 * place it.
 *
 * Extracted from `RouteStopRow` when the route header grew a rail of its own (ADR-171): the owner's note
 * was that the header's chevron *"should look like the route list rail"*, and the honest way to satisfy
 * that is for there to be one glyph rather than two that resemble each other. This is the same rule
 * `scripts/pwa` states for the caching policy and `@nextbus/ui` for a colour — a mark drawn in two places
 * is a mark that will drift in one of them.
 *
 * ## The proportions are a ratio, not a number
 *
 * The map paints this pair along the route line with a 2.6 reach and a 1.9 stroke on a 5 px line. Scaling
 * that to a 10 px box while keeping the stroke at 2.0 — which it must be, to cut a 4 px rail — quietly
 * closed the pair up: the stroke ate the gap, and `>>` is a different mark from `> >`. The map's chevrons
 * sit **5.0 apart with a 1.9 stroke**, so the visible whitespace between them is 1.63 × the stroke; at a
 * 2.0 stroke that puts the apexes **5.3 apart**, which is what this draws. Change the stroke and this has
 * to move with it.
 *
 * ## A mask, so the shape is data and the colour is a class
 *
 * A CSS mask reads the **alpha** channel, so the paint inside the SVG is never seen — `currentColor`
 * resolves to the initial black in an SVG loaded as an image, and any other opaque value would mask
 * identically. That is why this is not a colour literal, and why `check-no-raw-colours` still has an empty
 * allowlist.
 *
 * It matters more than tidiness in both callers, and they reach the same picture by different means. The
 * list paints the mark **in the row's own background** so it reads as a notch cut out of the rail — and
 * that background changes when the row is selected, which is why a fill baked into an SVG could not follow
 * it. The header's line sits on **glass**, which has no background colour to borrow, so it punches the
 * shape out of the line with an SVG `<mask>` and lets the map show through (ADR-172). One shape, two
 * techniques, and the shape is what must not drift.
 */
export const RAIL_CHEVRON_W = 10
export const RAIL_CHEVRON_H = 11

/**
 * The two arms, as path data in the glyph's own 10 × 11 box.
 *
 * **Exported as geometry rather than only as a finished mask**, because the two rails cut the same hole
 * by different means: the list paints the mark through a CSS mask in the row's background colour, and the
 * header — whose line sits on glass, with no background colour to paint — punches it out of the line with
 * an SVG `<mask>`, so what shows through is whatever is actually behind the card. One shape, two
 * techniques, and the shape is the thing that must not drift.
 */
export const RAIL_CHEVRON_PATHS = ['M2.2 1.2 5 4 7.8 1.2', 'M2.2 6.5 5 9.3 7.8 6.5'] as const

/** The stroke both techniques draw the arms at — 2, which is what cuts a 4 px rail. */
export const RAIL_CHEVRON_STROKE = 2

export const RAIL_CHEVRON_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${RAIL_CHEVRON_W}" height="${RAIL_CHEVRON_H}" viewBox="0 0 ${RAIL_CHEVRON_W} ${RAIL_CHEVRON_H}"><g fill="none" stroke="currentColor" stroke-width="${RAIL_CHEVRON_STROKE}" stroke-linecap="round" stroke-linejoin="round">${RAIL_CHEVRON_PATHS.map(
    (d) => `<path d="${d}"/>`,
  ).join('')}</g></svg>`,
)}")`

/** The mask properties a caller needs, prefixed for Safari below 15.4 — one object rather than six lines. */
export const railChevronMask = {
  maskImage: RAIL_CHEVRON_MASK,
  WebkitMaskImage: RAIL_CHEVRON_MASK,
  maskSize: `${RAIL_CHEVRON_W}px ${RAIL_CHEVRON_H}px`,
  WebkitMaskSize: `${RAIL_CHEVRON_W}px ${RAIL_CHEVRON_H}px`,
} as const
