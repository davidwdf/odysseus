import * as Location from 'expo-location'
import { useCallback, useEffect, useState } from 'react'

export type LocationState =
  | { status: 'undetermined' } // permission not yet requested — show the priming UI
  | { status: 'loading' } // requesting / fetching a fix
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'error'; message: string }
  | { status: 'ready'; lat: number; lng: number }

export interface UseLocation {
  state: LocationState
  /** Request permission (with the OS prompt) and fetch a fix. Call from a user action. */
  request: () => void
}

/**
 * Permission-aware location. On mount it checks the *existing* permission WITHOUT
 * prompting: already-granted → fetch a fix; otherwise → 'undetermined' so the screen
 * can show contextual priming. The OS prompt only fires when `request()` is called.
 */
export function useLocation(): UseLocation {
  const [state, setState] = useState<LocationState>({ status: 'loading' })

  const fetchFix = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      setState({ status: 'ready', lat: pos.coords.latitude, lng: pos.coords.longitude })
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message })
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
        if (status === 'granted') await fetchFix()
        else if (status === 'denied') setState({ status: 'denied', canAskAgain })
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
