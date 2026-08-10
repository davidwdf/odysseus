import { type RefObject, useLayoutEffect, useRef } from 'react'
import { prefersReducedMotion } from '../lib/motion'

/**
 * The three things that can happen to a bus on the rail — **it enters, it travels, it leaves** — none of
 * which the CSS placement can express.
 *
 * A token used to be an absolutely positioned child of the *list*, with a measured `top`, so a bus moving
 * one node down was one number changing on one element and `transition-[top]` animated it. Positioning the
 * token against its own row deletes the measurement (ADR-110) — `top: 13px` at a node, `calc(50% + 13px)`
 * on the segment into it, neither of which can go stale — but it also means a bus that moves changes
 * **parent**, and no CSS transition survives a DOM move: the element beside row 7 is destroyed and a fresh
 * one is created beside row 8. Left alone the bus would teleport, and ADR-030 decision 4 asks for the
 * opposite: *"a one-shot ease to the new lane is fine; continuous between-poll motion is not."* A bus that
 * moved is a bus that moved.
 *
 * **The travel is a measurement, and that is the honest trade.** It is not the one deleted. What went was a
 * *standing* registry: one stale entry left a bus in the wrong place until something else happened to
 * re-measure, which is the defect ADR-108 fixed after it had been shipping for a wave. What is here is a
 * pair of numbers read at the instant of a move, where a wrong answer is half a second of wrong animation
 * that self-corrects on the next commit.
 *
 * ## The ordinal is a slot, not a bus (ADR-111)
 *
 * `view.buses` is in route order and a token's `key` is its ordinal, which is deliberate and reconciles
 * fine — but **an ordinal is not an identity**. When the lead bus reaches the terminus and leaves the rail,
 * every bus behind it shifts *up* one ordinal, so ordinal 0 is now a different vehicle several stops back.
 * Animating that as a move sends a bus sliding the wrong way up the whole schematic; measured at **1120 px**
 * on a 17-stop rail before this was fixed, and the `transition-[top]` overlay this replaced did the same.
 *
 * So each token also carries **where it is along the route** as one ordered number (`data-bus-at`: a node is
 * its index, a segment the half-step between the two it spans), and tokens are matched to the previous
 * commit's by that coordinate rather than by ordinal, under one physical rule: **a bus travels forward.** A
 * candidate more than one node further along than the token cannot be it. What that rule leaves unmatched is
 * exactly the two events worth drawing — a bus that has **entered** the rail, and one that has **left** it.
 */
export function useRailFlip(
  list: RefObject<HTMLElement | null>,
  /** Where a departed bus is drawn out. A React-owned element whose children React never touches. */
  ghosts: RefObject<HTMLElement | null>,
  routeId: string | undefined,
): void {
  /** Every bus on the rail at the end of the previous commit, in route order. */
  const before = useRef<Placed[]>([])
  const travelling = useRef(new Map<HTMLElement, Animation>())
  const shown = useRef(routeId)

  /**
   * No dependency array: this has to see *every* commit, because the one in which a bus moves is not
   * distinguishable from here — the same reasoning `useScrollRestoration` writes down. `<StrictMode>`
   * double-invokes it on mount and that is harmless by construction: the second pass measures the same
   * coordinates, so nothing enters, moves or leaves.
   */
  useLayoutEffect(() => {
    const root = list.current
    if (root === null) return
    const still = prefersReducedMotion()

    // A direction flip is not a bus moving; it is a different set of buses. The ordinals survive the
    // navigation — react-router keeps this screen mounted across a change of `:id` (ADR-104) — and so would
    // the coordinates, since the reverse direction numbers its own stops from 0. Forgetting them is what
    // makes the reverse's buses *arrive* rather than slide in from the outbound's places, and it is
    // deliberately silent: a flip owes no exit animation for buses that did not go anywhere.
    if (routeId !== shown.current) {
      shown.current = routeId
      for (const animation of travelling.current.values()) animation.cancel()
      travelling.current.clear()
      before.current = []
    }

    const now: Placed[] = [...root.querySelectorAll<HTMLElement>(`[${BUS_ORDINAL_ATTR}]`)].map(
      (el) => ({ el, at: Number(el.getAttribute(BUS_AT_ATTR)), top: layoutTop(el, root) }),
    )

    /*
      Match each bus on screen to the one it was, walking both sequences in route order.

      Both are ascending — `view.buses` is in route order and so is the DOM — so one pointer over the
      previous commit is enough, and the matching it produces cannot cross. A candidate is *plausible* only
      if it is not further along the route than the token it would be matched to, give or take one node: a
      bus moves forward, and an ETA revision can nudge one back by a stop but not by ten.

      What falls out of that rule is the two events. A token with no plausible candidate has **entered** the
      rail; a candidate no token claimed has **left** it.
    */
    const gone: Placed[] = []
    let j = 0
    for (const token of now) {
      const plausible = (candidate: Placed | undefined) =>
        candidate !== undefined && candidate.at <= token.at + BACKWARD_TOLERANCE
      // Anything the *next* candidate fits better is a bus this token is not — it left the rail.
      while (j < before.current.length - 1 && plausible(before.current[j + 1])) {
        const skipped = before.current[j]
        if (skipped !== undefined) gone.push(skipped)
        j += 1
      }
      const was = before.current[j]
      if (was === undefined || !plausible(was)) {
        if (!still) enter(token.el)
        continue
      }
      j += 1
      // The same coordinate at a different offset is the list reflowing underneath a stationary bus, which
      // is not something the bus did — see `data-bus-at`.
      if (was.at === token.at || was.top === token.top || still) continue
      // Cancel a travel still in flight before starting the next: two WAAPI animations on one property
      // compose, so a bus that moved twice inside half a second would otherwise accelerate.
      travelling.current.get(token.el)?.cancel()
      const travel = token.el.animate?.(
        [{ transform: `translateY(${was.top - token.top}px)` }, { transform: 'translateY(0px)' }],
        { duration: TRAVEL_MS, easing: TRAVEL_EASING },
      )
      if (travel) travelling.current.set(token.el, travel)
    }
    for (; j < before.current.length; j += 1) {
      const skipped = before.current[j]
      if (skipped !== undefined) gone.push(skipped)
    }

    before.current = now
    if (still) return
    for (const bus of gone) leave(bus, ghosts.current)
  })
}

