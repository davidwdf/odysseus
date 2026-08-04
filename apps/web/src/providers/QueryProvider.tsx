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
 * decision 6), and the four values below are ADR-058's, not this file's. They are duplicated rather
 * than hoisted because the honest home for them does not exist yet: `packages/core` is hand-ported to
 * Swift and Kotlin, and a TanStack storage key means nothing to either — a `ui-spec` that has grown a
 * `stopId` is ADR-075's own early warning, and this would be the same mistake pointed the other way.
 * So `test/shell-parity.test.ts` reads the RN provider's source and fails if any of the four moves in
 * one app and not the other. The duplication is deleted, not resolved, when `apps/mobile` retires.
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
