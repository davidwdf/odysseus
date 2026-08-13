import {
  bumpRecent,
  FAVOURITE_KEY_VERSION,
  formatFavoriteRouteKey,
  type Locale,
  mergePreferences,
  migrateFavouriteKeys,
} from '@nextbus/core'
import type { Appearance } from '@nextbus/ui'
import { create } from 'zustand'
import { type PersistStorage, persist, type StorageValue } from 'zustand/middleware'
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

// ── Two tabs, one blob (WP6-8a) ────────────────────────────────────────────────────────────────
//
// Everything above is about one writer. There is never only one: `nextbus.preferences` is a single
// `localStorage` key on a single origin, and a second tab of this app, the Expo PWA on the same origin
// (ADR-082 decision 5) and a tab restored from the back/forward cache are all second writers. `persist`
// writes `partialize`'s output as the **whole** blob and reads it once, at load — so a second tab held a
// stale copy from the moment it opened, and the next thing it wrote *deleted* everything the first tab
// had done since. Open `/settings` twice, change the language in one, star a route in the other, reload
// the first: the language is back. That was live until this section existed.
//
// The rule is the kernel's (`mergePreferences`, corpus-pinned) because two writers of one blob must not
// resolve a conflict differently. What is here is the wiring, and it is two halves:
//
//  1. **Every write is a read-modify-write.** `setItem` re-reads what is on disk *now* and merges before
//     it writes. This is the half that actually prevents the data loss, and it is the only half that
//     covers a writer which was not listening — a frozen bfcached tab gets no `storage` events at all,
//     and it is the one whose in-memory copy is hours stale.
//  2. **A `storage` listener merges the other writer's change into memory**, so the language and the
//     appearance change in *this* tab as they are chosen in the other, rather than at the next reload.
//     It re-reads `localStorage` rather than trusting `event.newValue`, which matters: the event is a
//     signal that something moved, and by the time it is delivered the authoritative value may already
//     be this tab's own later write.
//
// The listener never writes. It sets state only when the merge actually changed something (which
// `mergePreferences` reports by returning `mine` by identity), and that state change goes through
// `setItem` above, which writes only what the merge produced. Two tabs therefore settle after one round
// instead of handing a blob back and forth.
//
// ── THE PRECONDITION THE FIRST VERSION OF THIS BROKE (WP6-8b) ─────────────────────────────────
//
// A three-way merge is only as good as its ancestor, and `base` has a precondition that is about *time*
// rather than about types: **the `theirs` it is compared against must be a snapshot of the blob taken
// after `base` was written.** Violate it and the arithmetic is not merely approximate, it is inverted —
// a key this tab added a moment ago sits in `base` and is missing from the stale `theirs`, which reads
// exactly like *the other writer deleted it*, and the merge dutifully erases the rider's own star.
//
// The first version violated it in one place: `setItem` advanced the ancestor synchronously and handed
// the merged state back to memory in a **microtask**, so a second mutation in the same task merged a
// `mine` that had not adopted the first merge against an ancestor that already had. Two stars in one
// frame, with anything unseen on disk, and one of them was gone from memory and from disk — the
// machinery written to stop a rider losing a favourite, losing one, with no second tab involved.
//
// Two rules keep the precondition true, and they are the whole of the fix:
//
//  1. **The ancestor moves only with a write, and only in `setItem`.** It means "the last state this tab
//     put on disk", so `theirs` — read at the top of that same function — is always a snapshot taken
//     after it. The listener therefore does *not* advance it: it applies the merge to memory, and the
//     write `persist` makes in response is what moves the ancestor, having re-read the disk itself.
//  2. **The catch-up is synchronous.** Storage here is `localStorage`, so the read, the merge, the write
//     and the adoption all fit in one task with nothing able to observe a half-applied state between
//     them. Re-entering `setItem` from that `setState` is safe and bounded: the nested merge finds
//     `mine`, `base` and `theirs` all equal, returns `mine` by identity, and stops.
//
// `apps/mobile`'s twin needs a promise queue for the same property, because AsyncStorage is asynchronous
// and a critical section there cannot be bought by simply not deferring anything. That divergence is the
// storage's, like the two this file already carries (`getItem`'s guard, and having no `hydrated` flag).

