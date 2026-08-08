import { ArrowDown, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

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
 *  · **The arrow hands over rather than riding along.** On the RN header the direction glyph sits outside
 *    the name box; here it is inside the destination line, so a destination rising into the origin slot
 *    would carry an arrow into a slot that has none. It fades with its own line and fades in with the new
 *    one — which is the honest reading anyway: the glyph belongs to the destination.
 */
export function JourneyLines({
  origin,
  destination,
  circular,
  nonce,
}: {
  origin: string
  destination: string
  /** A loop glyph for a circular service, a direction-of-travel arrow otherwise. */
  circular: boolean
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

  const glyph = circular ? (
    <RotateCw size={GLYPH_SIZE} className="shrink-0 text-subtle" aria-hidden />
  ) : (
    <ArrowDown size={GLYPH_SIZE} className="shrink-0 text-subtle" aria-hidden />
  )

  // At rest: two lines in flow, no layers and no animation machinery at all — the same discipline
  // `SlideNumber` keeps, and for the same reason. A conformance projection reads text by presence
  // (ADR-097), so a header that kept both journeys mounted would project four lines for one route.
  if (incoming === null) {
    return (
      <span className="flex flex-col items-center gap-0.5">
        <span className="block max-w-full truncate text-label font-normal text-muted">
          {shown.origin}
        </span>
        <span className="flex max-w-full items-center gap-1.5">
          {glyph}
          <span className="truncate">{shown.destination}</span>
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
          '--jl-origin-lh': `${ORIGIN_LINE}px`,
          '--jl-dest-top': `${DEST_TOP}px`,
          '--jl-dest-lh': `${DEST_LINE}px`,
          '--jl-shrink': `${ORIGIN_SIZE / DEST_SIZE}`,
        } as React.CSSProperties),
      }}
    >
      {/* The old origin: up and out. */}
      <span
        aria-hidden
        className="jl-origin-out absolute inset-x-0 block truncate text-center text-label font-normal text-muted"
        style={{ top: 0, lineHeight: `${ORIGIN_LINE}px` }}
      >
        {shown.origin}
      </span>
      {/* The old destination, becoming the new origin. Not `aria-hidden`: it is the one line of the four
          that is still true at both ends of the animation. */}
      <span
        className="jl-rise absolute inset-x-0 flex items-center justify-center gap-1.5 truncate"
        style={{ top: 0, height: DEST_LINE }}
      >
        <span className="jl-glyph-out flex shrink-0">{glyph}</span>
        <span className="truncate">{shown.destination}</span>
      </span>
      {/* The new destination, rising in. */}
      <span
        className="jl-dest-in absolute inset-x-0 flex items-center justify-center gap-1.5 truncate"
        style={{ top: DEST_TOP, height: DEST_LINE }}
      >
        {glyph}
        <span className="truncate">{incoming.destination}</span>
      </span>
    </span>
  )
}

/**
 * The name box's geometry, measured off the resting header rather than guessed: the origin line is
 * `text-label` at 14/20 and the destination inherits `--ch-label-size` at 20/25, two pixels apart. The RN
 * header's numbers are 13/18 and 15/22 — different type scale, same three slots, which is exactly the split
 * ADR-100 draws between the motion (identity) and its metrics (idiom).
 */
const ORIGIN_SIZE = 14
const DEST_SIZE = 20
const ORIGIN_LINE = 20
const DEST_LINE = 25
const GAP = 2
const DEST_TOP = ORIGIN_LINE + GAP
const BOX_H = DEST_TOP + DEST_LINE
const GLYPH_SIZE = 14
/** `apps/mobile`'s swap duration, value for value. */
const SWAP_MS = 380

/**
 * Whether the rider has asked for less motion. Guarded like `lib/appearance.ts`'s dark-mode query, and for
 * the same two reasons: `matchMedia` is absent in some embedded WebViews and in jsdom, where every
 * conformance suite runs — and there, *not* animating is the safe answer.
 */
function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
