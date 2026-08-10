import { type RefObject, useLayoutEffect, useRef } from 'react'
import { prefersReducedMotion } from '../lib/motion'

/**
 * The rail tokens' travel between rows — the one thing the CSS placement cannot express.
 *
 * A token used to be an absolutely positioned child of the *list*, with a measured `top`, so a bus moving
 * one node down was one number changing on one element and `transition-[top]` animated it. Positioning the
 * token against its own row deletes the measurement — `top: 13px` at a node, `calc(50% + 13px)` on the
 * segment into it, neither of which can go stale — but it also means a bus that moves changes **parent**,
 * and no CSS transition survives a DOM move: the element beside row 7 is destroyed and a fresh one is
 * created beside row 8. Left alone the bus would teleport, and ADR-030 decision 4 asks for the opposite:
 * *"a one-shot ease to the new lane is fine; continuous between-poll motion is not."* A bus that moved is a
 * bus that moved.
 *
 * **This is a measurement, and that is the honest trade.** It is not the one deleted. What went is a
 * *standing* registry: one stale entry left a bus in the wrong place until something else happened to
 * re-measure, which is the defect ADR-108 fixed after it had been shipping for a wave. What is here is a
 * pair of numbers read at the instant of a move, where a wrong answer is half a second of wrong animation
 * that self-corrects on the next commit.
 *
 * Three details are load-bearing.
 *
 *  1. **Identity is the ordinal, and it lives in the DOM.** A re-parented token is a different element, so
 *     nothing can be compared across the commit without an external record — and there is no
 *     `getSnapshotBeforeUpdate` for a function component. `data-bus-ordinal` is that record: the same
 *     ordinal identity `key` has used since ADR-030, read back with one `querySelectorAll`, so this hook
 *     keeps no element registry of its own and is immune to ref attach/detach ordering.
 *  1a. **A change of *position* is not a move; a change of *target* is.** Each token also carries the node
 *     or segment it is on (`data-bus-at`), and the travel only runs when **that** changed. Without it, a
 *     refetch that gives a stop two rows up an arrivals line displaces every bus below it — and the bus
 *     would ease down 16 px it never travelled, visibly lagging its own node for half a second while the
 *     rail moved instantly. Measured in the lab: a reflow above a stationary bus fired a 32 px travel.
 *     The old `transition-[top]` overlay had the identical fault and nobody had watched for it.
 *  2. **Position is `offsetTop`, not `getBoundingClientRect()`.** A rect includes transforms and is
 *     viewport-relative, so a travel still running from the previous commit would poison the next one's
 *     "first", and an ordinary scroll between two commits would read as every bus moving at once. The
 *     offset chain is pure layout, immune to both — available because the row's wrapper is `relative` and
 *     the list is `relative`, so the walk is two hops.
 *  3. **It is gated twice, and only one of the gates is about jsdom.** `element.animate` is absent there,
 *     and so is `matchMedia` — which makes `prefersReducedMotion()` answer `true`, so the conformance
 *     suites never reach a Web Animations call. But reduced motion is a published claim rather than a
 *     convenience (`route-detail.spec.json`: the token's *"tween to a new position"* becomes a cut), and a
 *     media query reaches no `animate()` call — the CSS the transition used to live in did that for free.
 */
export function useRailFlip(
  list: RefObject<HTMLElement | null>,
  routeId: string | undefined,
): void {
  /** Where each bus sat at the end of the previous commit, and which node or segment it was on. */
  const placed = useRef(new Map<string, { at: string; top: number }>())
  const travelling = useRef(new Map<string, Animation>())
  const shown = useRef(routeId)

  /**
   * No dependency array: this has to see *every* commit, because the one in which a bus moves is not
   * distinguishable from here — the same reasoning `useScrollRestoration` writes down. `<StrictMode>`
   * double-invokes it on mount and that is harmless by construction: the second pass measures the same
   * numbers, so every delta is zero.
   */
  useLayoutEffect(() => {
    const root = list.current
    if (root === null) return

    // A direction flip is not a bus moving; it is a different set of buses. The ordinals survive the
    // navigation — react-router keeps this screen mounted across a change of `:id` (ADR-104) — so without
    // this, token 0 of the outbound would slide to token 0 of the inbound's position: a journey that never
    // happened, and the lie the CSS transition tells today. The reverse's rows mount fresh and cascade;
    // its buses should simply appear, which is what an empty record produces.
    if (routeId !== shown.current) {
      shown.current = routeId
      for (const animation of travelling.current.values()) animation.cancel()
      travelling.current.clear()
      placed.current.clear()
    }

    const still = prefersReducedMotion()
    const present = new Set<string>()
    for (const token of root.querySelectorAll<HTMLElement>(`[${BUS_ORDINAL_ATTR}]`)) {
      const ordinal = token.getAttribute(BUS_ORDINAL_ATTR) ?? ''
      present.add(ordinal)
      const at = token.getAttribute(BUS_AT_ATTR) ?? ''
      const to = layoutTop(token, root)
      const was = placed.current.get(ordinal)
      placed.current.set(ordinal, { at, top: to })
      // No record is a bus that has just appeared — the first paint of a route, or one entering the rail —
      // and it appears where it is rather than sliding in from wherever the last one happened to be. The
      // same target at a different offset is the list reflowing underneath a stationary bus, which is not
      // something the bus did.
      if (was === undefined || was.at === at || was.top === to || still) continue
      const from = was.top
      // Cancel a travel still in flight before starting the next: two WAAPI animations on one property
      // compose, so a bus that moved twice inside half a second would otherwise accelerate.
      travelling.current.get(ordinal)?.cancel()
      const travel = token.animate?.(
        [{ transform: `translateY(${from - to}px)` }, { transform: 'translateY(0px)' }],
        { duration: TRAVEL_MS, easing: TRAVEL_EASING },
      )
      if (travel) travelling.current.set(ordinal, travel)
    }

    // A bus that left the rail — reached the terminus, or lost its reading — takes its record with it, so an
    // ordinal a later bus reuses starts as an appearance rather than as a slide across half the route.
    for (const ordinal of [...placed.current.keys()]) {
      if (present.has(ordinal)) continue
      travelling.current.get(ordinal)?.cancel()
      travelling.current.delete(ordinal)
      placed.current.delete(ordinal)
    }
  })
}

/** The attributes a token carries its identity and its target in — read here, written by `RailBusToken`. */
export const BUS_ORDINAL_ATTR = 'data-bus-ordinal'
export const BUS_AT_ATTR = 'data-bus-at'

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
 * How far below `root` an element is laid out.
 *
 * The offset chain rather than a difference of rects, which is what makes it immune to a transform still
 * running and to the rider's scroll position. In jsdom every `offsetTop` is 0 and every `offsetParent` is
 * null, so this answers 0 for every token and no delta is ever non-zero — the hook is inert there before it
 * reaches a single API jsdom lacks.
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
