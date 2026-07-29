import { bearingOctantDeg } from '@nextbus/core'
import { Navigation2 } from 'lucide-react'

/**
 * A compass cue rotated to a place's travel bearing (0° = North = up, clockwise).
 *
 * The rotation is `bearingOctantDeg` from `@nextbus/core` — **the same function `formatBearing` uses to
 * choose its word** — so the needle and the label cannot point and say different things. Both renderers
 * had their own `Math.round(deg / 45) * 45` before WP4-1; this one never did, because the rule was
 * already shared by the time it was written.
 */
export function BearingArrow({ bearingDeg, size = 13 }: { bearingDeg: number; size?: number }) {
  return (
    <Navigation2
      aria-hidden
      width={size}
      height={size}
      className="shrink-0 text-subtle"
      style={{ transform: `rotate(${bearingOctantDeg(bearingDeg)}deg)` }}
    />
  )
}
