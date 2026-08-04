import type { PlainMessageKey } from '@nextbus/i18n'
import { type LucideIcon, MapPin, Search, Settings, Star } from 'lucide-react'

/**
 * **The destination set, as data.**
 *
 * ADR-075's invariant/idiom table puts *"the destination set and back semantics"* on the **identity**
 * side and *"bottom tabs vs nav rail vs whatever the platform does"* on the idiom side. So this file is
 * the identity half, written down once and mechanically comparable: `test/shell-parity.test.ts` derives
 * the same set from `apps/mobile/app/**` — the file-based routes expo-router serves — and fails if the
 * two disagree. That test dies with `apps/mobile` at WP6-8, which is correct: it exists to keep the two
 * renderers' destinations identical *while both ship*.
 *
 * **The paths are byte-identical to expo-router's on purpose**, including `/favorites` with its
 * American spelling. CLAUDE.md rule 5 exempts route and file names from British English, and there is a
 * stronger reason to keep it here: a shared destination set means a deep link a rider bookmarked, or a
 * link in a message, resolves the same on either renderer. A URL is not a label.
 *
 * **`owner` is what stops this table becoming a promise.** Every destination except Nearby is still
 * `apps/mobile`'s screen; each names the work package that ports it, and the shell renders a
 * `Placeholder` for it rather than a blank route — declared states, per ADR-075's own "the five states
 * must be distinguishable and non-blank". A destination with no `owner` and no ported screen would be a
 * route that renders nothing and nobody has agreed to fix; the parity test rejects that shape.
 */
export interface Destination {
  /** The URL path — react-router's syntax, which is expo-router's with `[id]` spelled `:id`. */
  readonly path: string
  /**
   * Its name, from `@nextbus/i18n`. Absent for the two id-parameterised screens, whose heading is a
   * *stop* or *route* name — bus data, which arrives as `I18nText` from the model and is therefore not
   * in the catalogue at all (CLAUDE.md rule 5). The placeholder shows the id instead of inventing one.
   */
  readonly titleKey?: PlainMessageKey
  /** The glyph the shell chrome draws for it. Only the tabs and the search launcher have one. */
  readonly icon?: LucideIcon
  /** The Wave 6 work package that ports this screen; absent once it has landed. */
  readonly owner?: string
}

/** A destination the shell chrome draws a control for, which therefore must have a name and a glyph. */
export interface ChromeDestination extends Destination {
  readonly titleKey: PlainMessageKey
  readonly icon: LucideIcon
}

/** The bottom tabs, in tab order — the same three, in the same order, as `apps/mobile/app/(tabs)`. */
export const TABS: readonly ChromeDestination[] = [
  { path: '/', titleKey: 'tabNearby', icon: MapPin },
  { path: '/favorites', titleKey: 'tabFavorites', icon: Star, owner: 'WP6-4' },
  { path: '/settings', titleKey: 'tabSettings', icon: Settings, owner: 'WP6-7' },
]

/** Nearby's path, and the one destination WP6-0 renders a real screen for. */
export const NEARBY_PATH = '/'

/** The destination whose placeholder carries the shell's own locale + appearance controls. */
export const SETTINGS_PATH = '/settings'

/** Place detail's path — the second ported screen (WP6-3b), and the one a Nearby card heading opens. */
export const PLACE_PATH = '/stop/:id'

/**
 * Search is reachable from the tab row but is **not a tab** — it is its own page with no tab bar
 * (ADR-037), launched from a button sharing the row at the far right. That is a navigation decision,
 * not a chrome one, so it is identity and it is recorded here rather than left to each renderer.
 */
export const SEARCH: ChromeDestination = {
  path: '/search',
  titleKey: 'tabSearch',
  icon: Search,
  owner: 'WP6-5',
}

/** Everything reached by a push rather than by the tab row. */
export const PUSHED: readonly Destination[] = [
  SEARCH,
  { path: '/stop/:id' },
  { path: '/route/:id', owner: 'WP6-6' },
  { path: '/about-data', titleKey: 'aboutData', owner: 'WP6-7' },
  { path: '/faq', titleKey: 'settingsFaq', owner: 'WP6-7' },
]

/**
 * Every destination the router serves. A spread rather than a `.filter` over one flat list: which
 * destinations are tabs is a decision, and `scripts/check-no-derivation.mjs` is right to ban a
 * renderer from computing one.
 */
export const DESTINATIONS: readonly Destination[] = [...TABS, ...PUSHED]
