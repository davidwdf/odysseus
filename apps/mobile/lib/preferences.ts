import type { Appearance, LiveryId } from '@nextbus/ui'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// Persisted UI preferences (ADR-010: Zustand for theme/favorites; AsyncStorage =
// localStorage on web, native KV on device). Theme has two independent axes:
//   livery     — colour identity (Classic / KMB / Citybus / …)
//   appearance — auto (follow OS) / light / dark
// Every livery ships both modes, so the two combine freely (docs/09 §7, ADR-018).
interface Preferences {
  livery: LiveryId
  appearance: Appearance
  /** Set false until the persisted value has rehydrated (avoids a wrong-theme flash). */
  hydrated: boolean
  setLivery: (livery: LiveryId) => void
  setAppearance: (appearance: Appearance) => void
}

export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      livery: 'classic',
      appearance: 'auto',
      hydrated: false,
      setLivery: (livery) => set({ livery }),
      setAppearance: (appearance) => set({ appearance }),
    }),
    {
      name: 'nextbus.preferences',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ livery, appearance }) => ({ livery, appearance }),
    },
  ),
)

// Flip `hydrated` once the persisted value has loaded, so the first paint can hold
// until we know the user's chosen theme rather than flashing the default.
usePreferences.persist.onFinishHydration(() => usePreferences.setState({ hydrated: true }))
