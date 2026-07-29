import type { GeoFix, LocationProvider } from '@nextbus/ports'

/** How long to wait for a fix before falling back to the remembered cell. A desktop browser with no
 *  GPS can hang on `getCurrentPosition` indefinitely, and the fallback is better than a spinner. */
const FIX_TIMEOUT_MS = 8_000

/**
 * The browser half of `LocationProvider` — three methods, no rules. Everything a rider actually
 * experiences is `createLocationController` in `@nextbus/api-client`, shared with the RN app.
 *
 * Two things the DOM makes different from Expo, both handled here rather than leaking upward:
 *
 *  · **Permissions may not be queryable at all.** `navigator.permissions` is absent in some browsers
 *    and rejects for `{name:'geolocation'}` in others, and a *secure context* is required for
 *    geolocation at all — a plain-HTTP host silently has none. All of that reports as
 *    `{status:'denied', canAskAgain:false}`, which the port's own doc prescribes and the screen
 *    already renders as "open Settings".
 *  · **There is no "request permission" call.** The browser prompts as a side effect of asking for a
 *    position, so `requestPermission` *is* a position request whose result is discarded. That is why
 *    the port's method returns a permission rather than a fix.
 */
export const browserLocationProvider: LocationProvider = {
  async permission() {
    if (!('geolocation' in navigator)) return { status: 'denied', canAskAgain: false }
    // No secure context, no geolocation — and no prompt would ever appear, so `canAskAgain: false` is
    // the honest answer rather than an optimistic one.
    if (!window.isSecureContext) return { status: 'denied', canAskAgain: false }
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' })
      if (result.state === 'granted') return { status: 'granted' }
      if (result.state === 'denied') return { status: 'denied', canAskAgain: false }
      return { status: 'undetermined' }
    } catch {
      // Permissions API missing or refusing the descriptor. We cannot know without prompting, and
      // prompting unasked is the thing the port exists to prevent — so treat it as "not yet decided".
      return { status: 'undetermined' }
    }
  },

  async requestPermission() {
    try {
      await getPosition()
      return { status: 'granted' }
    } catch (err) {
      const denied = (err as GeolocationPositionError)?.code === 1 // PERMISSION_DENIED
      // A timeout or a position-unavailable error is NOT a permission answer: the rider may well have
      // granted it. Reporting `undetermined` keeps the priming UI, which invites another attempt,
      // rather than telling them they refused something they did not.
      return denied ? { status: 'denied', canAskAgain: false } : { status: 'undetermined' }
    }
  },

  async currentFix(): Promise<GeoFix> {
    const pos = await getPosition()
    return { lat: pos.coords.latitude, lng: pos.coords.longitude }
  },
}

/** `getCurrentPosition` as a promise. `enableHighAccuracy` is off on purpose — the controller snaps
 *  every coordinate to a 25 m cell, so a slower, battery-hungrier fix would be discarded precision. */
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: FIX_TIMEOUT_MS,
      maximumAge: 30_000,
    })
  })
}
