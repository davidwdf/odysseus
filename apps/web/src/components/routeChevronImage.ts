/**
 * **The double chevron that says which way the bus goes**, drawn to an `ImageData` at runtime rather
 * than shipped as a sprite (`docs/proposals/06 §8d`).
 *
 * A sprite would be a build step, a second file to keep in step with the tokens, and a colour declared
 * somewhere other than `packages/ui/tokens.json`. Two strokes on a canvas is cheaper than all three,
 * and it means the light and dark variants are the *same* drawing with a different colour argument
 * rather than two assets that can drift apart.
 *
 * ## Why it is drawn in the casing colour
 *
 * Round 5 settled the **cased** chevron over the plain one because it *"reads as a notch in the line,
 * not a symbol on it"*. That is what this is: the mark is painted in the colour of the line's casing,
 * so on the line it looks like the line has been cut away rather than had something placed on top. It
 * also means the pair is the one the line already uses — one swap for dark mode, not two.
 */

/** Drawn size in CSS pixels. Small: it is a texture along the line, not a signpost. */
const SIZE = 13
/** Stroke weight. Finer than the line's 5 px, so the notch never reads as a break in it. */
const WEIGHT = 1.9
/** Gap between the two halves, settled in round 5 as the "normal" of three options. */
const GAP = 3.1

/**
 * One double chevron, pointing **right** — which is along the line, because MapLibre rotates a
 * `symbol-placement: line` icon to the local direction of travel.
 *
 * That the direction is *travel* and not just *vertex order* is the quiet payoff of `orientToStops`
 * (ADR-152): the line is reversed at the edge when the surveyed geometry runs against the stop
 * sequence, so by the time it reaches a map its vertex order **is** the direction a rider travels.
 * Without that, half the routes on the network would draw arrows pointing back the way they came.
 *
 * @param colour The casing colour for the active appearance — see the module note.
 * @param scale Device pixel ratio. The image is drawn at `SIZE * scale` and declared to MapLibre with
 *              a matching `pixelRatio`, which is what keeps it crisp on a retina screen.
 */
export function routeChevronImage(colour: string, scale: number): ImageData {
  const px = Math.round(SIZE * scale)
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context: the chevron cannot be drawn')
  ctx.scale(scale, scale)
  ctx.strokeStyle = colour
  ctx.lineWidth = WEIGHT
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Two identical strokes offset along x — one glyph, as round 5 settled, rather than two symbols the
  // engine might place independently and let drift apart on a curve.
  const midY = SIZE / 2
  const reach = 2.6
  for (const x of [SIZE / 2 - GAP / 2 - reach / 2, SIZE / 2 + GAP / 2 - reach / 2]) {
    ctx.beginPath()
    ctx.moveTo(x, midY - reach)
    ctx.lineTo(x + reach, midY)
    ctx.lineTo(x, midY + reach)
    ctx.stroke()
  }
  return ctx.getImageData(0, 0, px, px)
}
