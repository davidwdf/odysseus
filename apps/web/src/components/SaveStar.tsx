import { formatFavoriteRouteKey } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { Star } from 'lucide-react'
import { usePreferences } from '../lib/preferences'
import { useLocale } from '../providers/LocaleProvider'

/**
 * The route-at-stop favourite indicator — the DOM twin of `apps/mobile/components/SaveStar.tsx`, and half
 * of what WP6-7b's parity audit found missing.
 *
 * ## Why this did not exist until now, and why the reason was wrong
 *
 * `place-row.spec.json` called the star **idiom**, *"present on native"*, and `PlaceRow.tsx` carried a
 * comment saying favourites were `apps/web`'s at WP6-4. Both were written on a premise that turned out to be
 * false: that a web rider could favourite *somewhere*. They could not. `toggleFavoriteRoute` had **zero
 * callers** in this app, so the Favourites tab rendered a curated list and offered no way to change it —
 * and retiring `apps/mobile` would have stranded every one. The star is a real control on both renderers
 * now, and `RouteStopSheet` is the other half.
 *
 * ## The key is the member pole, never the place
 *
 * `formatFavoriteRouteKey(stopId, routeId)` over the **member** pole id (ADR-032/042), because a `P:` place
 * id churns whenever the clustering is re-tuned and would orphan a saved favourite. That rule is the
 * kernel's and is corpus-pinned; this file only reads it.
 *
 * ## `hideWhenEmpty`, and why it is not laziness
 *
 * On a Place row the star renders nothing until the route is saved, exactly as on native: an unsaved row
 * stays uncluttered, and the affordance that *creates* a favourite is the route schematic's sheet. So the
 * star is an indicator that happens to be tappable — which is why its accessible name is *"saved"* /
 * *"save"* rather than the sheet's *"Remove favourite"* / *"Add favourite"*.
 */
export function SaveStar({
  stopId,
  routeId,
  size = 22,
  hideWhenEmpty = false,
  className,
}: {
  /** The member pole id the route departs from, e.g. `KMB:ST141` — never a `P:` place id. */
  stopId: string
  routeId: string
  size?: number
  /** Render nothing until the route is saved (the row's favourite indicator). */
  hideWhenEmpty?: boolean
  className?: string
}) {
  const locale = useLocale()
  const key = formatFavoriteRouteKey(stopId, routeId)
  const saved = usePreferences((s) => s.favoriteRoutes.includes(key))
  const toggle = usePreferences((s) => s.toggleFavoriteRoute)

  if (hideWhenEmpty && !saved) return null

  return (
    <button
      type="button"
      // `aria-pressed` rather than a checkbox role: this is a toggle applied on the spot with no submit,
      // which is what the RN twin's `accessibilityState={{ selected }}` says too.
      aria-pressed={saved}
      // The star is a graphic with no text, so without a name it is invisible to a screen reader — the same
      // hole ADR-093 found in the bus token. It carries no text node either, deliberately: a projection
      // compares text, and a word here would appear in every Place-row projection on one renderer only.
      aria-label={t(locale, saved ? 'saved' : 'save')}
      onClick={() => toggle(stopId, routeId)}
      className={`flex h-11 w-11 shrink-0 items-center justify-center border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${className ?? ''}`}
    >
      <Star
        size={size}
        aria-hidden
        className={saved ? 'text-accent' : 'text-subtle'}
        fill={saved ? 'currentColor' : 'none'}
      />
    </button>
  )
}