/**
 * The ancestor the merge is measured against: **the last state this tab wrote to disk.**
 *
 * Not "the last bytes seen on disk" — that was the first design and it is wrong in the racing case,
 * because it folds the *other* tab's unmerged change into the ancestor and the merge then reads this
 * tab's own key as somebody else's deletion. What tells a deletion from an addition is knowing what
 * *this* writer changed, and `persist` calls `setItem` on every mutation, so the state before the current
 * one is exactly that.
 *
 * Assigned in exactly two places — beside the write in `setItem`, and cleared in `removeItem` — because
 * an ancestor that has advanced past what is actually on disk is the defect described above.
 */
let ancestor: PersistedPreferences | null = null

/**
 * The five persisted fields, read off the live store.
 *
 * Deliberately not `partialize` itself: `test/shell-parity.test.ts` reads the field list out of the
 * *source* of both stores, straight from the destructuring in that option, so it has to stay an inline
 * literal or the guard standing between a rider and an erased list stops matching.
 */
function persistedNow(): PersistedPreferences {
  const { appearance, localeOverride, favoriteRoutes, recentRoutes, recentStops } =
    usePreferences.getState()
  return { appearance, localeOverride, favoriteRoutes, recentRoutes, recentStops }
}

/**
 * What is on disk right now, brought up to our schema version and filled out to the full shape.
 *
 * The migration is run here for the same reason `persist` runs it at load: the other writer may be an
 * older build, and merging its v0 place-keyed favourites in raw would put keys back that ADR-062 spent a
 * work package rebasing. Anything unreadable — absent, truncated, hand-edited — is `null`, which the
 * kernel rule reads as "nobody to merge with" and which therefore costs the rider nothing.
 */
/**
 * Where an unparseable `nextbus.preferences` blob is copied before anything writes over it (ADR-149)
 * — the same key, spelling and rule as the Expo store's (ADR-143). Written only by the two catch
 * arms below; never read by the app.
 */
export const PREFERENCES_QUARANTINE_KEY = 'nextbus.preferences.quarantine'

function readDisk(): PersistedPreferences | null {
  const raw = safeLocalStorage.getItem(STORAGE_KEY)
  if (raw === null) return null
  try {
    const envelope = JSON.parse(raw) as StorageValue<PersistedPreferences> | null
    const state = envelope?.state as Partial<PersistedPreferences> | undefined
    if (!state || typeof state !== 'object') return null
    const version = typeof envelope?.version === 'number' ? envelope.version : 0
    const migrated = migratePreferences(state, version) as Partial<PersistedPreferences>
    // **An absent saved-route list is unreadable, not empty**, and the distinction is the difference
    // between robustness and data loss. `mergeSavedKeys` reads a key present in `base` and missing from
    // `theirs` as *the other writer deleted it* — correct arithmetic, and the reason a rider with two
    // tabs can still un-star anything. So defaulting a missing field to `[]` would turn "this writer did
    // not say" into "this writer says none" and delete the rider's whole list. An *unparseable* blob is
    // already safe (`null` reads as "nobody to merge with"); a blob that is merely missing a field must
    // be too, or the more nearly-valid corruption is the destructive one. No shipped writer produces
    // such a blob — both stores model all five fields — so this is a guard, not a live path.
    if (!Array.isArray(migrated.favoriteRoutes)) return null
    return {
      appearance: migrated.appearance ?? 'auto',
      localeOverride: migrated.localeOverride ?? null,
      favoriteRoutes: migrated.favoriteRoutes,
      recentRoutes: Array.isArray(migrated.recentRoutes) ? migrated.recentRoutes : [],
      recentStops: Array.isArray(migrated.recentStops) ? migrated.recentStops : [],
    }
  } catch {
    // Bytes we hold but cannot read are preserved before the caller writes over them (ADR-149): this
    // is the mid-session path `setItem` reads, and its merge — with nobody, since the blob is
    // unreadable — is about to replace the blob with this tab's own state.
    safeLocalStorage.setItem(PREFERENCES_QUARANTINE_KEY, raw)
    return null
  }
}

/**
 * `safeLocalStorage`, plus the merge — the storage `persist` is given.
 *
 * A `PersistStorage` rather than `createJSONStorage(() => safeLocalStorage)`, because the merge needs the
 * *parsed* state on the way past and JSON-ing it twice per write to get at it would be silly. The
 * envelope written is byte-for-byte the one `createJSONStorage` wrote — `{"state":…,"version":…}` — which
 * matters, since the Expo PWA reads this same key.
 */
