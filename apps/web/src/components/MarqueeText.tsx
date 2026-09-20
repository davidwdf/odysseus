import { useLayoutEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'

/**
 * **A line of text that scrolls itself when it does not fit** — the route header's answer to an HK
 * terminus name (ADR-171).
 *
 * `truncate` is the right default nearly everywhere in this app and it is wrong in exactly one place: a
 * header whose whole job is to say *where this bus goes*. *"Tsim Sha Tsui East (Mody Road)"* ellipsised to
 * *"Tsim Sha Tsui East (Mod…"* is a name a rider has to guess at, on the one line they came to the screen
 * to read. So the text travels, once the rider has had a moment to see its beginning, and comes back.
 *
 * ## It measures, and it only animates when the measurement says to
 *
 * `scrollWidth > clientWidth` is the whole condition, read in a layout effect after every content change.
 * A name that fits is a plain truncating span with no animation, no extra element and nothing running —
 * which is most names, and it is why this is safe to use on every header rather than on the long ones
 * somebody remembered to mark.
 *
 * **The distance is the overflow, not a fixed percentage**, and the duration is derived from it at a
 * constant speed, so a name that overflows by 20 px takes a fifth as long as one that overflows by 100.
 * A marquee at a constant *duration* reads as frantic on the long names and sleepy on the short ones,
 * which is the usual reason these look cheap.
 *
 * ## `alternate`, not a loop
 *
 * It travels to the end, waits, and comes back — rather than scrolling off one side and reappearing at
 * the other. A bus destination is a name rather than a ticker: the wrap-around treatment implies a
 * sequence continuing, and it also renders the name unreadable at the moment it is split across both
 * edges. The pauses at each end are keyframe plateaus rather than a delay, so one animation holds the
 * whole cycle and there is no timer.
 *
 * ## Reduced motion turns it off and truncation returns
 *
 * Checked in JS rather than only in CSS, because this is not decoration that can simply stop: with the
 * animation suppressed the text must be *truncated*, or a rider who asked for less motion gets a name
 * cut off mid-air with no ellipsis to say so. The same call `JourneyLines` documents for the flip.
 */
export function MarqueeText({
  children,
  className = '',
}: {
  children: string
  className?: string
}) {
  const box = useRef<HTMLSpanElement | null>(null)
  const [overflow, setOverflow] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the effect measures the DOM the text was just written into, so `children` is the trigger rather than a value it reads — re-measure whenever the name changes
  useLayoutEffect(() => {
    const node = box.current
    if (node === null) return
    if (prefersReducedMotion()) {
      setOverflow(0)
      return
    }
    // A pixel of slack: sub-pixel text metrics make `scrollWidth` a hair wider than `clientWidth` on
    // names that visibly fit, and animating that is a shimmer with a duration.
    const distance = node.scrollWidth - node.clientWidth
    setOverflow(distance > SLACK ? distance : 0)
  }, [children])

  if (overflow === 0) {
    return (
      <span ref={box} className={`block truncate ${className}`}>
        {children}
      </span>
    )
  }

  return (
    <span ref={box} className={`block overflow-hidden whitespace-nowrap ${className}`}>
      <span
        className="marquee-text inline-block"
        style={{
          // Both read by the keyframes, so the geometry is declared here beside the measurement that
          // produced it and `index.css` only says how it moves.
          ...({
            '--marquee-travel': `${-overflow}px`,
            '--marquee-duration': `${(overflow / SPEED_PX_PER_S) * 2 + PAUSE_S * 2}s`,
          } as React.CSSProperties),
        }}
      >
        {children}
      </span>
    </span>
  )
}

/** Pixels of overflow below which a name has effectively fitted. */
const SLACK = 1
/** How fast the name travels. Slow enough to read while it moves — this is not a ticker. */
const SPEED_PX_PER_S = 28
/** How long it rests at each end, in seconds. Two of these are inside every cycle. */
const PAUSE_S = 1.6
