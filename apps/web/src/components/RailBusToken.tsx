import type { RailBus } from '@nextbus/core'
import { BusGlyph } from './BusGlyph'

/**
 * A bus riding the route schematic's rail — the DOM twin of `apps/mobile/components/BusToken.tsx`.
 *
 * **`role="img"` with an `aria-label`, and the label is the kernel's** (`RailBus.label`). Without a name a
 * disc with a glyph in it is nothing to a screen reader, which is what the RN token was until WP6-6a: a spec's
 * vocabulary is text, so the conformance walker could not see the tokens at all, and the honest fix was to
 * name them rather than exempt them (ADR-093 decision 3). It is `aria-hidden`-free and `pointer-events: none`
 * for the same reason as the RN one — read, never focused, because it is not a control.
 *
 * **It bobs, and it draws the app's own double-decker** — both of which this file previously argued against.
 * It said the idle motion was "deliberately absent … the invariant/idiom line rather than laziness", citing
 * ADR-075's *"curve, duration, physics, whether it moves at all"*. ADR-100 moves that line: the app's
 * signature motion and material are identity, and a bobbing double-decker riding the rail is the single most
 * recognisable thing this app draws. The glyph was never a decision at all — `docs/09-theme.md` has named
 * `BusGlyph` since Wave 1 and this drew Lucide's stock `BusFront`.
 *
 * The motion is the RN token's, constant for constant, in `index.css`: the disc is static and only the glyph
 * bobs (±0.5 px), rocks (±6°) and squashes (6%, anchored at the wheels) on two clocks. What is **not** idiom
 * — which node the bus is at — is `routeDetailView.buses`', and both renderers read it from there. The
 * position change stays a CSS transition, because *that* one carries meaning rather than life: a bus that
 * moved is a bus that moved.
 */
export function RailBusToken({ bus, top }: { bus: RailBus; top: number }) {
  return (
    <span
      role="img"
      aria-label={bus.label}
      className="pointer-events-none absolute flex items-center justify-center rounded-full bg-accent transition-[top] duration-500 ease-out motion-reduce:transition-none"
      style={{ top, left: RAIL_WIDTH / 2 - TOKEN / 2, width: TOKEN, height: TOKEN }}
    >
      {/* Three nested spans because three transforms run on three clocks and CSS allows one `transform`
          per element.

          **The bob is outermost and the rock inside it, which is not the obvious order.** The RN token
          writes `transform: [translateY, rotateZ]` on one view, and a transform list composes left-to-right
          — translate applied *last*. Nested elements compose outermost-last, so matching that means the
          translate has to be the outer span. With the rock outside, the bob's 0.75 px was itself rotated by
          up to 6°, which showed up as a measured ±0.11 px sideways wobble on a glyph that should only ever
          move vertically. Free to fix, and it removes a divergence rather than adding one. */}
      <span className="bus-bob flex">
        <span className="bus-rock flex">
          <span className="bus-squash flex text-accent-contrast">
            <BusGlyph size={TOKEN * 0.66} />
          </span>
        </span>
      </span>
    </span>
  )
}

/** The rail gutter's width and the token's diameter — layout, and the DOM screen's own numbers. */
export const RAIL_WIDTH = 44
const TOKEN = 24
