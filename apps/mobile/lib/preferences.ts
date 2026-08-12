import {
  bumpRecent,
  FAVOURITE_KEY_VERSION,
  formatFavoriteRouteKey,
  type Locale,
  mergePreferences,
  migrateFavouriteKeys,
} from '@nextbus/core'
import type { Appearance } from '@nextbus/ui'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { type PersistStorage, persist, type StorageValue } from 'zustand/middleware'

// Persisted UI preferences (ADR-010: Zustand for theme/favourites; AsyncStorage =
// localStorage on web, native KV on device). Axes:
//   appearance    — auto (follow OS) / light / dark   (the one Ink theme, ADR-029)
//   localeOverride— manual UI language; null = follow the device
//   favoriteRoutes— route-at-stop pairs the user has starred ("the 6 from City One")
// (docs/09 §7; ADR-032: the favourite primitive is a route AT a stop, not a bare
// stop. The keys are minted and read by the shared id grammar in `@nextbus/core`
// — ADR-059 — and their scheme is versioned, so it can change without losing a
// rider's list: ADR-062.)
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

// `bumpRecent` and its cap are `@nextbus/core`'s since WP6-5b, corpus-pinned — because two stores now write
// the same blob (ADR-089) and a cap that differed between them would make a rider's history grow or shrink
// depending on which app they last used.

// ── More than one writer, on web only (WP6-8a) ─────────────────────────────────────────────────
//
// On a phone this store is the only writer of `nextbus.preferences`, so the merge below has nothing to do.
// **On web it is not**, and that is not a hypothetical: `AsyncStorage`'s web implementation is
// `window.localStorage` under the raw key, so a second tab of the Expo PWA and `apps/web` on the same
// origin are both writing this exact blob (ADR-082 decision 5). `persist` reads it once, at load, and
// writes `partialize`'s output as the **whole** blob — so a stale writer's next write does not fail to see
// the other's change, it *deletes* it, favourites included.
//
// The merge is `@nextbus/core`'s `mergePreferences`, corpus-pinned, for the reason that put the version
// stamp and `bumpRecent` there: two writers of one blob resolving a conflict differently converge on
// nothing, silently. The wiring is each app's own (ADR-069 decision 7) and `apps/web/src/lib/preferences.ts`
// carries the twin of it with the long argument.
//
// **On native there is nothing to merge, and no read is bought.** The merge is gated on the same feature
// test the listener is, so an iOS or Android build still does one write per mutation with nothing read in
// front of it: there is no second writer there, and paying a storage read per tap for a case that cannot
// arise is the kind of cost that gets copied forward. What native *does* now inherit is the write queue
// below — `AsyncStorage` promises no ordering between two writes in flight, so one write at a time is the
// stronger guarantee on a device as well, and it costs a promise.

/**
 * The storage key, spelled here **as well as** in the `persist` options below.
 *
 * The duplication is deliberate and load-bearing: `apps/web/test/shell-parity.test.ts` reads this file's
 * *source* and pulls the storage key straight out of the `persist` option below, to prove the two apps
 * share one blob — so that option has to stay a quoted literal rather than becoming a reference to this
 * constant. `lib/preferences.sync.test.ts` asserts the two spellings agree, which is the drift this would
 * otherwise buy. (Do not paste that suite's pattern into a comment here either: it takes the *first*
 * match in the file, and a comment quoting it is a match.)
 */
const STORAGE_KEY = 'nextbus.preferences'

/** Is this the web build, where the blob has other writers and a `storage` event to hear them by? */
const sharedWithOtherWriters = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.addEventListener === 'function' &&
  typeof window.localStorage !== 'undefined'

