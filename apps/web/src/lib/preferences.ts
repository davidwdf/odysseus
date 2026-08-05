import {
  bumpRecent,
  FAVOURITE_KEY_VERSION,
  formatFavoriteRouteKey,
  type Locale,
  migrateFavouriteKeys,
} from '@nextbus/core'
import type { Appearance } from '@nextbus/ui'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { safeLocalStorage } from '../adapters/storage'

/**
 * The persisted preferences — **all five fields, on the same storage key `apps/mobile` writes** (WP6-4).
 *
 * ## This store deliberately models more than this app uses, and that is the whole point
 *
 * WP6-0 shipped a two-field store on a *different* key (`nextbus.shell.v1`) with the reason written out at
 * length: zustand's `persist` writes `partialize`'s output as **the whole blob**, so a field the store does
 * not model is not preserved, it is **erased**. A two-field store on `nextbus.preferences` would therefore
 * have deleted every favourite a rider had — not in dev, where Expo is on :8081 and Vite on :8082 and
 * localStorage is per-origin, but at WP6-8, the moment this app takes over the domain the Expo PWA was
 * installed from. Silently, on first launch, with no error anywhere.
 *
 * WP6-4 is the row ADR-082 named as inheriting the fix, and the fix is not to share less — it is to model
 * **everything on the blob**. `recentRoutes` and `recentStops` have no consumer here until WP6-5 ports
 * Search; they are held in state and written back unchanged, which is exactly what makes the shared key
 * safe. A field this store *reads* and a field it *preserves* are different jobs, and only the first is
 * optional.
 *
 * ## The version and the migration are the kernel's
 *
 * Two stores now stamp one blob, and the thing that must not differ between them is that number: a store
 * writing a lower version re-runs a completed migration, one writing a higher version makes the next step
 * skip data it has never seen, and neither fails loudly. So `FAVOURITE_KEY_VERSION` and
 * `migrateFavouriteKeys` come from `@nextbus/core` — corpus-pinned by `spec/favourites.spec.json` — and
 * this file holds only the shape, because `Appearance` and `Locale` are things the kernel may not import.
 *
 * ## What a rider loses, stated rather than glossed
 *
 * The two-field `nextbus.shell.v1` blob WP6-0 wrote is **not** migrated into this one. It carried an
 * appearance and a language override and nothing else, it existed for one work package, and re-picking both
 * is two taps — where a migration for scaffolding WP6-7 deletes is a step every future reader has to
 * understand. Favourites were never in it, which is the only thing that would have been worth the code.
 */
const STORAGE_KEY = 'nextbus.preferences'

interface Preferences {
  appearance: Appearance
  /** The manual UI-language override; `null` = follow the browser's ordered language list. */
  localeOverride: Locale | null
  /** Favourited route-at-stop pairs, keyed by `formatFavoriteRouteKey(memberPoleId, routeId)`. */
  favoriteRoutes: string[]
  /** Recently-opened route ids from search, most-recent first — read by Search since WP6-5b. */
  recentRoutes: string[]
  /** Recently-opened stop/place ids from search, most-recent first. */
  recentStops: string[]
  setAppearance: (appearance: Appearance) => void
  setLocaleOverride: (locale: Locale | null) => void
  toggleFavoriteRoute: (stopId: string, routeId: string) => void
  pushRecentRoute: (routeId: string) => void
  pushRecentStop: (stopId: string) => void
  clearRecentRoutes: () => void
  clearRecentStops: () => void
}

/** Exactly what `partialize` writes, and therefore exactly what `migrate` is handed back. */
type PersistedPreferences = Pick<
  Preferences,
  'appearance' | 'localeOverride' | 'favoriteRoutes' | 'recentRoutes' | 'recentStops'
>

/** The persisted schema version — the kernel's, so both stores stamp the same number. */
export const PREFERENCES_VERSION = FAVOURITE_KEY_VERSION

/**
 * The `persist` migration: read the blob's favourite list, hand it to the shared rule, put it back.
 *
 * The twin of `apps/mobile/lib/preferences.ts`'s, and duplicated for the reason ADR-069 decision 7 gives:
 * the *rule* is shared and the *wiring* is not. What would be dangerous is a second implementation of the
 * rebasing, which is why there is not one.
 */
export function migratePreferences(persisted: unknown, version: number): PersistedPreferences {
  const state = persisted as PersistedPreferences | null
  if (!state || !Array.isArray(state.favoriteRoutes)) return state as PersistedPreferences
  const migrated = migrateFavouriteKeys(state.favoriteRoutes, version)
  // The same reference means the rule had nothing to do — see the RN twin's note on why identity matters.
  if (migrated === state.favoriteRoutes) return state
  return { ...state, favoriteRoutes: migrated as string[] }
}

/**
 * No `hydrated` flag, unlike the RN store — and the difference is the storage, not the intent.
 *
 * `apps/mobile` persists through AsyncStorage, which is asynchronous even where it is localStorage
 * underneath, so its root layout holds the splash screen until rehydration finishes or the first paint
 * is in the wrong theme. `safeLocalStorage` is synchronous: `persist` has already read the blob by the
 * time `create` returns, so `main.tsx` can resolve the appearance *before* it renders anything. There
 * is no window to guard.
 */
export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      appearance: 'auto',
      localeOverride: null,
      favoriteRoutes: [],
      recentRoutes: [],
      recentStops: [],
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
      // `bumpRecent` is the kernel's, corpus-pinned: most-recent first, de-duplicated, capped. Two stores
      // writing one blob must not disagree about any of the three (ADR-089).
      pushRecentRoute: (routeId) =>
        set((s) => ({ recentRoutes: bumpRecent(s.recentRoutes, routeId) })),
      pushRecentStop: (stopId) => set((s) => ({ recentStops: bumpRecent(s.recentStops, stopId) })),
      clearRecentRoutes: () => set({ recentRoutes: [] }),
      clearRecentStops: () => set({ recentStops: [] }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => safeLocalStorage),
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

/** Exported for `test/shell-parity.test.ts`, which asserts the two stores now write the *same* key. */
export const PREFERENCES_STORAGE_KEY = STORAGE_KEY
