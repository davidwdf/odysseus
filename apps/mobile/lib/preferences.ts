import {
  FAVOURITE_KEY_VERSION,
  formatFavoriteRouteKey,
  type Locale,
  migrateFavouriteKeys,
} from '@nextbus/core'
import type { Appearance } from '@nextbus/ui'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// Persisted UI preferences (ADR-010: Zustand for theme/favourites; AsyncStorage =
// localStorage on web, native KV on device). Axes:
//   appearance    — auto (follow OS) / light / dark   (the one Ink theme, ADR-029)
//   localeOverride— manual UI language; null = follow the device
//   favoriteRoutes— route-at-stop pairs the user has starred ("the 6 from City One")
// (docs/09 §7; ADR-032: the favourite primitive is a route AT a stop, not a bare
// stop. The keys are minted and read by the shared id grammar in `@nextbus/core`
// — ADR-059 — and their scheme is versioned, so it can change without losing a
// rider's list: ADR-062.)
/** Cap on the per-kind recent-search lists. */
const RECENTS_MAX = 8

interface Preferences {
  appearance: Appearance
  localeOverride: Locale | null
  /** Favourited route-at-stop pairs, keyed by `formatFavoriteRouteKey(memberPoleId, routeId)`. */
  favoriteRoutes: string[]
  /** Recently-opened route ids from search, most-recent first (capped). */
  recentRoutes: string[]
  /** Recently-opened stop/place ids from search, most-recent first (capped). */
  recentStops: string[]
  /** Set false until the persisted value has rehydrated (avoids a wrong-theme flash). */
  hydrated: boolean
  setAppearance: (appearance: Appearance) => void
  setLocaleOverride: (locale: Locale | null) => void
  toggleFavoriteRoute: (stopId: string, routeId: string) => void
  pushRecentRoute: (routeId: string) => void
  pushRecentStop: (stopId: string) => void
  clearRecentRoutes: () => void
  clearRecentStops: () => void
}

// ── The persisted schema and its migration (ADR-062, hoisted by WP6-4) ──────────────────────
// The *rule* — how a favourite key written by an older scheme is brought up to date, and which version
// number stamps the blob — is `@nextbus/core`'s `migrateFavouriteKeys`, corpus-pinned by
// `spec/favourites.spec.json`. It lived here until WP6-4 needed a second store to read the same
// favourites, and the hazard that forced the move is not that two apps might disagree about a display:
// it is that they would stamp **different version numbers on one storage blob**. A store writing a lower
// version re-runs a completed step; one writing a higher version makes the next step skip data it has
// never seen. Neither fails loudly, and the data at stake is a list a rider curated by hand.
//
// What stays here is this store's *shape* — `PersistedPreferences` names `Appearance` and `Locale`, which
// the kernel may not import (ADR-051) — so the adapter below is deliberately the whole of the local half.

/** Exactly what `partialize` writes, and therefore exactly what `migrate` is handed back. */
type PersistedPreferences = Pick<
  Preferences,
  'appearance' | 'localeOverride' | 'favoriteRoutes' | 'recentRoutes' | 'recentStops'
>

/**
 * The persisted schema version — the kernel's, so both stores stamp the same number.
 *
 * Bump `FAVOURITE_KEY_VERSION` there, and add a step to `migrateFavouriteKeys`, when the *meaning* of
 * something already on disk changes. Adding a field is not that: zustand's `merge` already falls back to
 * the initial state for anything the blob does not carry.
 */
export const PREFERENCES_VERSION = FAVOURITE_KEY_VERSION

/**
 * The `persist` migration: read the blob's favourite list, hand it to the shared rule, put it back.
 *
 * One trap worth naming and it is zustand's, not the rule's: `migrate` is only called when the stored
 * `version` is a **number**, so a blob with no version field at all is loaded verbatim and never reaches
 * here. Every blob this store has written carries one (`persist`'s default is 0), so nothing on a real
 * device misses it — and `migrateFavouriteKeys` treats a non-number as the oldest version anyway, because
 * that costs one comparison and the alternative failure is silent.
 */
export function migratePreferences(persisted: unknown, version: number): PersistedPreferences {
  // The one cast: below this line the blob is untrusted data, and above it zustand's `merge`
  // shallow-merges whatever we return over the defaults.
  const state = persisted as PersistedPreferences | null
  if (!state || !Array.isArray(state.favoriteRoutes)) return state as PersistedPreferences
  const migrated = migrateFavouriteKeys(state.favoriteRoutes, version)
  // **The same reference means the rule had nothing to do** — a blob already at, or ahead of, our version.
  // Returning the *same object* rather than an equal one is what "passes it through untouched" means, and
  // `preferences.migration.test.ts` asserts the identity precisely because an equal-but-new object is the
  // shape a future step could quietly start rewriting fields through.
  if (migrated === state.favoriteRoutes) return state
  // `favoriteRoutes: string[]` is a claim about what *we* write; a hand-edited blob can hold anything, and
  // the rule passes an entry it does not understand through untouched rather than dropping it. The cast
  // records that gap rather than a `.filter()` closing it and losing a rider's key.
  return { ...state, favoriteRoutes: migrated as string[] }
}

/** Move `id` to the front of `list`, de-duplicated, capped at `RECENTS_MAX`. */
function bumpRecent(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENTS_MAX)
}

export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      appearance: 'auto',
      localeOverride: null,
      favoriteRoutes: [],
      recentRoutes: [],
      recentStops: [],
      hydrated: false,
      setAppearance: (appearance) => set({ appearance }),
      setLocaleOverride: (localeOverride) => set({ localeOverride }),
      toggleFavoriteRoute: (stopId, routeId) =>
        set((s) => {
          const key = formatFavoriteRouteKey(stopId, routeId)
          return {
            favoriteRoutes: s.favoriteRoutes.includes(key)
              ? s.favoriteRoutes.filter((k) => k !== key)
              : [...s.favoriteRoutes, key],
          }
        }),
      pushRecentRoute: (routeId) =>
        set((s) => ({ recentRoutes: bumpRecent(s.recentRoutes, routeId) })),
      pushRecentStop: (stopId) => set((s) => ({ recentStops: bumpRecent(s.recentStops, stopId) })),
      clearRecentRoutes: () => set({ recentRoutes: [] }),
      clearRecentStops: () => set({ recentStops: [] }),
    }),
    {
      name: 'nextbus.preferences',
      storage: createJSONStorage(() => AsyncStorage),
      version: PREFERENCES_VERSION,
      migrate: migratePreferences,
      partialize: ({ appearance, localeOverride, favoriteRoutes, recentRoutes, recentStops }) => ({
        appearance,
        localeOverride,
        favoriteRoutes,
        recentRoutes,
        recentStops,
      }),
    },
  ),
)

// Flip `hydrated` once the persisted value has loaded, so the first paint can hold
// until we know the user's chosen theme rather than flashing the default.
usePreferences.persist.onFinishHydration(() => usePreferences.setState({ hydrated: true }))
