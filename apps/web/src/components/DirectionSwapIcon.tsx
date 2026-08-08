import { GitCompareArrows } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * The direction-reverse glyph — the DOM twin of `apps/mobile/components/DirectionSwapIcon.tsx`.
 *
 * Lucide's `git-compare-arrows`: two nodes with arrows flowing between them, which reads as *"toggle between
 * the two directions"*. Each `nonce` bump turns it a half-turn, so the two end dots visibly orbit
 * corner-to-corner and swap — a plain `⇄` is point-symmetric with nothing to track, so its spin looks like a
 * wobble. That reasoning is ADR-046's and it is the same glyph on both renderers; only the mechanism differs
 * (a CSS transition on `transform`, where RN drives a shared value).
 *
 * **The rotation accumulates rather than toggling between two values**, exactly as the RN one does: three
 * flips in a row must turn three half-turns in the same direction, and `deg % 360` would make the second one
 * spin backwards.
 *
 * Reduced motion snaps to the new angle instead of animating — the CSS query does that, so there is no
 * `matchMedia` here.
 */
export function DirectionSwapIcon({ nonce, size = ICON_SIZE }: { nonce: number; size?: number }) {
  const [deg, setDeg] = useState(0)
  const last = useRef(nonce)

  useEffect(() => {
    if (nonce === last.current) return
    last.current = nonce
    setDeg((previous) => previous - HALF_TURN)
  }, [nonce])

  return (
    <span className="swap-icon flex" style={{ transform: `rotate(${deg}deg)` }}>
      <GitCompareArrows size={size} aria-hidden />
    </span>
  )
}

/** Anticlockwise, so the glyph unwinds the way the journey reverses. `apps/mobile` turns the same way. */
const HALF_TURN = 180
const ICON_SIZE = 18
