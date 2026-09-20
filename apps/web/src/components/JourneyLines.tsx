import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'
import { MarqueeText } from './MarqueeText'

/**
 * The route header's from/to lines, and **the lyrics-style swap they run on a direction flip** — the DOM
 * twin of the animation inside `apps/mobile/components/RouteHeader.tsx`.
 *
 * ## What the motion says
 *
 * The old destination *is* the new origin, so it rises from the destination slot into the origin slot,
 * shrinking to origin size and fading from `--text` to `--text-muted` on the way. The old origin slides up
 * and out. The new destination rises in from below. That is ADR-046's reading of a reversal and it is
 * identity under ADR-100 — the same three moves, the same 380 ms, on both renderers.
 *
 * ## Armed on the tap, fired on the words
 *
 * `nonce` *arms* a swap; the swap *runs* when `origin`/`destination` actually change. The two are separate
 * because the reverse payload lands a tick after the tap (or is already cached and lands in the same one),
 * and animating on the tap would run the whole 380 ms against the still-current names and then jump. This is
 * the RN component's `armed` ref, ported as-is.
 *
 * ## Two things this renderer has to do that RN does not
 *
 *  · **Reduced motion is checked in JS, not only in CSS.** Every other animation here is `animation: none`
 *    under the media query and the resting markup is correct without it — but a swap puts *four* lines in
 *    the tree at once, and killing the keyframes would leave two origins and two destinations stacked for
 *    380 ms. So a rider who asked for less motion never enters the swap state at all.
 *  · **The direction is no longer drawn in here at all.** It used to be an `ArrowDown` inside the
 *    destination's own line, which had to hand over on a flip — a destination rising into the origin slot
 *    would otherwise have carried an arrow into a slot that has none. ADR-170 moves the direction into
 *    `JourneyRail`, a column of the schematic's own marks beside these two names: a terminus square at
 *    each end with its sequence number, and one double chevron on the line between them. The rail does
 *    not move on a flip, so there is nothing left to hand over — the numerals it prints simply become the
 *    new direction's. `jl-glyph-out` is retired with the arm it animated.
 */
export function JourneyLines({
  origin,
  destination,
  nonce,
}: {
  origin: string
  destination: string
  /** Advances on each flip — arms a swap. */
  nonce: number
}) {
  const [shown, setShown] = useState({ origin, destination })
  const [incoming, setIncoming] = useState<{ origin: string; destination: string } | null>(null)
  // The freshest names, read by the teardown: a second flip inside 380 ms must settle on the latest pair
  // rather than on the one that was incoming when the timer started.
  const latest = useRef({ origin, destination })
  latest.current = { origin, destination }
  const lastNonce = useRef(nonce)
  const armed = useRef(false)

  // Arms on the nonce; the names effect below is what fires it.
  useEffect(() => {
    if (nonce === lastNonce.current) return
    lastNonce.current = nonce
    if (!prefersReducedMotion()) armed.current = true
  }, [nonce])

  // biome-ignore lint/correctness/useExhaustiveDependencies: run the swap, or plainly mirror the props
  useEffect(() => {
    if (armed.current) {
      armed.current = false
      setIncoming({ origin, destination })
    } else if (incoming === null) {
      setShown({ origin, destination })
    }
  }, [origin, destination])

  // A timer rather than `animationend`, for `SlideNumber`'s reason: three animations finish here and only
  // one of them needs to be the one listened to, which is a fact about the CSS that this file should not
  // have to know. Reset on every new `incoming`, so a flip landing mid-swap collapses to the newest pair.
  useEffect(() => {
    if (incoming === null) return
    const timer = setTimeout(() => {
      setShown(latest.current)
      setIncoming(null)
    }, SWAP_MS)
    return () => clearTimeout(timer)
  }, [incoming])

  // At rest: two lines in flow, no layers and no animation machinery at all — the same discipline
  // `SlideNumber` keeps, and for the same reason. A conformance projection reads text by presence
  // (ADR-097), so a header that kept both journeys mounted would project four lines for one route.
  if (incoming === null) {
    return (
      <span className="flex w-full flex-col" style={{ gap: GAP }}>
        <span className="flex items-center" style={{ height: SLOT }}>
          <span className={`block w-full ${NAME_TYPE} text-muted`} style={ORIGIN_TYPE}>
            <MarqueeText>{shown.origin}</MarqueeText>
          </span>
        </span>
        {/* `data-journey-destination` is a handle, not a hook: `RouteContextCard` measures this line on a
            collapse so the card can carry it to where the island's line will be (ADR-178). A data
            attribute rather than a ref through three components, and rather than a class, because it is
            an address rather than a style. */}
        <span className="flex items-center" style={{ height: SLOT }}>
          <span data-journey-destination className={`block w-full ${NAME_TYPE} text-text`}>
            <MarqueeText>{shown.destination}</MarqueeText>
          </span>
        </span>
      </span>
    )
  }

  return (
    <span
      className="relative block w-full"
      style={{
        height: BOX_H,
        // The keyframes read these, so the geometry is declared once, here, beside the markup it describes.
        ...({
          '--jl-origin-lh': `${SLOT}px`,
          '--jl-dest-top': `${DEST_TOP}px`,
          '--jl-dest-lh': `${SLOT}px`,
          '--jl-shrink': `${SHRINK}`,
        } as React.CSSProperties),
      }}
    >
      {/* The old origin: up and out. */}
      <span
        aria-hidden
        className={`jl-origin-out absolute inset-x-0 block truncate ${NAME_TYPE} text-muted`}
        style={{ top: 0, lineHeight: `${SLOT}px`, ...ORIGIN_TYPE }}
      >
        {shown.origin}
      </span>
      {/* The old destination, becoming the new origin. Not `aria-hidden`: it is the one line of the four
          that is still true at both ends of the animation.

          **`transformOrigin: left` is the whole reason the names are one size now.** The shrink is a
          `scale`, and a scale about the centre slides the text sideways as it shrinks — invisible while
          both slots were centred, and a lurch the moment they share a left edge. */}
      <span
        className={`jl-rise absolute inset-x-0 flex items-center truncate ${NAME_TYPE}`}
        style={{ top: 0, height: SLOT, transformOrigin: 'left center' }}
      >
        <span className="truncate">{shown.destination}</span>
      </span>
      {/* The new destination, rising in. */}
      <span
        className={`jl-dest-in absolute inset-x-0 flex items-center truncate ${NAME_TYPE} text-text`}
        style={{ top: DEST_TOP, height: SLOT, transformOrigin: 'left center' }}
      >
        <span className="truncate">{incoming.destination}</span>
      </span>
    </span>
  )
}

