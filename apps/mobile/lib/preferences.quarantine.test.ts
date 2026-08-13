// @vitest-environment jsdom
//
// The quarantine path (ADR-143), tested through the **real** `mergingStorage` — not a swapped-in map,
// which is what `preferences.migration.test.ts` uses and why it could never see this: the defect lived
// in the storage adapter itself. A corrupt `nextbus.preferences` blob used to reject inside `getItem`,
// `persist` abandoned the hydration, `hydrated` never flipped, and `app/_layout.tsx` held the splash
// (native) or a blank page (PWA) on every launch until the rider cleared app data — a permanent brick
// with the rider's favourites inside it. jsdom, because AsyncStorage's web backend needs a
// `localStorage` to stand on.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { describe, expect, it } from 'vitest'

const KEY = 'nextbus.preferences'
/** A truncated write — the interrupted-flush shape, not exotic garbage. */
const CORRUPT = '{"state":{"favoriteRoutes":["KMB:18492910339E23AA|KMB:6:outbound:1"'

describe('a corrupt preferences blob (ADR-143)', () => {
  it('is quarantined, and the app still opens on the defaults', async () => {
    await AsyncStorage.setItem(KEY, CORRUPT)
    // Import *after* seeding: the store hydrates from the real adapter at module load, which is
    // exactly the launch path that used to hang.
    const { usePreferences, PREFERENCES_QUARANTINE_KEY } = await import('./preferences')
    await usePreferences.persist.rehydrate()

    // The brick assertion: hydration finishes. Before the fix this flag never flipped and the splash
    // was held for ever.
    expect(usePreferences.getState().hydrated).toBe(true)
    expect(usePreferences.getState().favoriteRoutes).toEqual([])

    // The safety assertion: the unreadable bytes were preserved verbatim *before* anything could
    // write over the main key. Clearing app data is no longer the only way out, and it is no longer
    // the destructive one.
    expect(await AsyncStorage.getItem(PREFERENCES_QUARANTINE_KEY)).toBe(CORRUPT)
  })

  it('a healthy blob hydrates normally and quarantines nothing', async () => {
    const { usePreferences, PREFERENCES_QUARANTINE_KEY, PREFERENCES_VERSION } = await import(
      './preferences'
    )
    await AsyncStorage.removeItem(PREFERENCES_QUARANTINE_KEY)
    const favourite = 'KMB:18492910339E23AA|KMB:6:outbound:1'
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({
        state: {
          appearance: 'auto',
          localeOverride: null,
          favoriteRoutes: [favourite],
          recentRoutes: [],
          recentStops: [],
        },
        version: PREFERENCES_VERSION,
      }),
    )
    await usePreferences.persist.rehydrate()
    expect(usePreferences.getState().hydrated).toBe(true)
    expect(usePreferences.getState().favoriteRoutes).toEqual([favourite])
    expect(await AsyncStorage.getItem(PREFERENCES_QUARANTINE_KEY)).toBeNull()
  })
})
