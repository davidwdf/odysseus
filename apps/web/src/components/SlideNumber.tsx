import { useEffect, useRef, useState } from 'react'
import { splitChange, type ValueChange } from '../lib/odometer'

/**
 * A readout that slides when its value changes — the DOM twin of `SlideNumber` in
 * `apps/mobile/components/EtaTimes.tsx`.
 *
 * The old value rises out as the new one rises into place, over 260 ms, and **only the part that actually
 * changed moves**: `"52 min"` → `"51 min"` slides the `2`→`1` and leaves the `5` and the ` min` still.
 *
 * ## At rest it is a single text node, and that is the load-bearing property
 *
 * The animation machinery mounts *only* mid-transition. A conformance projection reads text by presence
 * rather than visibility (ADR-097), so a component that kept both values in the tree would make every
 * screen carrying an arrival project two readouts for one bus — on a resting screen, permanently. The RN
 * version has the same shape for a different stated reason ("visible even if animations no-op on web"), and
 * the two reasons happen to demand the same design.
 *
 * There is a residual window, and it is worth naming rather than leaving for someone to find: for 260 ms
 * after a value changes, both are in the tree. No suite can observe it — a projection is read after a
 * settled mount and the value changes only when fresh data arrives — but a future test that advanced the
 * clock mid-render *would* see two, and this comment is where they should start.
 *
 * ## Where it is used, and where the RN app does not
 *
 * Both renderers animate the route schematic's arrivals. **Only this one animates the condensed rows** —
 * Nearby, Favourites and Place detail all draw `EtaBadge`, which has never moved on native. That is a
 * deliberate divergence at the owner's request rather than an oversight: the times should behave the same
 * way wherever they change. `apps/mobile` retires at WP6-8, so it is not being back-ported.
 *
 * Reduced motion is honoured through one CSS query — the RN odometer does not honour it at all.
 */
export function SlideNumber({ value, className }: { value: string; className?: string }) {
  const [display, setDisplay] = useState(value)
  const [change, setChange] = useState<ValueChange | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (value === display) return
    setChange(splitChange(display, value))
    setDisplay(value)
    if (timer.current !== null) clearTimeout(timer.current)
    // A timer rather than `animationend`, because under `prefers-reduced-motion` the animation is `none`
    // and no event ever fires — the transition would then never tear itself down and both values would
    // stay in the tree for ever, which is the one outcome this component must not produce.
    timer.current = setTimeout(() => setChange(null), DURATION_MS)
  }, [value, display])

  useEffect(() => () => (timer.current !== null ? clearTimeout(timer.current) : undefined), [])

  // Resting: one text node, nothing else.
  if (change === null) return <span className={className}>{display}</span>

  // **An inline grid, with both values in the same cell.** The first version drew a third, invisible copy
  // of the wider value as a sizer so the sliding box would not collapse to the narrower one and clip
  // (`"9"` → `"10"` cropping the `0`). It worked and it put *three* copies of the changing characters in
  // the tree, which the odometer's own test caught: mid-flight the readout's text was `"5112 min"`.
  //
  // A grid sizes itself to its widest item for free, so the sizer is gone and mid-flight is the irreducible
  // two — the outgoing value and the incoming one. That window is documented above; it is 260 ms long and
  // no projection can reach it, but three copies would have been a bug waiting for the first test that did.
  return (
    <span className={className}>
      {change.prefix}
      <span className="odo-box">
        <span className="odo-in">{change.nextMid}</span>
        {/* `aria-hidden`: the value on its way out is not something a screen reader should announce, and
            the incoming one carries the same text a moment later. */}
        <span aria-hidden className="odo-out">
          {change.prevMid}
        </span>
      </span>
      {change.suffix}
    </span>
  )
}

/** `DUR` on the RN component. The rise is `0.85em`, which is its `size * 0.85` expressed relatively. */
const DURATION_MS = 260
