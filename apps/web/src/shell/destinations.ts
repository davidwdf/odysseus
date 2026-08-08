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
 * **`owner` was what stopped this table becoming a promise, and as of WP6-7 no destination carries one.**
 * Every one of the eight is a real `apps/web` screen; the field stays declared because it is how the next
 * destination arrives — a route that renders nothing and nobody has agreed to fix is the shape the parity
 * test rejects, and it can only reject it if the field exists to be absent. `Placeholder.tsx` was deleted
 * in the same commit, which is the more honest marker: there is nothing left for it to draw.
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
  { path: '/favorites', titleKey: 'tabFavorites', icon: Star },
  { path: '/settings', titleKey: 'tabSettings', icon: Settings },
]

/** Nearby's path — the first screen ported (WP6-0), and the shell's fallback for an unknown one. */
export const NEARBY_PATH = '/'

/** Settings' path — the sixth ported screen (WP6-7), and the one that retired `ShellPreferences`. */
export const SETTINGS_PATH = '/settings'

/** "About the data" — the attribution page, and the app's only screen of outbound links. */
export const ABOUT_PATH = '/about-data'

/** The FAQ — seven questions, and the eighth and last destination to be ported. */
export const FAQ_PATH = '/faq'

/** Place detail's path — the second ported screen (WP6-3b), and the one a Nearby card heading opens. */
export const PLACE_PATH = '/stop/:id'

/** Favourites' path — the third ported screen (WP6-4b), and the only one whose content a rider authored. */
export const FAVOURITES_PATH = '/favorites'

/**
 * Route detail's path — the fifth ported screen (WP6-6b).
 *
 * The **direction toggle navigates here**, to the reverse route's own id, where the RN screen swaps the
 * direction in local state so Back exits the screen rather than the flip. That is a navigation decision, so
 * it is identity and it is recorded rather than left to each renderer — and a URL that names a direction is
 * one a rider can share.
 */
export const ROUTE_PATH = '/route/:id'

/**
 * Search is reachable from the tab row but is **not a tab** — it is its own page with no tab bar
 * (ADR-037), launched from a button sharing the row at the far right. That is a navigation decision,
 * not a chrome one, so it is identity and it is recorded here rather than left to each renderer.
 */
export const SEARCH: ChromeDestination = {
  path: '/search',
  titleKey: 'tabSearch',
  icon: Search,
}

/** Everything reached by a push rather than by the tab row. */
export const PUSHED: readonly Destination[] = [
  SEARCH,
  { path: '/stop/:id' },
  { path: ROUTE_PATH },
  { path: '/about-data', titleKey: 'aboutData' },
  { path: '/faq', titleKey: 'settingsFaq' },
]

/**
 * Every destination the router serves. A spread rather than a `.filter` over one flat list: which
 * destinations are tabs is a decision, and `scripts/check-no-derivation.mjs` is right to ban a
 * renderer from computing one.
 */
export const DESTINATIONS: readonly Destination[] = [...TABS, ...PUSHED]