const mergingStorage: PersistStorage<PersistedPreferences> = {
  getItem: (name) => {
    const raw = safeLocalStorage.getItem(name)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as StorageValue<PersistedPreferences>
    } catch {
      // A corrupt blob hydrates as the defaults, exactly as `createJSONStorage` behaved — but the
      // bytes are quarantined first (ADR-149). This comment used to say "the next write merges over
      // whatever is still there", and that was the defect: the next write's own read of the blob
      // fails the same way, so it merges with nobody and *replaces* what is still there.
      safeLocalStorage.setItem(PREFERENCES_QUARANTINE_KEY, raw)
      return null
    }
  },
  setItem: (name, value) => {
    const mine = value.state
    const merged = mergePreferences<Appearance>(ancestor, mine, readDisk())
    // Read, merge, write, adopt — one task, no suspension point, which is what keeps `theirs` above a
    // snapshot taken after `ancestor` was written. The ancestor moves **with the bytes**, here and
    // nowhere else, so that it always names something the disk actually holds.
    const landed = safeLocalStorage.setItem(
      name,
      JSON.stringify({ state: merged, version: value.version }),
    )
    // 🔴 **Both of the next two lines are conditional on the write, and that is the whole point.**
    // `safeLocalStorage` swallows a `QuotaExceededError` — Safari private browsing, or simply a full
    // origin, which is reachable here because the TanStack query cache persists to the same origin
    // through the same wrapper (ADR-058). Advancing the ancestor after a refused write leaves it naming
    // bytes the disk never took, and the *next* merge then reads this tab's own additions as the other
    // writer's deletions and erases them — no second tab required. Before the merge existed a refused
    // write only meant "not persisted"; with it, an unconditional `ancestor = merged` turns a full disk
    // into silent favourite loss. Found by an adversarial review of the first fix (ADR-125).
    if (!landed) return
    ancestor = merged
    // The merge found something on disk this tab did not have, so memory has to catch up — **now**, not
    // in a microtask. Deferring it was the first fix's defect: the next mutation in the same task would
    // merge a `mine` that had not adopted this result against an ancestor that had, and lose a star to
    // it. This re-enters `setItem` once; the nested call finds `mine`, `ancestor` and `theirs` in
    // agreement, so `mergePreferences` returns `mine` by identity and the recursion stops there.
    if (merged !== mine) usePreferences.setState(merged)
  },
  removeItem: (name) => {
    ancestor = null
    safeLocalStorage.removeItem(name)
  },
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

// Hydration is synchronous here (see above), so by this line the store holds whatever was on disk — which
// is precisely the ancestor the first write should be measured against.
ancestor = persistedNow()

/**
 * Merge whatever another writer just put on disk into this tab.
 *
 * `null` from `readDisk()` — the key was removed, or another app called `localStorage.clear()` — is not
 * treated as "the rider deleted everything". `mergePreferences` returns `mine` untouched, so this tab
 * keeps what it has and re-creates the blob on its next write. Losing a curated list to somebody else's
 * `clear()` is the same data loss this whole section exists to stop, arriving from the other direction.
 *
 * **It does not touch the ancestor**, which is rule 1 above rather than an omission: nothing has been
 * written at this point, so an ancestor advanced here would claim a state the disk does not hold — and the
 * next merge would read the difference as the other tab having deleted a key. The `setState` below is what
 * makes `persist` write, and that write re-reads the disk and moves the ancestor itself. A merge that
 * changed nothing writes nothing, which is what lets two open tabs go quiet.
 */
export function adoptRemotePreferences(): void {
  const mine = persistedNow()
  const merged = mergePreferences<Appearance>(ancestor, mine, readDisk())
  if (merged !== mine) usePreferences.setState(merged)
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    // `key === null` is a `clear()`, which names no key and still concerns us. The `storageArea` check
    // keeps a `sessionStorage` write (`useScrollRestoration`'s) from waking this up.
    if (event.key !== null && event.key !== STORAGE_KEY) return
    if (event.storageArea != null && event.storageArea !== window.localStorage) return
    adoptRemotePreferences()
  })
  // **The event that never arrived.** A page in the back/forward cache is frozen, and `storage` events are
  // not queued for it — so a restored tab's memory is as old as the moment it was frozen and no listener
  // can have told it. Its next *write* recovers (that is what the read-modify-write above is for), but
  // until then it is drawing preferences that changed hours ago. `pageshow` with `persisted` is exactly
  // that restore and nothing else, which is why it is the hook rather than `visibilitychange`.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) adoptRemotePreferences()
  })
}

/** Exported for `test/shell-parity.test.ts`, which asserts the two stores now write the *same* key. */
export const PREFERENCES_STORAGE_KEY = STORAGE_KEY
