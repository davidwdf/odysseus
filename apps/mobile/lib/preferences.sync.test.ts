// @vitest-environment jsdom
//
// Two writers, one blob — the Expo PWA's half of `docs/07`'s highest-severity defect (WP6-8a).
//
// WHY THIS SUITE IS IN jsdom WHEN ITS SIBLING IS NOT. `preferences.migration.test.ts` runs in node because
// its subject is pure logic. This one's subject is the *platform*: `AsyncStorage`'s web implementation is
// `window.localStorage` under the **raw** key, which is the whole reason the hazard reaches this app at
// all. So the environment is not scaffolding here, it is the thing under test — every write below really
// does land in a `localStorage` that `apps/web` reads, and the `storage` events are real ones.
//
// WHAT IS SIMULATED AND WHAT IS NOT. The store, the storage and the merge are all real. The only thing
// stood in for is the second browsing context — a direct write to the key, plus a `storage` event where
// the case wants one. The cases that *omit* the event are the important ones: a frozen back/forward-cached
// tab is delivered none, and it is the writer whose in-memory copy is hours stale.
//
// ON A PHONE NONE OF THIS APPLIES, and that is asserted by construction rather than here: the merge and
// the listener are both gated on the same feature test, so a native build still does one write per
// mutation with nothing read in front of it. There is no second writer on a device to merge with.

import { formatFavoriteRouteKey, type Locale } from '@nextbus/core'
import type { Appearance } from '@nextbus/ui'
import { beforeEach, describe, expect, it } from 'vitest'
import { PREFERENCES_VERSION, usePreferences } from './preferences'

/** The key both apps share. Spelled out rather than imported, so a rename in the store fails loudly here. */
const KEY = 'nextbus.preferences'

// Real Hong Kong ids — the same poles and routes the migration suite next door uses.
const POLE_A = 'KMB:18492910339E23AA'
const POLE_B = 'CTB:002403'
const POLE_C = 'KMB:5BB4A5D9AAF9D5C1'
const ROUTE_6 = 'KMB:6:outbound:1'
const ROUTE_720 = 'CTB:720:inbound:1'

const FAV_A = formatFavoriteRouteKey(POLE_A, ROUTE_6)
const FAV_B = formatFavoriteRouteKey(POLE_B, ROUTE_720)
const FAV_C = formatFavoriteRouteKey(POLE_C, ROUTE_6)

interface Blob {
  appearance: Appearance
  localeOverride: Locale | null
  favoriteRoutes: string[]
  recentRoutes: string[]
  recentStops: string[]
}

const DEFAULTS: Blob = {
  appearance: 'auto',
  localeOverride: null,
  favoriteRoutes: [],
  recentRoutes: [],
  recentStops: [],
}

/** Every write here is asynchronous — `persist` starts one and does not await it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** The other writer — a second tab of this app, or `apps/web` on the same origin — saves the blob. */
function otherWriterSaves(state: Partial<Blob>, { notify = true } = {}): void {
  const oldValue = window.localStorage.getItem(KEY)
  const newValue = JSON.stringify({
    state: { ...DEFAULTS, ...state },
    version: PREFERENCES_VERSION,
  })
  window.localStorage.setItem(KEY, newValue)
  if (!notify) return
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: KEY,
      oldValue,
      newValue,
      storageArea: window.localStorage,
    }),
  )
}

function onDisk(): Blob {
  const raw = window.localStorage.getItem(KEY)
  if (raw === null) throw new Error('nothing is on disk')
  return JSON.parse(raw).state as Blob
}

function inMemory(): Blob {
  const { appearance, localeOverride, favoriteRoutes, recentRoutes, recentStops } =
    usePreferences.getState()
  return { appearance, localeOverride, favoriteRoutes, recentRoutes, recentStops }
}

beforeEach(async () => {
  window.localStorage.clear()
  // Rehydrate from the now-empty storage first, so a hydration still in flight from module load cannot
  // land on top of the state a case has just set.
  await usePreferences.persist.rehydrate()
  usePreferences.setState({ ...DEFAULTS })
  // Writing the defaults through the store is what makes this writer's *ancestor* the defaults, which is
  // the state a freshly-loaded tab is in.
  await settle()
  window.localStorage.clear()
})

