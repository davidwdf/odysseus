import type { RouteVehicle } from '@nextbus/core'
import Svg, { Rect } from 'react-native-svg'

/**
 * The app's own front-view bus glyphs — the RN twin of `apps/web/src/components/BusGlyph.tsx`, rect for
 * rect. Two vehicles: a **double-decker** and a **light bus**, chosen by the kernel's `RouteVehicle`.
 *
 * Custom Lucide-style line glyphs on a 24px grid with round caps and joins and a 2px stroke, because Lucide
 * has neither. `docs/09` §8 has named the decker as this app's bus since Wave 1; the minibus arrived once
 * every stop on a GMB route had times (ADR-116-121).
 *
 * **The rules, and the full reasoning, are in the DOM twin's docblock** — read that one. The short version:
 * Lucide's two radii (body 2, inner 1, both settled by measuring rather than by formula); shared width,
 * window width and ground line with the difference carried by height and glass; the decker's rhythm derived
 * as `(17 - 2*band) / 3`; the minibus's lower face deliberately empty, because anything under the glass
 * makes it read as a two-band vehicle; and filled tyre pills whose stroke is part of the shape, so
 * `PILL_W = 1.6` paints 3.6 wide and `PILL_H = 2.6` paints 4.6 tall (ADR-132).
 *
 * **Every number here is a path value**; painted is path + 2 wherever a shape is stroked, which is
 * everywhere.
 */

const BODY_RX = 2
const WIN_RX = 1
const BODY_X = 5
const BODY_W = 14
const WIN_X = 8
const WIN_W = 8
const PILL_W = 1.6
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
const WHEEL_X = [7.6, 16.4] as const
const DECK_TOP = 2.2
const DECK_HEIGHT = 17
const DECK_BAND = 3.6
const MINI_TOP = 6.6
const MINI_HEIGHT = 12.6
/** Roof-to-glass. The decker's own gap, so the distance is identical on both vehicles. */
const MINI_TOP_GAP = 3.27
const MINI_BAND = 4.4

export function BusGlyph({
  vehicle = 'bus',
  size = 18,
  color = 'currentColor',
  strokeWidth = 2,
}: {
  vehicle?: RouteVehicle
  size?: number
  color?: string
  strokeWidth?: number
}) {
  const s = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  const deckGap = (DECK_HEIGHT - 2 * DECK_BAND) / 3
  const bodyY = vehicle === 'minibus' ? MINI_TOP : DECK_TOP
  const bodyH = vehicle === 'minibus' ? MINI_HEIGHT : DECK_HEIGHT
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {vehicle === 'minibus' ? (
        // The destination sign box, filled: an outlined 1.8-high box has no interior at a 2px stroke.
        <Rect x="8.8" y="4.6" width="6.4" height="1.8" rx="0.8" fill={color} {...s} />
      ) : null}
      <Rect x={BODY_X} y={bodyY} width={BODY_W} height={bodyH} rx={BODY_RX} {...s} />
      {vehicle === 'minibus' ? (
        <Rect
          x={WIN_X}
          y={MINI_TOP + MINI_TOP_GAP}
          width={WIN_W}
          height={MINI_BAND}
          rx={WIN_RX}
          {...s}
        />
      ) : (
        <>
          {/* Two glazed bands whose gap IS the deck split — no divider line. */}
          <Rect
            x={WIN_X}
            y={DECK_TOP + deckGap}
            width={WIN_W}
            height={DECK_BAND}
            rx={WIN_RX}
            {...s}
          />
          <Rect
            x={WIN_X}
            y={DECK_TOP + deckGap * 2 + DECK_BAND}
            width={WIN_W}
            height={DECK_BAND}
            rx={WIN_RX}
            {...s}
          />
        </>
      )}
      {/* Front-view tyres, on a ground line both vehicles share. */}
      {WHEEL_X.map((x) => (
        <Rect
          key={x}
          x={x - PILL_W / 2}
          y={bodyY + bodyH}
          width={PILL_W}
          height={PILL_H}
          rx={PILL_RX}
          fill={color}
          {...s}
        />
      ))}
    </Svg>
  )
}
