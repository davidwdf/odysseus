import { type Fix, snapFix } from '@nextbus/core'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { useCallback, useEffect, useState } from 'react'

export type LocationState =
  | { status: 'undetermined' } // permission not yet requested — show the priming UI
  | { status: 'loading' } // requesting / fetching a fix
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'error'; message: string }
  | { status: 'ready'; lat: number; lng: number; stale?: boolean }

export interface UseLocation {
  state: LocationState
  /** Request permission (with the OS prompt) and fetch a fix. Call from a user action. */
  request: () => void
}

// Last known fix, already snapped. Two jobs (WP0-3):
//  - **Instant Nearby.** A cold launch shows the last cell's cached arrivals while the GPS
//    warms up, instead of a spinner for a second or two.
//  - **Offline.** `getCurrentPositionAsync` fails outright with no network on a device
//    without GPS (any desktop PWA), which would leave Nearby stuck on an error even though
//    a perfectly good cached result is sitting in the query cache. Falling back to the last
//    fix is what makes a cold offline load render something.
// Marked `stale: true` so the screen can say so rather than implying it's a live position.
const LAST_FIX_KEY = 'nextbus.lastFix.v1'

async function readLastFix(): Promise<Fix | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_FIX_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Fix>
    if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null
    return { lat: parsed.lat, lng: parsed.lng }
  } catch {
    return null
  }
}

/**
 * Permission-aware location. On mount it checks the *existing* permission WITHOUT
 * prompting: already-granted → fetch a fix; otherwise → 'undetermined' so the screen
 * can show contextual priming. The OS prompt only fires when `request()` is called.
 *
 * Every coordinate leaving this hook is **grid-snapped** (`snapFix` from `@nextbus/core`) — see
 * `packages/core/src/geo-snap.ts` for why that matters for privacy, edge caching and offline replay.
 */
export function useLocation(): UseLocation {
  const [state, setState] = useState<LocationState>({ status: 'loading' })

  /**
   * @param showLoading set `false` when the caller has already painted a remembered fix. React 19
   * batches state updates within one continuation, so a `loading` set here would be coalesced with
   * that paint and the rider would see the spinner anyway — which defeats the whole point of
   * keeping the last fix.
   */
  const fetchFix = useCallback(async (showLoading = true) => {
    if (showLoading) setState({ status: 'loading' })
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const fix = snapFix({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      setState({ status: 'ready', ...fix })
      void AsyncStorage.setItem(LAST_FIX_KEY, JSON.stringify(fix)).catch(() => {})
    } catch (err) {
      const last = await readLastFix()
      if (last) setState({ status: 'ready', ...last, stale: true })
      else setState({ status: 'error', message: (err as Error).message })
    }
  }, [])

  const request = useCallback(() => {
    void (async () => {
      setState({ status: 'loading' })
      try {
        const { granted, canAskAgain } = await Location.requestForegroundPermissionsAsync()
        if (granted) await fetchFix()
        else setState({ status: 'denied', canAskAgain })
      } catch (err) {
        setState({ status: 'error', message: (err as Error).message })
      }
    })()
  }, [fetchFix])

  // Silent check on mount — never prompts.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { status, canAskAgain } = await Location.getForegroundPermissionsAsync()
        if (!active) return
        if (status === 'granted') {
          // Show the last cell immediately so Nearby can paint from cache, then replace it
          // with the live fix. If they're the same cell the query key doesn't move at all.
          const last = await readLastFix()
          if (active && last) setState({ status: 'ready', ...last, stale: true })
          if (active) await fetchFix(!last)
        } else if (status === 'denied') setState({ status: 'denied', canAskAgain })
        else setState({ status: 'undetermined' })
      } catch (err) {
        if (active) setState({ status: 'error', message: (err as Error).message })
      }
    })()
    return () => {
      active = false
    }
  }, [fetchFix])

  return { state, request }
}