describe('the Expo PWA writes the blob apps/web reads', () => {
  it('uses the shared key, unprefixed, with the shared envelope and version', () => {
    // The claim ADR-082 decision 5 rests on, measured rather than assumed. `AsyncStorage` on web writes
    // `window.localStorage` under the raw key — no namespace of its own — which is what makes the two apps
    // one blob's worth of writers, and what makes everything below matter.
    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    return settle().then(() => {
      const raw = window.localStorage.getItem(KEY)
      expect(raw, 'the Expo PWA is not writing the shared key').not.toBeNull()
      const parsed = JSON.parse(raw as string)
      expect(Object.keys(parsed).sort()).toEqual(['state', 'version'])
      expect(parsed.version).toBe(PREFERENCES_VERSION)
      expect(parsed.state.favoriteRoutes).toEqual([FAV_A])
    })
  })

  it('spells the key the same way in the sync code as in the persist options', () => {
    // The one drift the store's own `STORAGE_KEY` constant buys: `apps/web/test/shell-parity.test.ts`
    // pulls the key out of this store's *source*, straight from the `persist` option, so that option has
    // to stay a quoted literal and the sync code needs its own copy. Two spellings, one assertion.
    expect(usePreferences.persist.getOptions().name).toBe(KEY)
  })
})

describe('the reproduction from docs/07, from the writer that goes second', () => {
  it('keeps the other writer’s language when this one stars a route — with no event delivered', async () => {
    // The frozen-tab window, which no listener can close: this writer is never told. Before the fix,
    // `partialize` handed `persist` a whole stale blob and the other app's language went back to following
    // the device.
    otherWriterSaves({ localeOverride: 'zh-Hant' }, { notify: false })

    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    await settle()

    expect(onDisk().localeOverride, 'the other writer’s language was overwritten').toBe('zh-Hant')
    expect(onDisk().favoriteRoutes).toEqual([FAV_A])
    expect(inMemory().localeOverride).toBe('zh-Hant')
  })

  it('keeps this writer’s favourites when the other one changes the appearance', async () => {
    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    usePreferences.getState().toggleFavoriteRoute(POLE_B, ROUTE_720)
    await settle()

    otherWriterSaves({ appearance: 'dark', favoriteRoutes: [FAV_A, FAV_B] })
    await settle()

    expect(inMemory().appearance).toBe('dark')
    expect(inMemory().favoriteRoutes).toEqual([FAV_A, FAV_B])
    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_B])
  })

  it('applies an un-star here and a star there in the same round', async () => {
    usePreferences.setState({ favoriteRoutes: [FAV_A, FAV_B] })
    await settle()
    otherWriterSaves({ favoriteRoutes: [FAV_A, FAV_B, FAV_C] }, { notify: false })

    usePreferences.getState().toggleFavoriteRoute(POLE_B, ROUTE_720) // un-star, here
    await settle()

    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_C])
  })
})

describe('a write in another tab reaches this one without a reload', () => {
  it('adopts a language chosen in the other tab', async () => {
    otherWriterSaves({ localeOverride: 'zh-Hans' })
    await settle()
    expect(inMemory().localeOverride).toBe('zh-Hans')
  })

  it('adopts a route starred in the other tab, and an un-star too', async () => {
    otherWriterSaves({ favoriteRoutes: [FAV_A, FAV_C] })
    await settle()
    expect(inMemory().favoriteRoutes).toEqual([FAV_A, FAV_C])

    otherWriterSaves({ favoriteRoutes: [FAV_C] })
    await settle()
    expect(inMemory().favoriteRoutes).toEqual([FAV_C])
  })

  it('ignores a write under any other key', async () => {
    usePreferences.setState({ appearance: 'dark' })
    await settle()
    window.localStorage.setItem('nextbus.query.v1', '{"junk":true}')
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'nextbus.query.v1',
        newValue: '{"junk":true}',
        storageArea: window.localStorage,
      }),
    )
    await settle()
    expect(inMemory().appearance).toBe('dark')
  })

  it('does not let another app’s clear() empty a rider’s list', async () => {
    usePreferences.setState({ favoriteRoutes: [FAV_A] })
    await settle()
    window.localStorage.clear()
    window.dispatchEvent(
      new StorageEvent('storage', { key: null, storageArea: window.localStorage }),
    )
    await settle()

    expect(inMemory().favoriteRoutes).toEqual([FAV_A])
    usePreferences.getState().toggleFavoriteRoute(POLE_C, ROUTE_6)
    await settle()
    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_C])
  })
})

// ── Two of this writer's own changes, before the first one has landed (WP6-8b) ─────────────────
//
// The read-modify-write above is asynchronous — `AsyncStorage.getItem` is a promise even where
// `localStorage` is underneath it — and `persist` starts one per mutation without awaiting the last.
// Two mutations in one task therefore both read the disk *before* either has written, while the
// ancestor advances with each write. The second merge then compares a **forward** ancestor against a
// **backward** snapshot, and `mergeSavedKeys` reads the difference as the other writer having deleted
// the key this writer had just added: the star vanishes from memory and from disk.
//
// No second tab is needed, which is what makes this the worst version of the bug — the machinery that
// exists to stop a rider losing a favourite was, on the web build, the thing losing it. Every case here
// is one rider, one tab, two taps.