// ── THE PRECONDITION THE FIRST VERSION OF THIS BROKE (WP6-8b) ──────────────────────────────────
//
// A three-way merge is only as good as its ancestor, and `base` has a precondition that is about *time*
// rather than about types: **the `theirs` it is compared against must be a snapshot of the blob taken
// after `base` was written.** Violate it and the arithmetic is not merely approximate, it is inverted — a
// key this writer added a moment ago sits in `base` and is missing from the stale `theirs`, which reads
// exactly like *the other writer deleted it*, and the merge erases the rider's own star.
//
// The first version violated it because the read-modify-write below is **asynchronous** and `persist`
// starts one per mutation without awaiting the last. Two taps in one task both read the disk before
// either had written, while the ancestor advanced with each write — so the second merge compared a
// forward ancestor against a backward snapshot and dropped a favourite from memory *and* from disk. No
// second tab was needed: on the web build the machinery written to stop a rider losing a favourite was
// the thing losing it. (On a device the gate below short-circuits, so this never reached a phone.)
//
// Two rules keep the precondition true, and they are the whole of the fix:
//
//  1. **One write at a time.** Every read-merge-write goes through `serialised` below, so the disk read
//     for the next one happens after the last one has landed. This is the half that AsyncStorage's
//     asynchrony makes unavoidable — a critical section here cannot be bought by not deferring anything,
//     which is how `apps/web`'s twin gets the same property out of a synchronous `localStorage`.
//  2. **The ancestor moves only with a write, and only in `commit`.** It means "the last state this
//     writer put on disk", so the `theirs` read in the same critical section is always a snapshot taken
//     after it. `adoptRemotePreferences` therefore does *not* advance it: it applies the merge to memory,
//     and the write `persist` makes in response is what moves the ancestor, having re-read the disk.
//
// The state to merge is also **re-read when the turn comes** rather than taken from the snapshot
// `persist` handed over, for the same reason: while a write waited its turn the store may have adopted an
// earlier merge, and a snapshot from before that adoption is exactly the stale `mine` the precondition is
// about. The queue makes the writes ordered; re-reading makes each one current.

/**
 * The ancestor the merge is measured against: **the last state this writer wrote to disk.**
 *
 * Not "the last bytes seen on disk", which folds the other writer's unmerged change into the ancestor and
 * makes the merge read this writer's own key as somebody else's deletion. `persist` calls `setItem` on
 * every mutation, so the state before the current one is exactly what is wanted.
 *
 * Assigned in exactly two places — after the write in `commit`, and cleared in `removeItem` — plus once at
 * the end of hydration, where the blob just read *is* what is on disk.
 */
let ancestor: PersistedPreferences | null = null

/**
 * The write queue: one read-merge-write at a time, in the order the mutations happened.
 *
 * A promise chain rather than a lock, because there is nothing to wait on but the previous write and
 * nothing here may block. A failed job — a full disk, a rejected `AsyncStorage` write — must not wedge
 * every later write, so the chain continues from its settlement either way; the rider's next tap then
 * merges against an ancestor that never advanced, which is the safe direction.
 *
 * **That covers a rejection and not a hang** — see `bounded` below. A promise that never settles is not
 * a settlement, so the bound is what keeps a wedged storage layer from costing the whole session.
 */
let writes: Promise<unknown> = Promise.resolve()

/**
 * How long the chain will wait on one job before moving on.
 *
 * Not a retry and not an error path — purely a bound, so that a storage layer which never answers costs
 * the rider one write instead of every write for the rest of the session. Generous by an order of
 * magnitude against a `localStorage`-backed or SQLite-backed `AsyncStorage`.
 */
const WRITE_TIMEOUT_MS = 5_000

/**
 * Wait for `run` to settle, or for the bound, whichever comes first — and leave no timer behind either
 * way, so a settled write cannot hold a test process (or a device's event loop) open.
 */
function bounded(run: Promise<unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, WRITE_TIMEOUT_MS)
    const done = (): void => {
      clearTimeout(timer)
      resolve(undefined)
    }
    run.then(done, done)
  })
}

function serialised(job: () => Promise<void>): Promise<void> {
  // `then(job, job)` — the previous job's outcome is not this one's business, only its *completion* is.
  const run = writes.then(job, job)
  // **A rejection is a completion; a hang is not**, and `then` cannot tell them apart. The rejection case
  // is already safe — the chain continues, and `ancestor` never advanced because its assignment sits
  // after the `await`, so the next tap merges against a truthful base. But a promise that never settles
  // (a native call whose callback never fires, a wedged storage layer) would queue every later write
  // for the rest of the session with nothing reported anywhere. `bounded` is what stops that being
  // silent and permanent. Found by an adversarial review of the first fix (ADR-125).
  writes = bounded(run)
  return run
}