/** A bus on the rail: its token, where along the route it is, and how far down the list that puts it. */
interface Placed {
  el: HTMLElement
  at: number
  top: number
}

/** The attributes a token carries its slot and its route coordinate in — written by `RailBusToken`. */
export const BUS_ORDINAL_ATTR = 'data-bus-ordinal'
export const BUS_AT_ATTR = 'data-bus-at'

/**
 * How far *back* along the route a bus may be found and still be the same bus: one node.
 *
 * An ETA revision genuinely moves a bus backwards — a stop's estimate grows, and the bus that was reaching
 * it is now merely approaching it — and that is a move worth drawing. Ten stops backwards is not a
 * revision; it is the ordinal being re-let to a different vehicle.
 */
const BACKWARD_TOLERANCE = 1

/**
 * Today's travel, value for value: `transition-[top] duration-500 ease-out`, where Tailwind 3.4's
 * `ease-out` is `cubic-bezier(0, 0, 0.2, 1)`.
 *
 * `apps/mobile` uses 650 ms on reanimated's default `Easing.inOut(Easing.quad)`, and
 * `route-detail.spec.json` names both numbers in its `idiom` list — so the difference is sanctioned, and
 * changing it would be its own decision rather than a side effect of changing how a token is positioned.
 */
const TRAVEL_MS = 500
const TRAVEL_EASING = 'cubic-bezier(0, 0, 0.2, 1)'

/**
 * A bus entering the rail, and one leaving it — a **pop**, which is a deliberate divergence.
 *
 * `apps/mobile` wraps its token in Reanimated's `FadeIn`/`FadeOut`, so parity would be a plain fade. A bus
 * entering service is a discrete event, and scale is already this token's own vocabulary — `bus-squash` is a
 * scale, anchored at the wheels — so the entrance grows into place with a small overshoot and the exit
 * shrinks away. Not back-ported, per ADR-100's odometer call.
 *
 * The overshoot is the only easing in this app that leaves its own range, and that is what makes it read as
 * *pop* rather than *appear*. The exit is faster and eases **in**, so a departed bus accelerates away rather
 * than lingering on a rail it has left.
 */
const ENTER_MS = 320
const ENTER_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const LEAVE_MS = 220
const LEAVE_EASING = 'cubic-bezier(0.4, 0, 1, 1)'
const SMALL = 'scale(0.3)'
const FULL = 'scale(1)'

function enter(el: HTMLElement): void {
  el.animate?.(
    [
      { transform: SMALL, opacity: 0 },
      { transform: FULL, opacity: 1 },
    ],
    { duration: ENTER_MS, easing: ENTER_EASING },
  )
}

/**
 * Draw a departed bus out — on a **clone**, in a layer of its own.
 *
 * The element that carried it is gone by the time this runs (React removed it), and the row it left from is
 * not necessarily still there either, so the ghost is positioned against the list at the offset the bus last
 * occupied. It is a clone rather than the original because the original may well still be on screen carrying
 * a *different* bus: when the lead departs, React re-uses its element for the bus behind it, and re-adopting
 * that element would tear a live token out of its row.
 *
 * `role`, `aria-label` and both data attributes come off it, which matters twice over — a screen reader must
 * not announce a bus that has left, and the next commit's `querySelectorAll` must not find it and take it
 * for a bus. The layer is `aria-hidden` as well, and React never touches its children because React renders
 * it empty.
 */
function leave(bus: Placed, layer: HTMLElement | null): void {
  if (layer === null || typeof bus.el.animate !== 'function') return
  const ghost = bus.el.cloneNode(true) as HTMLElement
  ghost.removeAttribute('role')
  ghost.removeAttribute('aria-label')
  ghost.removeAttribute(BUS_ORDINAL_ATTR)
  ghost.removeAttribute(BUS_AT_ATTR)
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.top = `${bus.top}px`
  layer.appendChild(ghost)
  // The clone's bob, rock and squash start at phase 0, which over a 220 ms exit is a visible snap.
  for (const animation of ghost.getAnimations?.({ subtree: true }) ?? []) animation.startTime = 0
  const out = ghost.animate(
    [
      { transform: FULL, opacity: 1 },
      { transform: SMALL, opacity: 0 },
    ],
    { duration: LEAVE_MS, easing: LEAVE_EASING },
  )
  const remove = () => ghost.remove()
  out.onfinish = remove
  out.oncancel = remove
}

/**
 * How far below `root` an element is laid out.
 *
 * The offset chain rather than a difference of rects, which is what makes it immune to a transform still
 * running and to the rider's scroll position. In jsdom every `offsetTop` is 0 and every `offsetParent` is
 * null, so this answers 0 for every token and no delta is ever non-zero — the travel is inert there before
 * it reaches a single API jsdom lacks.
 */
function layoutTop(el: HTMLElement, root: HTMLElement): number {
  let y = 0
  let node: HTMLElement | null = el
  while (node !== null && node !== root) {
    y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return y
}
