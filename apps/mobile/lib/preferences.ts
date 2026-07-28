import { formatFavoriteRouteKey, type Locale, parseFavoriteRouteKey } from '@nextbus/core'
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
// stop. The keys are minted and read by the shared id grammar in `@nextbus/core`
// — ADR-059 — and their scheme is versioned, so it can change without losing a
// rider's list: ADR-062.)
/** Cap on the per-kind recent-search lists. */
const RECENTS_MAX = 8

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

// ── The persisted schema and its migration (ADR-062) ────────────────────────────────────────
// Everything in this section exists because of one asymmetry: the rest of the store can be got
// wrong and fixed in the next release, but a favourite is a thing a rider curated by hand, and
// dropping one is silent and unrecoverable. So the key scheme is *versioned* rather than merely
// changed, and the change is a numbered step that runs once and stamps the blob, not a fixup on
// every read — a read fixup never finishes, has to stay correct forever, and leaves no evidence
// that the scheme ever moved.

/** Exactly what `partialize` writes, and therefore exactly what `migrate` is handed back. */
type PersistedPreferences = Pick<
  Preferences,
  'appearance' | 'localeOverride' | 'favoriteRoutes' | 'recentRoutes' | 'recentStops'
>

/**
 * The persisted schema version. Bump it — and add a step to `migratePreferences` — when the
 * *meaning* of something already on disk changes. Adding a field is not that: zustand's `merge`
 * already falls back to the initial state for anything the blob does not carry.
 *
 * `0 → 1` — favourite keys are re-based from the `P:` place id onto the member pole id
 * (ADR-042/ADR-062).
 */
export const PREFERENCES_VERSION = 1

/**
 * v0 → v1: rewrite `P:<a>+<b>|<route>` into one key per member pole, preserving save order.
 *
 * **Every member, not a guess at one.** A place-keyed favourite recorded "this route, at this
 * merged place" and simply does not say which kerb the rider meant. Picking a member would be a
 * coin flip whose losing side is an invisibly missing favourite; expanding to all of them is
 * invisible in the other direction, because the Favourites tab intersects the saved keys with the
 * route-at-pole rows the place actually reports, so a key for a pole that does not serve the route
 * can never render. Over-expansion costs a string; guessing costs the favourite.
 *
 * **A key we cannot parse is kept exactly as it is** — not deleted, and not moved to a quarantine
 * list that would become a second place to forget about. Today's grammar is deliberately narrower
 * than tomorrow's (a fifth operator ships and `OPERATOR_RE` widens), the render path already skips
 * what it cannot parse, and a key that starts parsing again later simply starts working again.
 */
function rebaseFavoritesOntoPoles(entries: readonly unknown[]): string[] {
  const out: unknown[] = []
  const seen = new Set<unknown>()
  const keep = (entry: unknown) => {
    if (seen.has(entry)) return // a place expansion can land on a key that is already saved
    seen.add(entry)
    out.push(entry)
  }
  for (const entry of entries) {
    const parsed = typeof entry === 'string' ? parseFavoriteRouteKey(entry) : null
    if (parsed?.stop.kind === 'place') {
      for (const member of parsed.stop.members) {
        keep(formatFavoriteRouteKey(member.id, parsed.routeId))
      }
    } else keep(entry)
  }
  // `favoriteRoutes: string[]` is a claim about what *we* write. A hand-edited blob can hold
  // anything, and the rule above is to pass an entry we do not understand through untouched
  // rather than to drop it, so the cast records the gap instead of a `.filter()` closing it.
  return out as string[]
}

/**
 * The `persist` migration. Steps are applied in order and **must each be idempotent**, because a
 * blob from a *future* version — a rider who downgraded, or two tabs on different builds — is
 * passed through untouched and then re-stamped at *our* version, so the step that follows it can
 * meet data it has already been run against. (Untouched, rather than reset to defaults: a scheme
 * we cannot read renders as nothing, which is recoverable by upgrading again; discarding it is
 * not.)
 *
 * One trap worth naming: zustand only calls `migrate` when the stored `version` is a **number**,
 * so a blob with no version field at all is loaded verbatim and never reaches here. Every blob
 * this store has written carries `version: 0` (that is `persist`'s default), so there is nothing
 * on a real device that this misses — but a non-number is still treated as 0 below, because it
 * costs one comparison and the alternative failure is silent.
 */
export function migratePreferences(persisted: unknown, version: number): PersistedPreferences {
  // The one cast: below this line the blob is untrusted data, and above it zustand's `merge`
  // shallow-merges whatever we return over the defaults.
  const state = persisted as PersistedPreferences | null
  const from = Number.isFinite(version) ? version : 0
  if (from >= PREFERENCES_VERSION || !state) return state as PersistedPreferences
  if (!Array.isArray(state.favoriteRoutes)) return state
  return { ...state, favoriteRoutes: rebaseFavoritesOntoPoles(state.favoriteRoutes) }
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
      storage: createJSONStorage(() => AsyncStorage),
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
usePreferences.persist.onFinishHydration(() => usePreferences.setState({ hydrated: true }))
