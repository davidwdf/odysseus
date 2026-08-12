import type { RouteVehicle } from '@nextbus/core'

/**
 * The app's own front-view bus glyphs — the DOM twin of `apps/mobile/components/BusGlyph.tsx`, rect for
 * rect. Two vehicles: a **double-decker** and a **light bus**, chosen by the kernel's `RouteVehicle`.
 *
 * Custom Lucide-style line glyphs on a 24 px grid with round caps and joins and a 2 px stroke, because
 * **Lucide has no double-decker and no light bus** and this app is about Hong Kong buses. `docs/09` §8 has
 * named the decker as this app's bus since Wave 1; the minibus arrived once every stop on a GMB route had
 * times (ADR-116–121), which is what made a minibus token worth drawing at all.
 *
 * ## The rules these obey, all of which were decided by looking (ADR-132)
 *
 * · **Radii are Lucide's two values**: `BODY_RX = 2` for an outer shape, `WIN_RX = 1` for an inner detail.
 *   That is what the installed set actually uses — `rx="2"` 260 times, `rx="1"` 111 — rather than any
 *   formula. A concentric rule (inner = outer − padding) was measured and abandoned as *unobservable*: the
 *   whole sweep from square to a full pill is identical at token size, because a round linejoin on a 2 px
 *   stroke rounds a square corner anyway. Below about `rx=1` the stroke decides the look, not the path.
 * · **The two vehicles share a width, a window width and a ground line**, and differ in **height** (17.0
 *   against 12.6) and in **glass** (two 3.6 bands against one 4.4 pane). A real light bus is narrower, and
 *   equal width is a deliberate departure: the token is a fixed 24 px circle, and a narrower glyph inside it
 *   reads as a *smaller drawing* rather than a smaller vehicle.
 * · **The decker's window rhythm is derived, not placed**: three equal gaps around two bands,
 *   `(17 − 2·band) / 3`. Written as arithmetic so a later retune cannot quietly break the evenness.
 * · **The minibus's lower face is deliberately empty.** Headlights and a partial bumper line were both
 *   drawn and rejected — not for want of legibility, but because anything under the glass makes the minibus
 *   read as a *two-band* vehicle, which is exactly the difference that tells it from the decker at 16 px.
 * · **The tyres are filled pills, and the stroke is part of the shape rather than padding.** A pill's
 *   painted size is its path plus one stroke on every side, so `PILL_W = 1.6` paints **3.6** wide and
 *   `PILL_H = 2.6` paints **4.6** tall — taller than wide, which is right for a head-on tyre, where you see
 *   its tread and not its diameter. Dropping the stroke was tried and is wrong twice over: it shrinks both
 *   axes, and the round join is what carries the bottom of the wheel, which `rx` cannot do on a 2.6-high
 *   rect where it is capped at half the height.
 *
 * **Every number here is a path value.** The painted value is the path plus 2 wherever a shape is stroked,
 * which is everywhere. Three separate mistakes were made in this file's design by quoting one as the other.
 */

/** Lucide's outer-shape radius. */
const BODY_RX = 2
/** Lucide's inner-detail radius. */
const WIN_RX = 1

const BODY_X = 5
const BODY_W = 14
const WIN_X = 8
const WIN_W = 8

/** Path width of a tyre; paints 3.6 with the stroke. */
const PILL_W = 1.6
/** Path height of a tyre; paints 4.6 with the stroke. */
const PILL_H = 2.6
/**
 * A tyre's corner radius, written down rather than clamped.
 *
 * It was `Math.min(WIN_RX, PILL_W / 2)` while the lab was sweeping the width — a guard against a radius
 * larger than half the shape. The width is settled now, so the guard is arithmetic a renderer does not need
 * to do, which `check-no-derivation` is right to refuse: half of 1.6. If `PILL_W` ever moves, this moves
 * with it, and the gate is what will notice.
 */
const PILL_RX = 0.8
/** Tyre centres — inset 2.6 from each body edge. */
const WHEEL_X = [7.6, 16.4] as const

const DECK_TOP = 2.2
const DECK_HEIGHT = 17
const DECK_BAND = 3.6

const MINI_TOP = 6.6
const MINI_HEIGHT = 12.6
/** Roof-to-glass. **The decker's own gap**, so the distance is identical on both vehicles. */
const MINI_TOP_GAP = 3.27
const MINI_BAND = 4.4

export function BusGlyph({
  vehicle = 'bus',
  size = 18,
  strokeWidth = 2,
}: {
  vehicle?: RouteVehicle
  size?: number
  strokeWidth?: number
}) {
  // `currentColor` throughout, so the caller sets the colour with a text utility and light/dark follow the
  // token — where the RN twin has to resolve `--accent-contrast` through `useTheme()` by hand.
  const s = {
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  }
  const deckGap = (DECK_HEIGHT - 2 * DECK_BAND) / 3
  const bodyY = vehicle === 'minibus' ? MINI_TOP : DECK_TOP
  const bodyH = vehicle === 'minibus' ? MINI_HEIGHT : DECK_HEIGHT
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      // The token that wraps this carries `role="img"` and the kernel's own accessible name
      // (`RailBus.label`), so the glyph itself must be silent — a second name here would have a screen
      // reader announce the bus twice. `aria-hidden="true"` rather than bare, which is what Biome's
      // `noSvgWithoutTitle` accepts as the deliberate form.
      aria-hidden="true"
      focusable="false"
    >
      {vehicle === 'minibus' ? (
        // The destination sign box every HK light bus carries and the decker does not — the one silhouette
        // difference that survives at 16 px besides height. **Filled**, because an outlined 1.8-high box has
        // no interior left at a 2 px stroke: the outlined and filled versions were indistinguishable.
        <rect x="8.8" y="4.6" width="6.4" height="1.8" rx="0.8" {...s} fill="currentColor" />
      ) : null}
      <rect x={BODY_X} y={bodyY} width={BODY_W} height={bodyH} rx={BODY_RX} {...s} />
      {vehicle === 'minibus' ? (
        // One pane, and taller than either of the decker's bands: a light bus's screen fills more of its
        // face. At 4.4 the glazed interior (2.4) is thicker than the stroke around it and the shape is past
        // 2:1, so it reads as a pane rather than a band — which is the second axis of difference.
        <rect
          x={WIN_X}
          y={MINI_TOP + MINI_TOP_GAP}
          width={WIN_W}
          height={MINI_BAND}
          rx={WIN_RX}
          {...s}
        />
      ) : (
        <>
          {/* Two glazed bands whose *gap* is the deck split — there is no divider line, and adding one was
              tried: it fills in exactly where the gap was doing the work. */}
          <rect
            x={WIN_X}
            y={DECK_TOP + deckGap}
            width={WIN_W}
            height={DECK_BAND}
            rx={WIN_RX}
            {...s}
          />
          <rect
            x={WIN_X}
            y={DECK_TOP + deckGap * 2 + DECK_BAND}
            width={WIN_W}
            height={DECK_BAND}
            rx={WIN_RX}
            {...s}
          />
        </>
      )}
      {/* Front-view tyres, on a ground line both vehicles share so height is what the eye compares. */}
      {WHEEL_X.map((x) => (
        <rect
          key={x}
          x={x - PILL_W / 2}
          y={bodyY + bodyH}
          width={PILL_W}
          height={PILL_H}
          rx={PILL_RX}
          {...s}
          fill="currentColor"
        />
      ))}
    </svg>
  )
}
