import type { Locale } from '@nextbus/core'
import { KERB_OFFSET_DEG, type StopMarkerKind } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { MAP_COLOR } from '@nextbus/ui'

/**
 * **How far, in CSS pixels, a marker sits off the line** — the half of the kerb rule that is
 * presentation and therefore deliberately not in the kernel (`route-markers.ts`).
 *
 * A kerb is a real place about 5 m from the centreline, which is a sub-pixel move at the zoom a whole
 * route is framed at and a visible one at street level. Committing to metres in the data would pick
 * one of those and be wrong at the other; a constant pixel nudge reads the same at every zoom, which
 * is what makes it a *signal* — "this side" — rather than a survey.
 */
const KERB_OFFSET_PX = 7

/**
 * The glyph, by kind.
 *
 * **Sized against the LINE, not against each other**, and it took three passes to find the range. The
 * first drew them at 11–14 px filled with the line's own colour, and a 25-stop route came out as an
 * unbroken chain of blobs with the line invisible underneath. Dropping to 9–11 fixed that and went too
 * far the other way — the owner's *"the stop icons are too small"*. What actually made the first pass
 * unreadable was the **fill**, not the size: a marker in the line's colour has nothing to separate it
 * from the line. Inverted against the casing (below), the same sizes read cleanly, so these are back up
 * at 12–15 and each stop is a distinct target.
 *
 * The three still differ enough to tell apart, because they differ in **shape** and only incidentally
 * in size — which is the accessibility argument as well as the aesthetic one.
 */
const SHAPE: Record<StopMarkerKind, { size: number; path: string }> = {
  // A square, for an end of the line. Slightly larger than the circle: a square of equal side reads
  // smaller than a disc, so matching them numerically would make the termini look like the quiet ones.
  terminus: { size: 14, path: 'M2.6 2.6 h8.8 v8.8 h-8.8 Z' },
  // A hexagon, for a bus-bus interchange. Flat-topped, which stays distinguishable from a circle at a
  // size where a pointed top would just read as a blob.
  // Regular: vertices every 60° on a circle of radius 5.6 about the centre, as in the rail node.
  interchange: {
    size: 15,
    path: 'M13.1 7.5 L10.3 12.35 L4.7 12.35 L1.9 7.5 L4.7 2.65 L10.3 2.65 Z',
  },
  stop: { size: 12, path: 'M6 1.9 a4.1 4.1 0 1 0 0.01 0 Z' },
}

/** What a marker needs to draw itself and say what it is. */
export interface RouteMarkerOptions {
  kind: StopMarkerKind
  /** Direction of travel through the stop, from `routeMarkers`. Degrees clockwise from north. */
  bearing: number
  name: string
  locale: Locale
  selected: boolean
  /** Dark mode. The overlay keeps its true colour while the tiles invert, so it needs its own pair. */
  dark: boolean
  onSelect: () => void
}

/**
 * One stop's marker on the route map, as a real `<button>`.
 *
 * ## Why DOM and not a symbol layer
 *
 * MapLibre would happily draw these into the canvas, and that is the wrong choice here for three
 * reasons, in increasing order of how much they matter:
 *
 * 1. The shapes come from tokens and a canvas layer wants a sprite, which is a build step and a second
 *    place for a colour to live.
 * 2. A tap is `onClick` rather than a `queryRenderedFeatures` hit test — and this repo has already been
 *    caught once by a hit test that passed a synthetic click and failed a real finger.
 * 3. **A canvas has no accessibility tree and no text.** A symbol layer is invisible to a screen reader
 *    *and* to the conformance walker, which is exactly the hole ADR-093 found in the RN bus token: a
 *    graphic with no accessible name says nothing to either. A `<button>` with an `aria-label` is
 *    visible to both, so the spec can hold this to something in M7d.
 *
 * ## The offset is applied here, from a bearing decided there
 *
 * `routeMarkers` answers *which way is travel* and `KERB_OFFSET_DEG` answers *which side of it a rider
 * boards from*; this turns those into a screen-space nudge. Screen y grows **downward** while a bearing
 * is measured clockwise from north, which is the sign trap the mockup fell into — its side *test* used
 * one convention and its *placement* used the other, so every marker sat on the far kerb, uniformly
 * enough to look deliberate.
 */
