import { createLocationController } from '@nextbus/api-client'
import type { LocationState } from '@nextbus/ports'
import { useCallback, useEffect, useRef, useState } from 'react'
import { browserLocationProvider } from '../adapters/location'
import { localStorageStore } from '../adapters/storage'

/**
 * Ten lines of React over the shared controller.
 *
 * `apps/mobile/lib/useLocation.ts` is the same ten lines with `expoLocationProvider` and
 * AsyncStorage in place of the two imports above. That symmetry is the deliverable: the permission
 * sequence, the remembered-fix fallback, the mandatory grid-snap and the batching subtlety about when
 * *not* to emit `loading` are all in `@nextbus/api-client`, so neither renderer can drift from the
 * other by having a different opinion about what a rider sees while the GPS warms up.
 */
export function useLocation(): { state: LocationState; request: () => void } {
  const [state, setState] = useState<LocationState>({ status: 'loading' })
  const alive = useRef(true)

  const controller = useRef(
    createLocationController({
      provider: browserLocationProvider,
      store: localStorageStore,
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
