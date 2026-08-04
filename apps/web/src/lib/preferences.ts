import type { Locale } from '@nextbus/core'
import type { Appearance } from '@nextbus/ui'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { safeLocalStorage } from '../adapters/storage'

/**
 * The shell's persisted preferences: **appearance and UI language, and deliberately nothing else.**
 *
 * ## Why this is not `apps/mobile/lib/preferences.ts` under a new name
 *
 * That store holds four more things — `favoriteRoutes`, `recentRoutes`, `recentStops` and a **versioned
 * migration** of the favourite key scheme (ADR-062) whose whole point is that a star a rider curated by
 * hand can never be silently dropped. None of it has a consumer in this app yet: Favourites is WP6-4 and
 * Search's recents are WP6-5. Modelling them here anyway would mean a second copy of that migration —
 * one rule, two implementations, which is the exact shape of every defect Wave 5 found in its own live
 * code. So the store models what the shell uses, and WP6-4 hoists the migration to a home both
 * renderers call when it ports the screen that needs it.
 *
 * ## The storage key is different from `apps/mobile`'s, and that is load-bearing
 *
 * zustand's `persist` writes `partialize`'s output as **the whole blob**: a field the store does not
 * model is not preserved, it is erased. So a store with these two fields writing
 * `nextbus.preferences` would delete every favourite the rider had — not in dev, where Expo is on
 * :8081 and Vite on :8082 and localStorage is per-origin, but at WP6-8, the moment `apps/web` takes
 * over the domain the Expo PWA was installed from. A rider's list would vanish on first launch with no
 * error anywhere.
 *
 * `nextbus.shell.v1` therefore names a *different* blob, so the two cannot collide, and
 * `test/shell-parity.test.ts` asserts the two keys differ by reading the other store's source — the
 * cheapest available guard against a future edit that "tidies" them into one. The cost is that a rider
 * migrating from the Expo PWA re-picks their language and appearance once; the alternative cost was
 * their favourites.
 */
const STORAGE_KEY = 'nextbus.shell.v1'

interface Preferences {
  appearance: Appearance
  /** The manual UI-language override; `null` = follow the browser's ordered language list. */
  localeOverride: Locale | null
  setAppearance: (appearance: Appearance) => void
  setLocaleOverride: (locale: Locale | null) => void
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
      setAppearance: (appearance) => set({ appearance }),
      setLocaleOverride: (localeOverride) => set({ localeOverride }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: ({ appearance, localeOverride }) => ({ appearance, localeOverride }),
    },
  ),
)

/** Exported for `test/shell-parity.test.ts`, which asserts it is not the key the RN store writes. */
export const PREFERENCES_STORAGE_KEY = STORAGE_KEY
