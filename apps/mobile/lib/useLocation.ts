import { createLocationController } from '@nextbus/api-client'
import type { GeoFix, KeyValueStore, LocationProvider, LocationState } from '@nextbus/ports'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { useCallback, useEffect, useRef, useState } from 'react'

export type { LocationState }

export interface UseLocation {
  state: LocationState
  /** Request permission (with the OS prompt) and fetch a fix. Call from a user action. */
  request: () => void
}

/**
 * The Expo half of `LocationProvider` — three methods, no rules.
 *
 * Everything that used to make this file interesting now lives in `createLocationController`
 * (`@nextbus/api-client`, WP4-1): the silent permission check, the remembered-fix fallback, the
 * mandatory `snapFix`, and the batching subtlety about when *not* to emit `loading`. Those are
 * decisions about what a rider sees, so a second renderer has to share them rather than re-derive
 * them — and this file is the part that genuinely differs, which is the platform SDK call.
 */
const expoLocationProvider: LocationProvider = {
  async permission() {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync()
    if (status === 'granted') return { status: 'granted' }
    if (status === 'denied') return { status: 'denied', canAskAgain }
    return { status: 'undetermined' }
  },
  async requestPermission() {
    const { granted, canAskAgain } = await Location.requestForegroundPermissionsAsync()
    return granted ? { status: 'granted' } : { status: 'denied', canAskAgain }
  },
  async currentFix(): Promise<GeoFix> {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    return { lat: pos.coords.latitude, lng: pos.coords.longitude }
  },
}

/** AsyncStorage as `KeyValueStore`. Its API is already the port's, which is why the port looks
 *  like this — it was lifted from what the app was doing rather than designed against nothing. */
const asyncStorageStore: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
}

/**
 * Permission-aware location. On mount it checks the *existing* permission WITHOUT prompting:
 * already-granted → fetch a fix; otherwise → 'undetermined' so the screen can show contextual
 * priming. The OS prompt only fires when `request()` is called.
 *
 * Ten lines of React over a shared controller. `apps/web/src/hooks/useLocation.ts` is the same ten
 * lines over the same controller with a different provider, and that symmetry is the point.
 */
export function useLocation(): UseLocation {
  const [state, setState] = useState<LocationState>({ status: 'loading' })
  const alive = useRef(true)

  const controller = useRef(
    createLocationController({
      provider: expoLocationProvider,
      store: asyncStorageStore,
      emit: setState,
      alive: () => alive.current,
    }),
  ).current

  const request = useCallback(() => {
    void controller.request()
  }, [controller])

  useEffect(() => {
    alive.current = true
    void controller.start()
    return () => {
      alive.current = false
    }
  }, [controller])

  return { state, request }
}
