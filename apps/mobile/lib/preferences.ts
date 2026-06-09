import type { Locale } from '@nextbus/core'
import type { Appearance } from '@nextbus/ui'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// Persisted UI preferences (ADR-010: Zustand for theme/favorites; AsyncStorage =
// localStorage on web, native KV on device). Axes:
//   appearance    — auto (follow OS) / light / dark   (the one Ink theme, ADR-029)
//   localeOverride— manual UI language; null = follow the device
//   favorites     — canonical stop ids the user has starred
// (docs/09 §7; Slice 2 adds locale + favorites.)
interface Preferences {
  appearance: Appearance
  localeOverride: Locale | null
  favorites: string[]
  /** Set false until the persisted value has rehydrated (avoids a wrong-theme flash). */
  hydrated: boolean
  setAppearance: (appearance: Appearance) => void
  setLocaleOverride: (locale: Locale | null) => void
  toggleFavorite: (stopId: string) => void
}

export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      appearance: 'auto',
      localeOverride: null,
      favorites: [],
      hydrated: false,
      setAppearance: (appearance) => set({ appearance }),
      setLocaleOverride: (localeOverride) => set({ localeOverride }),
      toggleFavorite: (stopId) =>
        set((s) => ({
          favorites: s.favorites.includes(stopId)
            ? s.favorites.filter((id) => id !== stopId)
            : [...s.favorites, stopId],
        })),
    }),
    {
      name: 'nextbus.preferences',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ appearance, localeOverride, favorites }) => ({
        appearance,
        localeOverride,
        favorites,
      }),
    },
  ),
)

// Flip `hydrated` once the persisted value has loaded, so the first paint can hold
// until we know the user's chosen theme rather than flashing the default.
usePreferences.persist.onFinishHydration(() => usePreferences.setState({ hydrated: true }))
