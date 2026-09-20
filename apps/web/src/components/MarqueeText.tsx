import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'

/**
 * **A line of text that scrolls itself when it does not fit** — the route header's answer to an HK
 * terminus name (ADR-171, reworked in ADR-173).
 *
 * `truncate` is the right default nearly everywhere in this app and it is wrong in exactly one place: a
 * header whose whole job is to say *where this bus goes*. *"Tsim Sha Tsui East (Mody Road)"* ellipsised to
 * *"Tsim Sha Tsui East (Mod…"* is a name a rider has to guess at, on the one line they came to the screen
 * to read. So the text travels, once the rider has had a moment to see its beginning, and comes back.
 *
 * ## It measures, and it only animates when the measurement says to
 *
 * `scrollWidth > clientWidth` is the whole condition. A name that fits is a plain truncating span with no
 * animation, no mask and nothing running — which is most names, and it is why this is safe to use on every
 * header rather than on the long ones somebody remembered to mark.
 *
 * **It measures when the box is still**, and the first version did not. A layout effect on mount is the
 * obvious place and the wrong one: the card's own expand animates its width, and a name measured against
 * a box that is still growing reports an overflow that is too large — so the travel overshoots and a name
 * that fits is judged not to. A `ResizeObserver` drives the measurement now and it is debounced until the
 * box has held the same size for `SETTLE_MS`. That also covers the quieter version of the same bug: a
 * first measurement taken before the webfont has loaded, against a fallback face of a different width.
 *
 * ## Speed, not duration — and the pause is a duration, not a percentage
 *
 * The travel runs at a constant `SPEED_PX_PER_S`, so how long it takes is a consequence of how far it has
 * to go: a name that overhangs by 20 px is not slow and one that overhangs by 200 px is not frantic. The
 * **pause is a fixed number of milliseconds** rather than a share of the cycle, which is ADR-173's
 * correction — as a percentage it stretched with the distance, so the longest names, the ones a rider most
 * needs to read, sat still the longest before moving.
 *
 * That pair — a constant speed and a constant pause — cannot be written as one CSS keyframe rule, whose
 * offsets are literals. So the animation is **WAAPI**, with the offsets computed from the measurement.
 * Which buys the other thing the owner asked for: a touch can set `currentTime = 0` and bring the travel
 * forward, where a CSS animation would have to be torn off the element and re-attached to restart.
 *
 * ## `alternate`, not a loop
 *
 * It travels to the end and comes back, rather than scrolling off one side and reappearing at the other. A
 * bus destination is a name rather than a ticker: the wrap-around treatment implies a sequence continuing,
 * and it renders the name unreadable at the moment it is split across both edges. The plateau sits at the
 * **start** of the iteration, so with `alternate` the rest at the home position is twice the rest at the
 * far end — the right asymmetry, because home is where the name reads from its beginning.
 *
 * ## Reduced motion turns it off and truncation returns
 *
 * Checked in JS rather than only in CSS, because this is not decoration that can simply stop: with the
 * animation suppressed the text must be *truncated*, or a rider who asked for less motion gets a name cut
 * off mid-air with no ellipsis to say so. The same call `JourneyLines` documents for the flip.
 */
