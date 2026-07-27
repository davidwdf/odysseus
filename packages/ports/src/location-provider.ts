/**
 * # LocationProvider — permission, then one fix
 *
 * **What a native developer must supply:** a permission check that never prompts, a permission
 * request that does, and a single-shot current position. Three methods.
 *
 * | Platform | Implementation |
 * |---|---|
 * | Web / PWA | `navigator.permissions.query({name:'geolocation'})` + `navigator.geolocation.getCurrentPosition` (**secure context only** — a plain-HTTP dev host gets nothing) |
 * | React Native (today) | `expo-location` — see `apps/mobile/lib/useLocation.ts`, which this interface is lifted from |
 * | iOS | `CoreLocation` (`CLLocationManager`, `requestWhenInUseAuthorization`, `requestLocation`) |
 * | Android | Play Services `FusedLocationProviderClient.getCurrentLocation` + the runtime permission |
 *
 * ## The shape is deliberate: permission is a separate question from position
 *
 * `useLocation` learned this the hard way and the port keeps it. On mount the app checks the
 * *existing* permission **without prompting**; `undetermined` renders contextual priming
 * ("see arrivals near you") and only a rider action calls {@link
 * LocationProvider.requestPermission}. An unexplained OS dialogue on first launch is the single
 * easiest way to lose location access permanently, on every platform.
 *
 * ## What is NOT in this port (and must not be added to it)
 *
 * The hook does three more things, all of which are shared logic sitting *on top* of this port —
 * a native client re-uses the reasoning, not a reimplementation:
 *
 * 1. **Grid-snapping.** Every coordinate is passed through `snapFix` (25 m cells) before it
 *    leaves the device — privacy, edge cacheability and offline replay all depend on it
 *    (`apps/mobile/lib/geoSnap.ts`, WP2-6; moves into `packages/core`). The port returns the
 *    raw platform fix; **snapping is mandatory downstream, not optional.**
 * 2. **Remembering the last fix.** Persisted through {@link KeyValueStore} under
 *    `nextbus.lastFix.v1` and replayed as `stale: true`, which is what lets a cold *offline*
 *    launch paint Nearby instead of an error.
 * 3. **Continuous tracking.** There is no `watch()` here on purpose. We ask for a position when
 *    a screen needs one; a subscription would buy jitter, battery drain and a background-location
 *    review conversation for no rider benefit, since arrivals refresh on their own cadence.
 */
export interface LocationProvider {
  /**
   * The current permission state, **without ever showing a prompt**. Called on mount.
   * Implementations must resolve rather than throw when the platform has no location support
   * at all (a desktop browser with the API blocked) — report `{ status: 'denied', canAskAgain:
   * false }`, which is what the UI already handles.
   */
  permission(): Promise<LocationPermission>
  /**
   * Ask the OS for foreground location permission — this is the call that shows the dialogue,
   * so it must only ever be reached from an explicit rider action.
   */
  requestPermission(): Promise<LocationPermission>
  /**
   * One position, now. Rejects when the platform cannot produce a fix (no GPS and no network —
   * routine on a desktop PWA, and exactly the case where the caller falls back to the
   * remembered fix). Accuracy should be the platform's *balanced* tier: we snap to 25 m cells
   * anyway, so a slower high-accuracy fix is wasted battery.
   */
  currentFix(): Promise<GeoFix>
}

/**
 * Coarse permission state, kept to the three cases the UI actually branches on.
 *
 * `canAskAgain` matters because it changes the copy: while the OS will still prompt we can
 * offer "Enable location"; once it won't, the only honest instruction is "open Settings".
 */
export type LocationPermission =
  | { status: 'undetermined' }
  | { status: 'granted' }
  | { status: 'denied'; canAskAgain: boolean }

/** A WGS84 position. Degrees, exactly as the transit data uses them. */
export interface GeoFix {
  lat: number
  lng: number
}

/**
 * The rider-facing location state machine — the discriminated union
 * `apps/mobile/lib/useLocation.ts` already returns, declared here so iOS and Android drive the
 * same five states instead of inventing their own (and so the priming, denied and stale copy in
 * `@nextbus/i18n` maps 1:1 on every platform).
 *
 * It is *not* produced by {@link LocationProvider} directly: shared logic composes the port's
 * permission and fix results with the remembered-fix fallback to arrive at these states. The
 * one non-obvious member is `stale`, which means "this is a remembered position, not a live
 * one" — the screen says so out loud rather than implying a fix it does not have (ADR-008's
 * honesty rule, applied to position instead of time).
 */
export type LocationState =
  | { status: 'undetermined' } // permission not yet requested — show the priming UI
  | { status: 'loading' } // requesting permission / fetching a fix
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'error'; message: string }
  | { status: 'ready'; lat: number; lng: number; stale?: boolean }
