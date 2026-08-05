import type { RailBus } from '@nextbus/core'
import { BusFront } from 'lucide-react'

/**
 * A bus riding the route schematic's rail — the DOM twin of `apps/mobile/components/BusToken.tsx`.
 *
 * **`role="img"` with an `aria-label`, and the label is the kernel's** (`RailBus.label`). Without a name a
 * disc with a glyph in it is nothing to a screen reader, which is what the RN token was until WP6-6a: a spec's
 * vocabulary is text, so the conformance walker could not see the tokens at all, and the honest fix was to
 * name them rather than exempt them (ADR-093 decision 3). It is `aria-hidden`-free and `pointer-events: none`
 * for the same reason as the RN one — read, never focused, because it is not a control.
 *
 * **The idle motion is deliberately absent, and that is the invariant/idiom line rather than laziness.** The
 * RN token bobs and rocks on two independent eased oscillations; ADR-075 puts *"curve, duration, physics,
 * whether it moves at all"* on the idiom side, and a web token that jiggles on a page a rider is reading is
 * the wrong choice for this platform. What is **not** idiom — which node the bus is at — is
 * `routeDetailView.buses`', and both renderers read it from there. The one motion kept is the position
 * change, as a CSS transition, because *that* carries meaning: a bus that moved is a bus that moved.
 */
export function RailBusToken({ bus, top }: { bus: RailBus; top: number }) {
  return (
    <span
      role="img"
      aria-label={bus.label}
      className="pointer-events-none absolute flex items-center justify-center rounded-full bg-accent transition-[top] duration-500 ease-out motion-reduce:transition-none"
      style={{ top, left: RAIL_WIDTH / 2 - TOKEN / 2, width: TOKEN, height: TOKEN }}
    >
      <BusFront size={TOKEN * 0.62} className="text-accent-contrast" strokeWidth={2.25} />
    </span>
  )
}

/** The rail gutter's width and the token's diameter — layout, and the DOM screen's own numbers. */
export const RAIL_WIDTH = 44
const TOKEN = 24