/**
 * The five persisted fields, read off the live store.
 *
 * Deliberately not `partialize` itself: `apps/web/test/shell-parity.test.ts` reads the field list out of
 * the *source* of both stores, straight from the destructuring in that option, so it has to stay an
 * inline literal or the guard standing between a rider and an erased list stops matching.
 */
function persistedNow(): PersistedPreferences {
  const { appearance, localeOverride, favoriteRoutes, recentRoutes, recentStops } =
    usePreferences.getState()
  return { appearance, localeOverride, favoriteRoutes, recentRoutes, recentStops }
}

/**
 * What is on disk right now, brought up to our schema version and filled out to the full shape.
 *
 * The migration runs here for the same reason `persist` runs it at load: the other writer may be an older
 * build, and merging its v0 place-keyed favourites in raw would put back the keys ADR-062 spent a work
 * package rebasing onto member poles. Anything unreadable is `null`, which the kernel rule reads as
 * "nobody to merge with" — the safe answer, since it leaves the rider's own state standing.
 */
async function readDisk(name: string): Promise<PersistedPreferences | null> {
  try {
    const raw = await AsyncStorage.getItem(name)
    if (raw === null) return null
    const envelope = JSON.parse(raw) as StorageValue<PersistedPreferences> | null
    const state = envelope?.state as Partial<PersistedPreferences> | undefined
    if (!state || typeof state !== 'object') return null
    const version = typeof envelope?.version === 'number' ? envelope.version : 0
    const migrated = migratePreferences(state, version) as Partial<PersistedPreferences>
    // **An absent saved-route list is unreadable, not empty.** `mergeSavedKeys` reads a key present in
    // `base` and missing from `theirs` as *the other writer deleted it* — which is correct, and is what
    // lets a rider with two tabs un-star anything at all. Defaulting a missing field to `[]` would turn
    // "this writer did not say" into "this writer says none" and delete the whole list. An unparseable
    // blob is already safe; a blob merely missing a field has to be too, or the more nearly-valid
    // corruption is the destructive one. Same guard as the `apps/web` twin, for the same reason.
    if (!Array.isArray(migrated.favoriteRoutes)) return null
    return {
      appearance: migrated.appearance ?? 'auto',
      localeOverride: migrated.localeOverride ?? null,
      favoriteRoutes: migrated.favoriteRoutes,
      recentRoutes: Array.isArray(migrated.recentRoutes) ? migrated.recentRoutes : [],
      recentStops: Array.isArray(migrated.recentStops) ? migrated.recentStops : [],
    }
  } catch {
    return null
  }
}

/**
 * One critical section: read the disk, merge, write, and bring memory up to the result.
 *
 * Only ever called through `serialised`, which is what makes "the disk, now" mean what it says. `mine` is
 * read here rather than passed in for the reason above — a queued write's snapshot can predate an adoption
 * that happened while it waited — and the ancestor advances only once the bytes are actually down.
 *
 * `merged !== mine` is `mergePreferences` reporting that the other writer had something this one did not;
 * the `setState` that answers it queues one more write behind this one, which finds nothing left to merge.
 */
async function commit(name: string, version: number | undefined): Promise<void> {
  const disk = sharedWithOtherWriters() ? await readDisk(name) : null
  const mine = persistedNow()
  const merged = mergePreferences<Appearance>(ancestor, mine, disk)
  // 🔴 **Memory adopts the merge BEFORE the await, and the ancestor advances after it.** They look like
  // one step and they answer to different clocks. `usePreferences.setState(merged)` is applying a result
  // computed from `mine` — so it must land while `mine` is still current, i.e. before any suspension
  // point. Putting it after the write reintroduced the very shape this queue exists to close, moved from
  // the queue to the trailing assignment: a mutation arriving during the write (any `async` handler that
  // awaits before mutating — a settled query continuation calling `pushRecentStop`, a star from an
  // awaited handler) updates the store, and then this stale `merged` overwrites it. Reproduced at
  // microtask depth 3 with no mocks. The ancestor, by contrast, means *the last state this writer put on
  // disk*, so it must not move until the bytes have. Found by an adversarial review (ADR-125).
  //
  // A mutation that lands during the write is then simply a later mutation, and its own queued job
  // merges it properly.
  if (merged !== mine) usePreferences.setState(merged)
  await AsyncStorage.setItem(name, JSON.stringify({ state: merged, version }))
  ancestor = merged
}

