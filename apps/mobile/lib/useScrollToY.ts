import type { RefObject } from 'react'
import { useCallback } from 'react'
import { Platform, type ScrollView } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'

/** RN-web's `ScrollView.scrollTo()` — and the DOM node's own `.scrollTo({behavior:'smooth'})` — are
 *  no-ops under reanimated v4; only the `.scrollTop` setter moves the list. So on web we set
 *  `scrollTop` directly, and animate it ourselves with a rAF tween (native has a working
 *  `scrollTo({animated})`). See ADR-045. */
type Scroller = ScrollView & { getScrollableNode?: () => HTMLElement | null }

/** Returns `scrollToY(y, animated?)` for an `Animated.ScrollView` ref that works on web + native and
 *  honours the OS "reduce motion" setting (falls back to an instant jump). */
export function useScrollToY(ref: RefObject<ScrollView | null>) {
  const reduceMotion = useReducedMotion()
  return useCallback(
    (y: number, animated = true) => {
      const sv = ref.current as Scroller | null
      const target = Math.max(0, y)
      if (Platform.OS === 'web' && typeof sv?.getScrollableNode === 'function') {
        const node = sv.getScrollableNode()
        if (node) {
          if (animated && !reduceMotion) smoothScrollTop(node, target)
          else node.scrollTop = target
          return
        }
      }
      sv?.scrollTo({ y: target, animated: animated && !reduceMotion })
    },
    [ref, reduceMotion],
  )
}

/** rAF tween of a scroller's `scrollTop` (easeOutCubic). A per-node token cancels a prior tween so
 *  rapid taps don't fight each other. Web-only — guarded by the caller. */
function smoothScrollTop(node: HTMLElement, to: number, duration = 320) {
  const from = node.scrollTop
  const dist = to - from
  if (Math.abs(dist) < 1) {
    node.scrollTop = to
    return
  }
  const n = node as HTMLElement & { __scrollToken?: number }
  n.__scrollToken = (n.__scrollToken ?? 0) + 1
  const token = n.__scrollToken
  const start = performance.now()
  const ease = (t: number) => 1 - (1 - t) ** 3
  const step = (now: number) => {
    if (n.__scrollToken !== token) return // superseded by a newer tween
    const t = Math.min(1, (now - start) / duration)
    node.scrollTop = from + dist * ease(t)
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
