import type { GeoFix } from '@nextbus/ports'
import { useCallback, useEffect, useRef, useState } from 'react'
import { browserLocationProvider } from '../adapters/location'

/**
 * The rider's own position **for drawing on a map**, with the compass heading where one is available.
 *
 * ## Why this does not go through `createLocationController`
 *
 * The shared controller passes every coordinate through `snapFix` — 25 m cells — before it leaves the
 * device, and that is mandatory for anything sent upstream (privacy, edge cacheability, offline
 * replay; `packages/ports`' own note says so). It is the **wrong** input for a self-position mark, and
 * not as a matter of taste: a snapped position moves in 25 m steps, so a rider walking down a street
 * watches their own dot teleport between grid cells while the map scrolls smoothly underneath. It
 * reads as a broken app rather than as a privacy feature.
 *
 * The distinguishing fact is that **this coordinate never leaves the device**. It is drawn, and then
 * it is gone. Nothing here may be handed to a query, a URL or a fetch — `useLocation` is what those
 * take, and it is snapped.
 *
 * ## Permission is never prompted from here
 *
 * `permission()` is the non-prompting check, and a fix is only requested once it already says
 * `granted`. A map that asked for location on mount is the single easiest way to lose the permission
 * permanently, which is the reasoning the port is built around; the rider grants it through Nearby's
 * priming, and this picks it up afterwards.
 */
export interface RiderPosition {
  fix: GeoFix | undefined
  /** True compass heading in degrees, where the device has one and the rider has permitted it. */
  compassDeg: number | undefined
  /** Ask for compass access. iOS 13+ requires a gesture; elsewhere this simply starts listening. */
  enableCompass: () => void
  /** Whether asking is even possible — false on every desktop browser and in an insecure context. */
  compassAvailable: boolean
}

/** iOS 13+ gates the compass behind a call that must happen inside a user gesture. */
interface OrientationPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

export function useRiderPosition(): RiderPosition {
  const [fix, setFix] = useState<GeoFix | undefined>(undefined)
  const [compassDeg, setCompassDeg] = useState<number | undefined>(undefined)
  /**
   * **Listening starts by itself wherever no permission is required**, and waits for a gesture where
   * one is.
   *
   * iOS 13+ gates `deviceorientation` behind `requestPermission()`, which must be called from a user
   * gesture; everywhere else the events simply flow. Starting automatically in the second case is not
   * a shortcut — a compass reading is not personal data in the way a position is, nothing is stored or
   * sent, and requiring a tap to see which way you are facing would mean most riders never see it.
   *
   * ⚠️ **On iOS this leaves `enableCompass` with no caller**, so an iPhone rider gets course over
   * ground while walking and a dot while standing still. That is correct behaviour under §6b's
   * precedence rather than a bug, and it is still a gap: the dart is the better mark and iOS riders
   * cannot reach it until something offers the gesture. It needs a control, and a control needs
   * deciding rather than inventing.
   */
  const [listening, setListening] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.DeviceOrientationEvent !== 'undefined' &&
      typeof (window.DeviceOrientationEvent as unknown as OrientationPermission).requestPermission !==
        'function',
  )
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    void (async () => {
      const permission = await browserLocationProvider.permission()
      if (permission.status !== 'granted' || cancelled.current) return
      try {
        const next = await browserLocationProvider.currentFix()
        if (!cancelled.current) setFix(next)
      } catch {
        // No fix is a state, not an error: the map simply has no mark on it. The rider is told nothing,
        // because there is nothing they can act on — they already granted permission and the hardware
        // did not answer.
      }
    })()
    return () => {
      cancelled.current = true
    }
  }, [])

  useEffect(() => {
    if (!listening) return
    const onOrientation = (e: DeviceOrientationEvent) => {
      // `webkitCompassHeading` is already degrees clockwise from north. `alpha` is not: it is
      // counter-clockwise from an arbitrary origin unless `absolute` is set, so it is read only when
      // the event claims to be absolute and is converted — an alpha treated as a heading points a
      // rider in a direction that changes every time they restart the app.
      const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
        .webkitCompassHeading
      if (typeof webkit === 'number') return setCompassDeg(webkit)
      if (e.absolute && e.alpha !== null) return setCompassDeg(360 - e.alpha)
    }
    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener)
    window.addEventListener('deviceorientation', onOrientation as EventListener)
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener)
      window.removeEventListener('deviceorientation', onOrientation as EventListener)
    }
  }, [listening])

  const enableCompass = useCallback(() => {
    const api = (globalThis as { DeviceOrientationEvent?: OrientationPermission })
      .DeviceOrientationEvent
    if (typeof api?.requestPermission === 'function') {
      void api.requestPermission().then((state) => {
        if (state === 'granted') setListening(true)
      })
      return
    }
    setListening(true)
  }, [])

  return {
    fix,
    compassDeg,
    enableCompass,
    compassAvailable:
      typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined',
  }
}
