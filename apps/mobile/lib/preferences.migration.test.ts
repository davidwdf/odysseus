// The favourite-key migration (ADR-062), tested against **whole persisted blobs** rather than
// against the migration function alone.
//
// The reason is that the function is the easy half. Everything that can silently eat a rider's
// favourites lives in the wiring around it: `persist` only calls `migrate` when the stored
// `version` is a number *and* differs from ours; `partialize` decides what is written back;
// `merge` decides what the store ends up holding. A unit test of `migratePreferences` passes
// happily while `version` is left off the options and the migration never runs on a real device.
//
// So the blobs below are the literal strings `createJSONStorage(() => AsyncStorage)` writes under
// `nextbus.preferences` — `{"state":{…},"version":n}` — and the tests push them through the **real
// store** with only the storage swapped for a Map. Everything asserted is therefore the behaviour
// a rider gets, including what is written back to disk afterwards.
//
// Ids are real Hong Kong ones (the same poles and routes as `packages/core/spec/ids.spec.json`),
// because a synthetic `A:1` would not exercise the grammar the keys are actually made of.

import { describe, expect, it } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'
import { migratePreferences, PREFERENCES_VERSION, usePreferences } from './preferences'

const KMB_POLE = 'KMB:18492910339E23AA'
const KMB_POLE_2 = 'KMB:5BB4A5D9AAF9D5C1'
const CTB_POLE = 'CTB:002403'
const ROUTE_6 = 'KMB:6:outbound:1'
const ROUTE_720 = 'CTB:720:inbound:1'

/** A blob exactly as `persist` writes it. `version` is `0` on every blob written before ADR-062,
 *  because that is `persist`'s default — which is what makes the bump to 1 reach real devices. */
function blob(favoriteRoutes: unknown[], version: number | 'unstamped' = 0): string {
  const state = {
    appearance: 'auto',
    localeOverride: null,
    favoriteRoutes,
    recentRoutes: [ROUTE_6],
    recentStops: [KMB_POLE],
  }
  return version === 'unstamped' ? JSON.stringify({ state }) : JSON.stringify({ state, version })
}

/**
 * Rehydrate the real store from `stored`, with the storage swapped for an in-memory one. Returns
 * the map so a test can read **what was written back** — the migrated blob is what the next launch
 * will load, so a migration that produces the right state in memory and the wrong bytes on disk is
 * still a broken migration.
 */
async function hydrateFrom(stored: string): Promise<Map<string, string>> {
  const disk = new Map<string, string>([['nextbus.preferences', stored]])
  usePreferences.persist.setOptions({
    storage: createJSONStorage(() => ({
      getItem: (name) => disk.get(name) ?? null,
      setItem: (name, value) => {
        disk.set(name, value)
      },
      removeItem: (name) => {
        disk.delete(name)
      },
    })),
  })
  await usePreferences.persist.rehydrate()
  return disk
}

/** The `favoriteRoutes` array in whatever is on "disk" now. */
function savedKeys(disk: Map<string, string>): unknown {
  return JSON.parse(disk.get('nextbus.preferences') as string).state.favoriteRoutes
}

/** The `version` stamp in whatever is on "disk" now. */
function savedVersion(disk: Map<string, string>): unknown {
  return JSON.parse(disk.get('nextbus.preferences') as string).version
}

describe('the store is wired to the migration', () => {
  it('persists at the current version, through the exported migration', () => {
    // The assertion that a unit test of `migratePreferences` cannot make: forgetting either of
    // these two options is silent, and the symptom is a rider's favourites quietly not migrating.
    const options = usePreferences.persist.getOptions()
    expect(options.version).toBe(PREFERENCES_VERSION)
    expect(options.migrate).toBe(migratePreferences)
  })
})

