import { useEffect, useRef, useState } from 'react'

/**
 * The direction-reverse glyph — the DOM twin of `apps/mobile/components/DirectionSwapIcon.tsx`.
 *
 * Lucide's `git-compare-arrows`, **with its two circles redrawn as squares** (ADR-167): two nodes with
 * arrows flowing between them, which reads as *"toggle between the two directions"*.
 *
 * ## Why the nodes are squares, and why only the nodes changed
 *
 * A square is this app's terminus — the map marker, the schematic's node and the header's from/to block all
 * draw one from the same `routeMarkers` answer. The nodes this control swaps **are** the two termini, so a
 * pair of circles here was the last place on the screen where an end of the line was round. The arms are
 * lucide's own paths, untouched, and the squares sit on the same centres at the same 6-unit width their
 * circles had, so the glyph still belongs to the set it came from.
 *
 * Round joins rather than the rail node's mitre, deliberately: every other arm in this drawing is
 * round-joined, and a mitred square among them reads as a different icon pasted in rather than the same one.
 * The rail's square is drawn at 26 px where a corner is a corner; this one is 18, where it is two pixels. Each `nonce` bump turns it a half-turn, so the two end dots visibly orbit
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
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2" y="3" width="6" height="6" />
        <rect x="16" y="15" width="6" height="6" />
        <path d="M12 6h5a2 2 0 0 1 2 2v7" />
        <path d="m15 9-3-3 3-3" />
        <path d="M12 18H7a2 2 0 0 1-2-2V9" />
        <path d="m9 15 3 3-3 3" />
      </svg>
    </span>
  )
}

/** Anticlockwise, so the glyph unwinds the way the journey reverses. `apps/mobile` turns the same way. */
const HALF_TURN = 180
const ICON_SIZE = 18