/**
 * **The two slots, and why they are the same size.**
 *
 * The header's from/to block is two rows of a schematic now (ADR-167/169): a terminus node beside each
 * name, a rail between them. Each row is `SLOT` tall, which is the node's own size, so a name is centred
 * against the square that numbers it.
 *
 * The names are **one type — `text-body` medium — and the origin is scaled to `SHRINK` rather than set
 * smaller.** The owner's read of the first build was that the destination was heavy: 18 px semibold is a
 * heading, and this is a line of information under a badge that is already shouting. 16 medium, with the
 * origin muted, leaves the destination the loudest thing in the block without it being loud. That is the owner's note and it is about the flip rather than about the resting picture:
 * `jl-rise` moves the old destination into the origin slot *and* shrinks it, so two different
 * `font-size`s make the animation reconcile a scale with a size change — a 20 px line becoming a 14 px
 * line by way of a transform that does not agree with either. One size and one weight leaves the rise a
 * pure interpolation of one property, which is what it looked like it was doing all along.
 *
 * `SHRINK` is 0.85 rather than a ratio of two sizes for the same reason: there is no second size to take a
 * ratio of. 16 × 0.85 renders at about 13.6 — near the scale's `caption`, and the origin is muted as well
 * as smaller, which is the owner's ask that it be *less prominent* rather than merely shorter.
 */
const NAME_TYPE = 'text-body font-medium'
const SLOT = 22
const GAP = 14
const SHRINK = 0.85
const DEST_TOP = SLOT + GAP
const BOX_H = DEST_TOP + SLOT

/** The origin's resting *geometry*. Its colour is a class (`text-muted`), because a colour that a
 *  keyframe has to interpolate must be a property the animation can see — see `jl-rise`. */
const ORIGIN_TYPE: React.CSSProperties = {
  transform: `scale(${SHRINK})`,
  transformOrigin: 'left center',
}

/**
 * The geometry the header's rail is drawn from, so the nodes and the names cannot disagree about where a
 * row is. Exported rather than duplicated: `JourneyRail` draws a square at each slot's centre and a line
 * between them, and it has no other way to know where those centres are.
 */
export const JOURNEY_SLOT = { slot: SLOT, gap: GAP, height: BOX_H } as const

/** `apps/mobile`'s swap duration, value for value. */
const SWAP_MS = 380
