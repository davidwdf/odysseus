import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { type ReactNode, useState } from 'react'

// The query cache is **persisted** (WP0-3), so a cold start — including a cold *offline*
// start — paints the last known arrivals instead of a spinner. AsyncStorage is
// localStorage on web and the native store on iOS/Android, so one persister covers both.
//
// This is a deliberate exception to ADR-008's "never fake precision", not a violation of it:
// a replayed reading arrives with its original `observedAt`, so the ETA helpers age it and the
// UI marks it stale. What we restore is a *labelled old reading*, never a fresh-looking one.
const PERSIST_KEY = 'nextbus.query.v1'

/** Drop the whole persisted cache when this moves — the escape hatch for a shape change. */
const CACHE_BUSTER = 'v1'

/** A day. Anything older is thrown away on load rather than shown as ancient history. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            // Must outlive `staleTime` by enough that a restored entry is still in the cache
            // when the screen mounts; the previous 60 s was tuned for an in-memory-only cache.
            gcTime: MAX_AGE_MS,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  const [persister] = useState(() =>
    createAsyncStoragePersister({ storage: AsyncStorage, key: PERSIST_KEY }),
  )

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: MAX_AGE_MS,
        buster: CACHE_BUSTER,
        dehydrateOptions: {
          // Persist successes only — a persisted error would replay a stale failure on the
          // next cold start, which reads as "the app is broken" rather than "we're offline".
          shouldDehydrateQuery: (q) => q.state.status === 'success',
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