describe('v0 → v1 through a real rehydration', () => {
  it('leaves an already-correct pole-keyed blob alone', async () => {
    const keys = [`${KMB_POLE}|${ROUTE_6}`, `${CTB_POLE}|${ROUTE_720}`]
    const disk = await hydrateFrom(blob(keys))
    expect(usePreferences.getState().favoriteRoutes).toEqual(keys)
    expect(savedVersion(disk)).toBe(1)
  })

  it('expands a multi-member place key onto every member pole', async () => {
    // The bug this whole work package exists for: before 2026-06-15 the star saved the place id,
    // and a place id churns whenever clustering is re-tuned. Left alone, this key resolves to
    // nothing the day the cluster changes — the rider's favourite is simply gone.
    const disk = await hydrateFrom(blob([`P:${CTB_POLE}+${KMB_POLE}|${ROUTE_720}`]))
    expect(usePreferences.getState().favoriteRoutes).toEqual([
      `${CTB_POLE}|${ROUTE_720}`,
      `${KMB_POLE}|${ROUTE_720}`,
    ])
    expect(savedKeys(disk)).toEqual([`${CTB_POLE}|${ROUTE_720}`, `${KMB_POLE}|${ROUTE_720}`])
    expect(savedVersion(disk)).toBe(1)
  })

  it('expands a single-member place key too', async () => {
    await hydrateFrom(blob([`P:${KMB_POLE}|${ROUTE_6}`]))
    expect(usePreferences.getState().favoriteRoutes).toEqual([`${KMB_POLE}|${ROUTE_6}`])
  })

  it('collapses an expansion that duplicates a key the rider already had', async () => {
    // Both saved: the route at the place (old scheme) and the same route at one of its poles
    // (new scheme). Expanding blindly would leave a duplicate, which is not merely untidy — the
    // Favourites tab treats the list as a set, and an un-favourite that removes one copy would
    // appear to do nothing.
    const disk = await hydrateFrom(
      blob([`${KMB_POLE}|${ROUTE_720}`, `P:${CTB_POLE}+${KMB_POLE}|${ROUTE_720}`]),
    )
    expect(savedKeys(disk)).toEqual([`${KMB_POLE}|${ROUTE_720}`, `${CTB_POLE}|${ROUTE_720}`])
  })

  it('preserves keys it cannot parse, in place', async () => {
    // Never delete. `P:…+` is a malformed place id, `MTR:…` is an operator the grammar accepts
    // but no dataset mints yet, and `just-a-string` is corruption. None of them can render, all
    // of them survive — the day the grammar or the dataset widens, they start working again.
    const junk = [`P:${KMB_POLE}+|${ROUTE_6}`, `MTR:TIS|MTR:TML:outbound:1`, 'just-a-string']
    const disk = await hydrateFrom(blob([`${KMB_POLE}|${ROUTE_6}`, ...junk]))
    expect(savedKeys(disk)).toEqual([`${KMB_POLE}|${ROUTE_6}`, ...junk])
  })

  it('is a no-op on a blob already at v1 (idempotence, through the pipeline)', async () => {
    const keys = [`${CTB_POLE}|${ROUTE_720}`, `${KMB_POLE_2}|${ROUTE_6}`]
    const stored = blob(keys, 1)
    const disk = await hydrateFrom(stored)
    expect(usePreferences.getState().favoriteRoutes).toEqual(keys)
    // Untouched bytes: at the current version `migrate` is never called, so nothing is rewritten.
    expect(disk.get('nextbus.preferences')).toBe(stored)
  })

  it('never reaches a blob with no version field — documented, not desired', async () => {
    // `persist` guards with `typeof version === 'number'`, so a version-less blob is loaded
    // verbatim and `migrate` is skipped. No such blob exists (every write this store has made
    // stamped `version: 0`), but the guard is easy to misremember, so it is pinned here: if this
    // test ever fails, zustand changed and the migration's reach changed with it.
    await hydrateFrom(blob([`P:${CTB_POLE}+${KMB_POLE}|${ROUTE_720}`], 'unstamped'))
    expect(usePreferences.getState().favoriteRoutes).toEqual([
      `P:${CTB_POLE}+${KMB_POLE}|${ROUTE_720}`,
    ])
  })
})

describe('migratePreferences on its own', () => {
  const state = (favoriteRoutes: unknown[]) => JSON.parse(blob(favoriteRoutes)).state

  it('is idempotent when the same step runs twice', () => {
    // The property every future step must also hold, because a downgraded blob is re-stamped at
    // our version and can meet a step it has already been through.
    const once = migratePreferences(state([`P:${CTB_POLE}+${KMB_POLE}|${ROUTE_720}`]), 0)
    const twice = migratePreferences(once, 0)
    expect(twice).toEqual(once)
  })

  it('passes a blob from a future version through untouched', () => {
    const future = { ...state([`${KMB_POLE}|${ROUTE_6}`]), somethingNewer: 42 }
    expect(migratePreferences(future, PREFERENCES_VERSION + 1)).toBe(future)
  })

  it('carries every other field across unchanged', () => {
    const before = state([`P:${KMB_POLE}|${ROUTE_6}`])
    const after = migratePreferences(before, 0)
    expect(after.appearance).toBe('auto')
    expect(after.recentRoutes).toEqual([ROUTE_6])
    expect(after.recentStops).toEqual([KMB_POLE])
  })

  it('survives a blob that is not the shape we expect', () => {
    // Storage is a file a rider can corrupt and a browser can truncate. Nothing here may throw:
    // a throw inside `migrate` is caught by `persist` and the whole hydration is abandoned, which
    // loses the theme and the recents as well as the favourites.
    expect(() => migratePreferences(null, 0)).not.toThrow()
    expect(() => migratePreferences({ favoriteRoutes: 'not an array' }, 0)).not.toThrow()
    expect(migratePreferences({ favoriteRoutes: [7, null] }, 0).favoriteRoutes).toEqual([7, null])
    expect(migratePreferences(state([]), Number.NaN)).toEqual(state([]))
  })
})
