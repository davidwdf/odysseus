import { type RefObject, useLayoutEffect, useRef } from 'react'
import { prefersReducedMotion } from '../lib/motion'

/**
 * **Animate an element from where it just was to where it now is** — position and size — whenever
 * `key` changes.
 *
 * The general form of what `useRailFlip` does for bus tokens, extracted because a second thing needed
 * it: the route badge, which moves from the centre of an expanded card to the left end of a collapsed
 * pill and shrinks on the way. A layout change like that cannot be a CSS transition — `justify-content`
 * and `font-size` reflow rather than interpolate, and the element's box is decided by a parent whose
 * own layout changed.
 *
 * ## It stores a RECT, not a node — so a swapped element is fine
 *
 * Worth stating because the obvious assumption is the opposite, and I held it until I measured: the
 * badge is **not** the same DOM node across a collapse, because the two states render different JSX
 * and React remounts it. The travel works anyway, because what is kept between commits is the previous
 * `DOMRect` and the ref simply points at whatever badge exists now.
 *
 * That is the difference from `useRailFlip`, which has to reach for the *outgoing* element before
 * React drops it: a bus moves between rows, so at the moment of the change there are two tokens and it
 * must know which one it came from. Here there is only ever one badge, and "where was the badge last
 * commit" is a question a single rect answers.
 *
 * What it does need is for the ref to be attached on **both** sides of the change. An element that
 * disappears entirely leaves the rect stale, which is what `shownFor` and the zero-width guard below
 * are for.
 *
 * ## Why `key` rather than watching the DOM
 *
 * A `ResizeObserver` would fire for every reflow, including the ones that are not a state change — a
 * name wrapping to two lines, a font loading — and animating those reads as the card twitching. `key`
 * says *this* is the transition worth showing.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, key: string | number): void {
  const before = useRef<DOMRect | null>(null)
  const shownFor = useRef<string | number | null>(null)

  // Measured every commit so the rect is always the one immediately preceding the next change. Reading
  // it in the same layout effect that animates is what keeps it a *previous* rect rather than a stale
  // one: React has committed the DOM by now, and the browser has not painted.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const now = el.getBoundingClientRect()
    const was = before.current
    before.current = now

    if (shownFor.current === key) return
    const first = shownFor.current === null
    shownFor.current = key
    // Nothing to travel from on the first commit, and nothing to travel at all under reduced motion —
    // the element is already where it belongs, which is the state the animation exists to reach.
    if (first || was === null || prefersReducedMotion()) return
    if (was.width === 0 || now.width === 0) return

    const dx = was.left - now.left
    const dy = was.top - now.top
    const scale = was.width / now.width
    // A sub-pixel move is a reflow, not a transition. Animating it would be a flicker with a duration.
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.01) return

    el.animate?.(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, transformOrigin: 'left top' },
        { transform: 'translate(0px, 0px) scale(1)', transformOrigin: 'left top' },
      ],
      { duration: FLIP_MS, easing: FLIP_EASING },
    )
  })
}

/** Matches the card's own `left` transition, because they are one movement seen in two properties. */
const FLIP_MS = 240
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
