import type { Locale } from '@nextbus/core'
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
// stop — the per-route save UI is a near-term follow-up, so this list stays empty
// until it lands.)
/** Cap on the per-kind recent-search lists. */
const RECENTS_MAX = 8

/** Canonical key for a favourited route-at-stop pair (ADR-032). Split on the first
 *  `|` to recover the stop id (canonical ids carry colons, never a pipe). */
export function favoriteRouteKey(stopId: string, routeId: string): string {
  return `${stopId}|${routeId}`
}

interface Preferences {
  appearance: Appearance
  localeOverride: Locale | null
  /** Favourited route-at-stop pairs, keyed by `favoriteRouteKey(stopId, routeId)`. */
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
          const key = favoriteRouteKey(stopId, routeId)
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
