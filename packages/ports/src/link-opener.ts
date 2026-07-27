/**
 * # LinkOpener — hand a destination to the operating system
 *
 * **What a native developer must supply:** two fire-and-forget calls — open a web URL outside
 * the app, and open a coordinate in whatever maps app the platform considers standard.
 *
 * | Platform | `open` | `openMap` |
 * |---|---|---|
 * | Web / PWA | `window.open(url, '_blank', 'noopener,noreferrer')` | a Google Maps search URL in a new tab |
 * | React Native (today) | `Linking.openURL` (`apps/mobile/lib/openExternal.ts`) | per-OS, see below |
 * | iOS | `UIApplication.shared.open` | `https://maps.apple.com/?ll=…` → Apple Maps |
 * | Android | an `ACTION_VIEW` `Intent` | a `geo:lat,lng?q=…` URI — the OS picks the maps app |
 *
 * ## Why `openMap` is a port member rather than a URL built in shared code
 *
 * Because "the maps app" has no cross-platform URL. The three schemes differ in host, in
 * parameter names and in how they take a pin label, and choosing among them is precisely a
 * platform decision — the thing this package exists to name. Shared code should not contain a
 * `Platform.OS` switch to answer it (`openExternal.ts` contains one today only because the port
 * did not exist yet).
 *
 * ## Why both are `void` and neither reports failure
 *
 * Deliberate, and worth stating because it looks like an oversight: once the OS has the URL the
 * app has lost control, so a promise would resolve on "handed over", not on "the rider saw the
 * page" — precision we would not have (the same honesty rule as ADR-008). A blocked pop-up or a
 * device with no maps app therefore fails **silently** today. That is a known rough edge, not a
 * requirement of the interface: see the note in `packages/ports/src/index.ts`.
 *
 * ## Security and licensing constraints a platform implementation must keep
 *
 * - **Web must pass `noopener` (and `noreferrer`).** Without it the opened page can reach back
 *   into ours via `window.opener`. Non-negotiable.
 * - **Only absolute `https:` URLs** (plus the platform's own maps scheme). Never interpolate
 *   rider-supplied text into a URL without encoding it — `openMap`'s `label` is encoded by the
 *   implementation.
 * - **Google Maps is a deep link and nothing more.** Its terms forbid caching or re-hosting
 *   tiles and Street View imagery, and forbid showing them next to a non-Google map — which our
 *   basemap is (ADR-049, ADR-050). Handing the rider off to the Google app or site is fine;
 *   pulling anything of Google's *into* a screen is not.
 */
export interface LinkOpener {
  /**
   * Open an absolute `https:` URL outside the app — a new tab on web, the system browser on
   * native. Used for the basemap copyright notice, the open-data portals and street imagery.
   */
  open(url: string): void
  /**
   * Show a coordinate in the platform's maps app. `label` names the pin where the scheme
   * supports it (Apple Maps `q`, Android `geo:` parentheses); the centre must stay exactly on
   * the given coordinate either way, because the rider is using it to work out which side of
   * the road the stop is on.
   */
  openMap(target: MapTarget): void
}

/** Where to point the maps app. Degrees, WGS84 — the same coordinates as the transit data. */
export interface MapTarget {
  lat: number
  lng: number
  /**
   * Human-readable pin label, already localized by the caller (a stop or place name in the
   * rider's active locale). The implementation URL-encodes it.
   */
  label?: string
}