export function MarqueeText({
  children,
  className = '',
}: {
  children: string
  className?: string
}) {
  const box = useRef<HTMLSpanElement | null>(null)
  const inner = useRef<HTMLSpanElement | null>(null)
  const travelling = useRef<Animation | null>(null)
  const [overflow, setOverflow] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the effect measures the DOM the text was just written into, so `children` is the trigger rather than a value it reads — re-measure whenever the name changes
  useLayoutEffect(() => {
    const node = box.current
    if (node === null) return
    if (prefersReducedMotion()) {
      setOverflow(0)
      return
    }
    let settle: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      // A pixel of slack: sub-pixel text metrics make `scrollWidth` a hair wider than `clientWidth` on
      // names that visibly fit, and animating that is a shimmer with a duration.
      const distance = node.scrollWidth - node.clientWidth
      setOverflow(distance > SLACK ? distance : 0)
    }
    const later = () => {
      if (settle !== undefined) clearTimeout(settle)
      settle = setTimeout(measure, SETTLE_MS)
    }
    later()
    // The box changes size for three reasons and only one of them is a resize: the card's own morph, a
    // rotation, and the webfont arriving. One observer covers all three, and the debounce is what keeps
    // the frames of an animation from each producing an answer.
    //
    // **Degrades rather than crashes where the API is absent**, which is jsdom — the same guard
    // `CollapsingHeader` documents for `IntersectionObserver`, and not a test accommodation: an
    // environment without a `ResizeObserver` should measure once and leave it there.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(later)
    observer?.observe(node)
    // …and the font, which changes the *text's* width without changing the box's, so no resize fires.
    void document.fonts?.ready.then(later)
    return () => {
      observer?.disconnect()
      if (settle !== undefined) clearTimeout(settle)
    }
  }, [children])

  // The travel itself, remade whenever the distance changes — the only thing it depends on, because the
  // speed and the pause are constants and the offsets are arithmetic over them.
  useEffect(() => {
    const node = inner.current
    if (node === null || overflow === 0) return
    const travelMs = (overflow / SPEED_PX_PER_S) * 1000
    const duration = HOLD_MS + travelMs
    const animation = node.animate?.(
      [
        { transform: 'translateX(0)', offset: 0 },
        // The plateau's *end* carries the easing, so the travel eases in and out rather than the whole
        // cycle — a cycle-wide easing spends most of the pause decelerating from nothing.
        { transform: 'translateX(0)', offset: HOLD_MS / duration, easing: TRAVEL_EASING },
        { transform: `translateX(${-overflow}px)`, offset: 1 },
      ],
      { duration, iterations: Number.POSITIVE_INFINITY, direction: 'alternate' },
    )
    travelling.current = animation ?? null
    return () => {
      animation?.cancel()
      travelling.current = null
    }
  }, [overflow])

  if (overflow === 0) {
    return (
      <span ref={box} className={`block truncate ${className}`}>
        {children}
      </span>
    )
  }

  return (
    <span
      ref={box}
      className={`block overflow-hidden whitespace-nowrap ${className}`}
      // **Soft edges, and only on a name that travels.** A hard cut at the rail reads as a rendering
      // fault; a fade reads as *there is more of this*. It is here rather than on every name because a
      // name that fits has no edge to soften — fading the last letter of a name that ends inside its box
      // would be a lie about it.
      style={EDGE_FADE}
      // **A touch brings the travel forward**, which is the owner's ask: a rider who wants the rest of a
      // name should not have to wait out the pause. `pointerdown` rather than `onClick`, deliberately —
      // this is not a control and must not become one. There is nothing here to operate: the animation
      // runs by itself, a tap only skips the wait, and a screen reader already has the whole name. A
      // `<button>` here would announce a place name as an operable thing that does nothing audible.
      onPointerDown={() => {
        if (travelling.current !== null) travelling.current.currentTime = 0
      }}
    >
      <span ref={inner} className="inline-block">
        {children}
      </span>
    </span>
  )
}

/** Pixels of overflow below which a name has effectively fitted. */
const SLACK = 1
/**
 * How long the box must hold still before its width is believed, in ms. Comfortably longer than one
 * animation frame and comfortably shorter than a rider's patience; the card's own morph is 500 ms, and
 * the observer fires again at the end of it.
 */
const SETTLE_MS = 180
/** How fast the name travels, in px per second. Slow enough to read while it moves; not a ticker. */
const SPEED_PX_PER_S = 60
/** How long it rests before setting off, in ms — a constant, which is the whole point. */
const HOLD_MS = 1400
/** Ease into the travel and out of it; the plateau either side is what makes that readable. */
const TRAVEL_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'
/**
 * The soft edges, as a mask on the clipping box — **asymmetric, and that is the point**.
 *
 * The trailing edge is where the name is always cut, so it gets the full fade. The leading edge is only
 * cut while the text is travelling: at home the name starts exactly there, and a 14 px fade over its
 * first letter reads as a rendering fault rather than as *there is more*. 6 px is enough to soften the
 * edge mid-travel and little enough to leave a resting capital legible.
 *
 * The honest version of this grows the leading fade *with* the travel, and it is deliberately not built:
 * it needs a registered custom property animated through WAAPI, whose support across the browsers a
 * rider here actually uses is not something this feature is worth betting on.
 */
const LEAD_PX = 6
const TRAIL_PX = 16
const EDGE_MASK = `linear-gradient(to right, transparent 0, black ${LEAD_PX}px, black calc(100% - ${TRAIL_PX}px), transparent 100%)`
const EDGE_FADE: React.CSSProperties = { maskImage: EDGE_MASK, WebkitMaskImage: EDGE_MASK }