/**
 * `AsyncStorage`, plus the merge — the storage `persist` is given.
 *
 * A `PersistStorage` rather than `createJSONStorage(() => AsyncStorage)`, because the merge wants the
 * *parsed* state on the way past. The envelope written is byte-for-byte the one `createJSONStorage` wrote
 * — `{"state":…,"version":…}` — which matters twice over: it is what every blob already on a rider's
 * device looks like, and on web it is what `apps/web` reads.
 */
const mergingStorage: PersistStorage<PersistedPreferences> = {
  // **Deliberately unguarded, unlike the DOM twin, and the asymmetry is a safety property rather than an
  // oversight.** A read that throws or a blob that will not parse rejects here, `persist` abandons the
  // hydration, and `hydrated` therefore never flips — so `app/_layout.tsx` holds the splash screen and the
  // rider cannot write anything on top of data that is still on the device. Swallowing it would start the
  // app on the defaults and let the first preference change persist them over a list that was merely
  // unreadable this once. `apps/web` has no such gate (its storage is synchronous and cannot throw), so it
  // catches and repairs instead.
  getItem: async (name) => {
    const raw = await AsyncStorage.getItem(name)
    return raw === null ? null : (JSON.parse(raw) as StorageValue<PersistedPreferences>)
  },
  // The version is the only thing taken from `persist`'s snapshot: the *state* is re-read when the write's
  // turn comes (see `commit`), because by then it may have adopted a merge this snapshot predates.
  setItem: (name, value) => serialised(() => commit(name, value.version)),
  // On the queue too, so a write already waiting cannot land after the key was removed.
  removeItem: (name) =>
    serialised(async () => {
      await AsyncStorage.removeItem(name)
      ancestor = null
    }),
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
      storage: mergingStorage,
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
//
// The ancestor is set here rather than beside `create`, and the difference is the storage: AsyncStorage is
// asynchronous, so at `create` time the store still holds the defaults and an ancestor captured then would
// make the first write look as though this writer had chosen everything it merely inherited.
usePreferences.persist.onFinishHydration(() => {
  ancestor = persistedNow()
  usePreferences.setState({ hydrated: true })
})

/**
 * Merge whatever another writer just put on disk into this one. Web only — see above.
 *
 * A `null` disk (the key removed, or another page on the origin calling `localStorage.clear()`) is not
 * read as "the rider deleted everything": `mergePreferences` hands `mine` straight back, so this writer
 * keeps its list and re-creates the blob on its next write.
 *
 * **On the write queue, and deliberately not advancing the ancestor.** On the queue because it reads the
 * same disk the writes do and a read racing a write is the defect above; not advancing the ancestor
 * because nothing has been written here — the `setState` is what makes `persist` write, and that write
 * moves the ancestor after re-reading the disk itself. A merge that changed nothing writes nothing, which
 * is what lets two tabs go quiet after one round instead of writing at each other.
 */
export async function adoptRemotePreferences(): Promise<void> {
  await serialised(async () => {
    const disk = await readDisk(STORAGE_KEY)
    const mine = persistedNow()
    const merged = mergePreferences<Appearance>(ancestor, mine, disk)
    if (merged !== mine) usePreferences.setState(merged)
  })
}

if (sharedWithOtherWriters()) {
  window.addEventListener('storage', (event) => {
    // `key === null` is a `clear()`, which names no key and still concerns us. The `storageArea` check
    // keeps a `sessionStorage` write from waking this up. The value is re-read from storage rather than
    // taken from `event.newValue`, because the event is a signal that something moved and by the time it
    // is delivered the authoritative value may already be this writer's own later one.
    if (event.key !== null && event.key !== STORAGE_KEY) return
    if (event.storageArea != null && event.storageArea !== window.localStorage) return
    void adoptRemotePreferences()
  })
  // **The event that never arrived.** A page in the back/forward cache is frozen and `storage` events are
  // not queued for it, so a restored tab's memory is as old as the moment it was frozen and no listener can
  // have told it. Its next *write* recovers — that is what the read-modify-write is for — but until then it
  // is drawing preferences that changed hours ago. `pageshow` with `persisted` is that restore and nothing
  // else.
  window.addEventListener('pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted) void adoptRemotePreferences()
  })
}
