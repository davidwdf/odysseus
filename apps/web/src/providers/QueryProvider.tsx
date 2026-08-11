import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { type ReactNode, useState } from 'react'
import { safeLocalStorage } from '../adapters/storage'

/**
 * The query cache is **persisted** (ADR-058), so a cold start — including a cold *offline* start —
 * paints the last known arrivals instead of a spinner.
 *
 * This is a deliberate exception to ADR-008's "never fake precision", not a violation of it: a replayed
 * reading arrives with its original `observedAt`, so the ETA helpers age it and the UI marks it stale.
 * What we restore is a *labelled old reading*, never a fresh-looking one.
 *
 * ## The numbers are the RN provider's, and one test binds them
 *
 * `apps/mobile/providers/QueryProvider.tsx` is the reference implementation until WP6-8 (ADR-075
 * decision 6), and the four persisted-cache values below are ADR-058's, not this file's. They are
 * duplicated rather than hoisted because the honest home for them does not exist yet: `packages/core` is
 * hand-ported to Swift and Kotlin, and a TanStack storage key means nothing to either — a `ui-spec` that
 * has grown a `stopId` is ADR-075's own early warning, and this would be the same mistake pointed the
 * other way. So `test/shell-parity.test.ts` reads the RN provider's source and fails if any of them moves
 * in one app and not the other. The duplication is deleted, not resolved, when `apps/mobile` retires.
 *
 * `NETWORK_MODE` is a **fifth** value bound the same way and for the same reason, and it is kept out of
 * `PERSISTED_CACHE` because it is not part of that policy — see its own note below.
 *
 * The **persister key is the same** as the RN app's, deliberately, and it is safe where the *preferences*
 * key is not: both persisters write the same library-owned `PersistedClient` shape over identical query
 * keys (`['nearby', lat, lng]`, `['clientPolicy']`), so a rider whose Expo PWA is replaced by this build
 * on the same origin keeps their cache instead of cold-starting. See `lib/preferences.ts` for the case
 * where sharing a key would have destroyed data.
 */
const PERSIST_KEY = 'nextbus.query.v1'

/** Drop the whole persisted cache when this moves — the escape hatch for a shape change. */
const CACHE_BUSTER = 'v1'

/** A day. Anything older is thrown away on load rather than shown as ancient history. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Governs a remount refetch, and 15 s is coherent against a 30 s served cadence. */
const STALE_TIME_MS = 15_000

/**
 * **The fifth duplicated value**, declared here beside the four above and exported for the same reason.
 *
 * It is deliberately *not* a member of `PERSISTED_CACHE`: it is not part of ADR-058's persisted cache, and
 * folding it in would make that object a bag of "things two providers happen to share" rather than one
 * policy. The hazard is identical though — it is declared once here and once in
 * `apps/mobile/providers/QueryProvider.tsx`, and the two disagreeing means one renderer draws a false empty
 * state offline while the other draws an honest error. So it is bound the same way, by
 * `test/shell-parity.test.ts` reading the RN provider's source.
 *
 * A named constant rather than a literal in the options object is what makes that binding possible at all:
 * an exported value nothing reads is a claim, not a mechanism, and this one spent a round as exactly that.
 */
export const NETWORK_MODE = 'always' as const

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: STALE_TIME_MS,
            // Must outlive `staleTime` by enough that a restored entry is still in the cache when the
            // screen mounts. This is what the in-memory-only default gets wrong: a 5-minute `gcTime`
            // evicts the restored entry before a slow cold start reaches the screen that wanted it.
            gcTime: MAX_AGE_MS,
            retry: 1,
            refetchOnWindowFocus: false,
            // **A request we cannot make must FAIL, not vanish.** TanStack's default `networkMode:
            // 'online'` refuses to run a query while `onlineManager` believes the device is offline: the
            // query sits at `status: 'pending'`, `fetchStatus: 'paused'`, `fetchFailureCount: 0` — for as
            // long as the rider stays offline, with no error, no data and no attempt on record. Every
            // screen here reads that as *"the fetch is not loading and did not fail"* and draws its empty
            // branch, which is how an offline Nearby claimed "No scheduled service": the ADR-073
            // conflation, reintroduced by a library default rather than by our code. Worse, the state is
            // unrecoverable — `refetchInterval` fires only on `status === 'error'` (ADR-079), which a
            // paused query never reaches.
            //
            // `'always'` is the honest setting *for this app* for three separate reasons, not one:
            //  · There is a **service worker** (ADR-058/082). A request made while `navigator.onLine` is
            //    false can still be answered from the Workbox cache — pausing means we never even ask it.
            //  · `navigator.onLine` is a claim about a link, not about reachability. It is `true` behind a
            //    captive portal and `false` on some VPN and desktop stacks, so gating on it trades a
            //    real answer for a guess.
            //  · A failure the rider can see is worth more than a silence they cannot. Offline now lands
            //    on `error`, which is the state ADR-079 built automatic recovery for.
            //
            // What this does **not** change is the focus gate: `retryer.canContinue()` also requires
            // `focusManager.isFocused()`, so a *retry* is still parked while the document is hidden and
            // resumes on `visibilitychange`. That is deliberate library behaviour and it is fine — but it
            // is a second way a query can sit `pending` with nothing to show, which is why the screens
            // branch on `isPending` (status) and never on `isLoading` (`isPending && isFetching`).
            networkMode: NETWORK_MODE,
          },
        },
      }),
  )

  const [persister] = useState(() =>
    createSyncStoragePersister({ storage: safeLocalStorage, key: PERSIST_KEY }),
  )

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: MAX_AGE_MS,
        buster: CACHE_BUSTER,
        dehydrateOptions: {
          // Persist successes only — a persisted error would replay a stale failure on the next cold
          // start, which reads as "the app is broken" rather than "we're offline".
          shouldDehydrateQuery: (q) => q.state.status === 'success',
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}

/** The persisted-cache policy, exported for `test/shell-parity.test.ts` to bind to the RN provider's. */
export const PERSISTED_CACHE = {
  key: PERSIST_KEY,
  buster: CACHE_BUSTER,
  maxAgeMs: MAX_AGE_MS,
  staleTimeMs: STALE_TIME_MS,
} as const
