import type { LinkOpener, MapTarget } from '@nextbus/ports'

/**
 * The `LinkOpener` port, for a browser — the **first implementation of it anywhere** (WP6-3b).
 *
 * `packages/ports` has declared this interface since WP1-3 and nothing implemented it: `apps/mobile` still
 * carries `lib/openExternal.ts`, whose own doc comment says the `Platform.OS` switch inside it *"exists
 * today only because the port did not exist yet"*. The DOM Place screen needs both members — the basemap
 * credit is a link (ADR-049) and the map hands a coordinate off — so this app implements the port rather
 * than growing a second copy of that switch. `apps/mobile` adopts it when its screens next move.
 *
 * Two constraints the port states and this must keep, both non-negotiable:
 *
 *  · **`noopener` (and `noreferrer`).** Without it the opened page can reach back into ours through
 *    `window.opener`.
 *  · **Google Maps is a deep link and nothing more.** Its terms forbid caching or re-hosting its tiles and
 *    Street View, and forbid showing them beside a non-Google map — which our LandsD basemap is (ADR-049,
 *    ADR-050). Handing the rider off is fine; pulling anything of Google's into a screen is not.
 *
 * Both members are `void` and neither reports failure, which the port argues for at length: once the OS or
 * the browser has the URL we have lost control, so a promise would resolve on *"handed over"* rather than
 * on *"the rider saw the page"* — precision we do not have, which is ADR-008's rule applied to a
 * side effect. A blocked pop-up therefore fails silently, and that is a known rough edge rather than a
 * property of the interface.
 */
export const linkOpener: LinkOpener = {
  open(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  openMap(target: MapTarget): void {
    // A browser has no "maps app" to hand off to, so the web's answer is Google Maps' own search URL — the
    // same one `apps/mobile`'s web branch uses. `label` is deliberately dropped rather than encoded: the
    // `search?query=` form centres on the coordinate exactly, and adding a name makes Google *re-geocode*
    // it and land somewhere near-but-not-here, which for a rider working out which side of the road they
    // are on is the one thing that must not happen.
    linkOpener.open(`https://www.google.com/maps/search/?api=1&query=${target.lat},${target.lng}`)
  },
}
