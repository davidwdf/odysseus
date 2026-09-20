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
  /** True until the rider touches the name: the automatic lap only steers while nobody else is. */
  const lapOwned = useRef(true)
  const [overflow, setOverflow] = useState(0)
  /** True while a lap is in flight — which is not the same as the name being displaced. See below. */
  const [running, setRunning] = useState(false)

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

  /**
   * **One travel, driven twice: out, and back.**
   *
   * The animation is now *just the travel* — home to the far end — rather than a lap with the rests
   * written into its keyframes. Two reasons, and the second is the owner's:
   *
   *  1. The rests are **timers around** a play, which is what they are: a pause is not a keyframe, it is
   *     the animation not running.
   *  2. **A tap can reverse it.** With the rests inside the keyframes and `alternate` doing the return,
   *     `playbackRate = -1` mid-lap replays the *timeline* backwards — which, because the second
   *     iteration is itself reversed, sends the name back to the far end rather than home. With one
   *     travel and an explicit `reverse()`, the playback rate means what it says: flip it and the name
   *     turns round from wherever it has got to, which is exactly what was asked for.
   *
   * The automatic lap is a small script — rest, out, rest, back, park — and it **abandons itself the
   * moment the rider touches the name**. A rider steering beats a schedule, and two things driving one
   * animation is how a tap ends up being undone half a second later.
   */
  useEffect(() => {
    const node = inner.current
    if (node === null || overflow === 0) return
    const duration = (overflow / SPEED_PX_PER_S) * 1000
    const animation = node.animate?.(
      [{ transform: 'translateX(0)' }, { transform: `translateX(${-overflow}px)` }],
      { duration, easing: TRAVEL_EASING, fill: 'both' },
    )
    if (animation === undefined) return
    animation.pause()
    animation.currentTime = 0
    travelling.current = animation
    lapOwned.current = true

    let timer: ReturnType<typeof setTimeout> | undefined
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
      })
    const lap = async () => {
      await wait(HOLD_MS)
      if (!lapOwned.current) return
      setRunning(true)
      animation.play()
      await animation.finished
      if (!lapOwned.current) return
      await wait(END_HOLD_MS)
      if (!lapOwned.current) return
      animation.reverse()
      await animation.finished
      if (!lapOwned.current) return
      setRunning(false)
    }
    // `finished` rejects when the animation is cancelled — which is the cleanup below, and an unhandled
    // rejection there would be noise in a console that should stay quiet.
    lap().catch(() => undefined)

    return () => {
      if (timer !== undefined) clearTimeout(timer)
      animation.cancel()
      travelling.current = null
      setRunning(false)
    }
  }, [overflow])

  /**
   * **The leading fade is the displacement, not the animation's existence.**
   *
   * Switching the mask on when the animation was created was wrong in a way the owner spotted at once:
   * a lap opens with a 1.4 s rest, so for that whole rest the name sat still at home with its first
   * letter dimmed — a fade over nothing, which is the exact thing the mask was supposed to avoid. What
   * the leading edge should say is *there is name to the left of here*, and that is true only in
   * proportion to how far the text has actually moved.
   *
   * So while a lap runs, each frame reads the **real** translation off the element and sets the fade to
   * it, capped at `LEAD_PX`. At home it is zero and the first letter is crisp; a few pixels in, the edge
   * is soft. A `requestAnimationFrame` loop for the ten seconds a lap lasts is cheap, and it needs no
   * registered custom property, no second animation to keep in step, and no arithmetic about phases —
   * the matrix is the source of truth for where the text is.
   */
  useEffect(() => {
    const outer = box.current
    const node = inner.current
    if (!running || outer === null || node === null || overflow === 0) return
    let frame = 0
    const paint = () => {
      // `m41` is the matrix's x translation. Negative while travelling; a bare sign flip rather than
      // `Math.abs`, and a cap by comparison rather than `Math.min` — this is a mask width in pixels, and
      // the derivation gate is right to want arithmetic that *decides* something to live in the kernel.
      const shifted = new DOMMatrix(getComputedStyle(node).transform).m41
      const travelled = shifted < 0 ? -shifted : shifted
      const lead = travelled > LEAD_PX ? LEAD_PX : travelled
      // …and the same rule at the other end, which the first version missed: at the far end of the travel
      // the name's last letter is flush with the box and there is nothing beyond it, so a trailing fade
      // there dims the one word the lap existed to show. Each edge's fade is how much name is hidden past
      // it, capped — full at home for the trailing edge, zero for the leading one, and the reverse at the
      // far end.
      const remaining = overflow - travelled
      const trail = remaining > TRAIL_PX ? TRAIL_PX : remaining
      outer.style.maskImage = maskWith(lead, trail)
      outer.style.webkitMaskImage = maskWith(lead, trail)
      // The painter is also what notices the name has stopped — including after a tap, which has no
      // script to tell it. One place watches the animation, so nothing can disagree about whether the
      // name is moving.
      const animation = travelling.current
      if (animation !== null && animation.playState !== 'running') {
        setRunning(false)
        return
      }
      frame = requestAnimationFrame(paint)
    }
    frame = requestAnimationFrame(paint)
    return () => {
      cancelAnimationFrame(frame)
      // Back to the resting mask: a trailing fade, because a parked name is at home and the rest of it is
      // off to the right, and nothing at the leading edge, because the name starts there.
      outer.style.maskImage = maskWith(0, TRAIL_PX)
      outer.style.webkitMaskImage = maskWith(0, TRAIL_PX)
    }
  }, [running, overflow])

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
      // The resting mask. While a lap runs, the effect above rewrites the leading stop every frame from
      // the name's real displacement — see its note.
      style={REST_FADE}
      // **A touch brings the travel forward**, which is the owner's ask: a rider who wants the rest of a
      // name should not have to wait out the pause. `pointerdown` rather than `onClick`, deliberately —
      // this is not a control and must not become one. There is nothing here to operate: the animation
      // runs by itself, a tap only skips the wait, and a screen reader already has the whole name. A
      // `<button>` here would announce a place name as an operable thing that does nothing audible.
      onPointerDown={() => {
        const animation = travelling.current
        if (animation === null) return
        // **A tap turns the name round from where it is.** Running: flip the playback rate and it
        // reverses mid-stride. Parked at the far end: come home. Parked at home: set off. There is no
        // case where a tap restarts a wait, which is what it used to do — a rider who taps has read the
        // beginning already and is asking for the rest, or has read the rest and wants the beginning.
        lapOwned.current = false
        if (animation.playState === 'running') {
          animation.playbackRate = -animation.playbackRate
        } else {
          const duration = Number(animation.effect?.getTiming().duration ?? 0)
          const at = Number(animation.currentTime ?? 0)
          animation.playbackRate = at >= duration ? -1 : 1
          animation.play()
        }
        setRunning(true)
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
/**
 * How fast the name travels, in px per second — **30, down from 60**, which the owner read as *way* too
 * fast. It is the one number here that is pure taste, and the reason it is a speed rather than a duration
 * is so that taste applies equally to a name that overhangs by 20 px and one that overhangs by 200.
 */
const SPEED_PX_PER_S = 30
/** How long it rests at home before setting off, in ms — a constant, which is the whole point. */
const HOLD_MS = 1400
/** …and how long it holds at the far end, where the rider is reading the part that was hidden. */
const END_HOLD_MS = 1600
/** Ease into the travel and out of it; the plateau either side is what makes that readable. */
const TRAVEL_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'
/**
 * The soft edges. **Both are functions of how much name is hidden past them**: at home the leading fade is
 * zero and the trailing fade is full, at the far end it is the other way round, and in between they trade.
 * A fade is a claim that there is more text behind it, so a fade where there is none — over the first
 * letter at home, or the last letter at the far end — is the claim made falsely.
 *
 * 8 px rather than the 10 it started at: the fade only has to say *this edge is a window, not the end of
 * the word*, and a wide one at a small size reads as a blur on the letter rather than an edge.
 */
const TRAIL_PX = 16
const LEAD_PX = 8
const maskWith = (lead: number, trail: number) =>
  `linear-gradient(to right, transparent 0, black ${lead}px, black calc(100% - ${trail}px), transparent 100%)`
const REST_FADE: React.CSSProperties = {
  maskImage: maskWith(0, TRAIL_PX),
  WebkitMaskImage: maskWith(0, TRAIL_PX),
}