describe('two of this writer’s own changes in one task', () => {
  it('keeps both stars when the second lands before the first write has finished', async () => {
    // A rider with something already saved — which is every rider past their first tap, and what puts a
    // blob on disk for the second merge to read a stale copy of.
    usePreferences.getState().toggleFavoriteRoute(POLE_C, ROUTE_6)
    await settle()

    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    usePreferences.getState().toggleFavoriteRoute(POLE_B, ROUTE_720)
    await settle()

    expect(inMemory().favoriteRoutes, 'a star was lost from memory').toEqual([FAV_C, FAV_A, FAV_B])
    expect(onDisk().favoriteRoutes, 'a star was lost from disk').toEqual([FAV_C, FAV_A, FAV_B])
  })

  it('keeps a star made in the same task as another tab’s language change', async () => {
    // The listener's write and the rider's write, overlapping. `adoptRemotePreferences` captures `mine`
    // *before* its own await, so the star made while it was suspended is not in the state it then applies
    // — and applying it is a whole-blob `setState`, so the star is overwritten in memory and merged away
    // on the way to disk.
    otherWriterSaves({ localeOverride: 'zh-Hant' })
    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    await settle()

    expect(inMemory().favoriteRoutes, 'the star was lost from memory').toEqual([FAV_A])
    expect(inMemory().localeOverride).toBe('zh-Hant')
    expect(onDisk().favoriteRoutes, 'the star was lost from disk').toEqual([FAV_A])
    expect(onDisk().localeOverride).toBe('zh-Hant')
  })

  it('keeps an un-star made in the same task as a star', async () => {
    // The other direction: two mutations in one task where one of them is a removal. A serialisation that
    // simply re-read the disk would not be enough on its own — the second merge has to measure against
    // what the first one actually wrote, or the un-star is resurrected by the first write's own bytes.
    usePreferences.setState({ favoriteRoutes: [FAV_A, FAV_B] })
    await settle()

    usePreferences.getState().toggleFavoriteRoute(POLE_B, ROUTE_720) // un-star
    usePreferences.getState().toggleFavoriteRoute(POLE_C, ROUTE_6) // …and star, same task

    await settle()
    expect(inMemory().favoriteRoutes).toEqual([FAV_A, FAV_C])
    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_C])
  })
})

describe('the way the first fix could still lose a mutation (found by adversarial review)', () => {
  it('does not overwrite a mutation that landed while the write was in flight', async () => {
    // 🔴 **The ordering defect, reproduced at microtask depth 3 with nothing mocked.** `commit` reads the
    // disk, merges against `mine`, writes, and then brought memory up to the result. The `setState` was on
    // the wrong side of the `await`: it applies a value computed from `mine`, so anything that mutated the
    // store *during* the write got overwritten by a snapshot that predates it. It is the same
    // "a snapshot that predates an intervening change" shape the queue exists to close, moved from the
    // queue to the trailing assignment.
    //
    // Depth 3 is not arbitrary — it is what an `async` handler that awaits before mutating looks like: a
    // settled query continuation calling `pushRecentStop`, or a star from an awaited handler. Reachable on
    // the Expo **web** build only; on a device `sharedWithOtherWriters()` is false, `merged === mine`, and
    // the trailing `setState` never fires at all.
    otherWriterSaves({ favoriteRoutes: [FAV_C] }, { notify: false })

    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    // Land a second mutation a few microtasks in — inside the window where the write is in flight.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    usePreferences.getState().toggleFavoriteRoute(POLE_B, ROUTE_720)
    await settle()

    // Neither the remote key, nor the first star, nor the one made mid-write may go missing.
    expect(inMemory().favoriteRoutes, 'the mid-write mutation was overwritten').toEqual(
      expect.arrayContaining([FAV_C, FAV_A, FAV_B]),
    )
    expect(onDisk().favoriteRoutes).toEqual(expect.arrayContaining([FAV_C, FAV_A, FAV_B]))
    // And memory and disk agree, which is the property the whole merge exists to keep.
    expect([...inMemory().favoriteRoutes].sort()).toEqual([...onDisk().favoriteRoutes].sort())
  })

  it('treats a blob with no saved-route list as unreadable rather than as an empty one', async () => {
    // The twin of the `apps/web` guard, for the same reason: a parseable envelope merely *missing*
    // `favoriteRoutes` used to be filled out to `[]`, which makes every key look like a remote deletion.
    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    await settle()

    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        state: { appearance: 'dark', localeOverride: null },
        version: PREFERENCES_VERSION,
      }),
    )
    usePreferences.getState().toggleFavoriteRoute(POLE_C, ROUTE_6)
    await settle()

    expect(inMemory().favoriteRoutes, 'the list was read as a remote deletion').toEqual(
      expect.arrayContaining([FAV_A, FAV_C]),
    )
    expect(onDisk().favoriteRoutes).toEqual(expect.arrayContaining([FAV_A, FAV_C]))
  })
})
