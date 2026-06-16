import type { NativeStackNavigationOptions } from 'expo-router'
import { useNavigation } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { useReducedMotion } from 'react-native-reanimated'

/**
 * One place for the rules every screen transition follows (ADR-043), so navigation feels
 * consistent and we never re-tune animations per page.
 *
 * Platform note: we run Expo Router's native `<Stack>`. Its `animation` is honoured on
 * iOS/Android but is a **no-op on web** (react-native-web has no native-stack transition) — a
 * deliberate trade we accept to keep the PWA's scrolling/chrome rock-solid (see ADR-043: a JS
 * stack *did* animate on web but broke `Animated.ScrollView` scrolling inside its cards). The
 * one transition that animates on web is the tab cross-fade below. Everything honours
 * `prefers-reduced-motion` (docs/09 §5).
 */

/** Root stack: a sub/detail page slides in from the right; Back slides it off, revealing the page
 *  beneath. Native only for now (web is an instant cut — ADR-043). The `(tabs)` root is the
 *  initial route, so launch shows it with no transition; tab↔tab is the Tabs cross-fade below. */
export function useRootStackScreenOptions(): NativeStackNavigationOptions {
  const reduceMotion = useReducedMotion()
  return useMemo(
    () => ({ headerShown: false, animation: reduceMotion ? 'none' : 'slide_from_right' }),
    [reduceMotion],
  )
}

/** Tab ↔ tab: a quick cross-fade — the one transition that animates identically on web and
 *  native (Bottom Tabs `animation`). Not `shift`: a horizontal slide would fight the floating
 *  glass tab pill. */
export function useTabAnimation(): 'fade' | 'none' {
  return useReducedMotion() ? 'none' : 'fade'
}

/** Fallback delay for `usePageRevealReady` when no slide-in transition fires (web, or the page is
 *  the initial route — a deep link / refresh). A touch longer than a native slide so a real push
 *  has normally ended via its `transitionEnd` event well before this trips. */
const PAGE_REVEAL_FALLBACK_MS = 500

/**
 * The shared rule for the **two-step reveal** (ADR-043): a page first appears, and only *then* —
 * as a deliberate second beat — does it run an entrance action like auto-scrolling to a target.
 * Returns `true` once the page has settled, so that second step never fights an incoming
 * transition.
 *
 * Fires on the stack's opening `transitionEnd` (native); falls back to a timer on web / for the
 * initial route, where nothing animates. Pair it with your own readiness (e.g. data loaded).
 */
export function usePageRevealReady(): boolean {
  const navigation = useNavigation()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    type TransitionEndEvent = { data: { closing: boolean } }
    // `transitionEnd` isn't in the base NavigationProp event map, so attach through a typed
    // handle. `closing` is true on the pop — we only want the opening transition.
    const nav = navigation as unknown as {
      addListener: (type: 'transitionEnd', cb: (e: TransitionEndEvent) => void) => () => void
    }
    const unsub = nav.addListener('transitionEnd', (e) => {
      if (!e.data.closing) setReady(true)
    })
    const fallback = setTimeout(() => setReady(true), PAGE_REVEAL_FALLBACK_MS)
    return () => {
      unsub()
      clearTimeout(fallback)
    }
  }, [navigation])
  return ready
}