export function routeMarkerElement(opts: RouteMarkerOptions): {
  element: HTMLButtonElement
  offset: [number, number]
} {
  const shape = SHAPE[opts.kind]
  const element = document.createElement('button')
  element.type = 'button'
  element.className =
    'block cursor-pointer border-0 bg-transparent p-0 leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus'
  element.setAttribute('aria-label', accessibleName(opts))
  // `aria-current` rather than `aria-selected`: the map is not a listbox, and `current` is the role-free
  // way to say "this is the one being looked at". `react-native-web@0.21` dropping `accessibilityState`
  // is why every state on this side is spelled as an `aria-*` attribute (ADR-097).
  if (opts.selected) element.setAttribute('aria-current', 'true')
  element.innerHTML = svg(shape, opts.selected, opts.dark)
  element.addEventListener('click', (e) => {
    // The map is listening for clicks too; a marker tap must not also be read as a tap on the map.
    e.stopPropagation()
    opts.onSelect()
  })

  const radians = ((opts.bearing + KERB_OFFSET_DEG) * Math.PI) / 180
  return {
    element,
    // x from sine and y from **minus** cosine: north is up the screen, and up is negative y.
    offset: [KERB_OFFSET_PX * Math.sin(radians), -KERB_OFFSET_PX * Math.cos(radians)],
  }
}

/**
 * What a screen reader reads. The shape's *meaning* in words, because a shape has none out loud.
 *
 * Composed from three catalogue entries rather than one string per kind: the stop's name is the subject
 * in every case, and a locale that orders the qualifier differently can do so in its own strings
 * without this function changing.
 */
function accessibleName({ kind, name, locale }: RouteMarkerOptions): string {
  const base = t(locale, 'routeStopMarker', { stop: name })
  if (kind === 'terminus') return `${base} · ${t(locale, 'routeStopTerminus')}`
  if (kind === 'interchange') return `${base} · ${t(locale, 'routeStopInterchange')}`
  return base
}

/**
 * The glyph.
 *
 * Fill and stroke are **the same pair the route line uses** — `MAP_COLOR.route`/`routeInverted` for the
 * body and `routeCasing`/`routeCasingInverted` for the hairline — so a marker cannot drift out of step
 * with the line it sits on, and dark mode is one swap rather than four. Set inline rather than in CSS
 * because the map palette is a JS export and a stylesheet reading it would be a second declaration of
 * the same values (rule 4 is about tokens, not about where they are applied).
 *
 * `aria-hidden` on the SVG: the accessible name lives on the button, and a nested graphic with no name
 * of its own would otherwise be announced as an empty image inside it.
 *
 * **The stroke is heavy on purpose** — 3.2 of a 12–15 px glyph, which is a quarter of the whole mark.
 * The markers are a *hole punched in the line* rather than a bead resting on it, and that reading
 * depends on the outline being substantial enough to read as an edge of the line itself; a hairline
 * reads as a thin ring around a separate object. Two passes undershot this (1.4, then 2.2) because the
 * mockups' balance was set against much larger glyphs and does not survive being scaled down — the
 * *ratio* is what carries over, not the number.
 *
 * Note the contrast with the rail node, which is a hairline by comparison (2 px on a 26 px glyph) and
 * deliberately so: it sits on a 2 px rail in a list, where the job is to be a tidy bead on a line. The
 * map marker sits on a 5 px road over a dense basemap, where the job is to be legible at a glance.
 */
function svg(shape: { size: number; path: string }, selected: boolean, dark: boolean): string {
  const scale = selected ? 1.45 : 1
  const px = Math.round(shape.size * scale)
  // **Inverted against the line, not matched to it.** A marker filled with the line's own colour
  // disappears into it; filling with the CASING colour and outlining with the line's makes each stop a
  // hole punched in the line, which is what the mockup's "hybrid" markers were reaching for and is
  // legible at every zoom. Still one pair, so dark mode is still one swap.
  const fill = dark ? MAP_COLOR.routeCasingInverted : MAP_COLOR.routeCasing
  const stroke = dark ? MAP_COLOR.routeInverted : MAP_COLOR.route
  return `<svg width="${px}" height="${px}" viewBox="0 0 ${shape.size} ${shape.size}" aria-hidden="true" class="route-marker${
    selected ? ' route-marker-selected' : ''
  }" fill="${fill}" stroke="${stroke}" stroke-width="${selected ? 3.6 : 3.2}"><path d="${shape.path}" /></svg>`
}
