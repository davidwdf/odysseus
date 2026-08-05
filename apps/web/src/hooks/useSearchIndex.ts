import type { SearchIndex } from '@nextbus/core'
import { useEffect, useRef, useState } from 'react'
import { dataSource } from '../adapters/datasource'
import { safeLocalStorage } from '../adapters/storage'

/**
 * The on-device search index (ADR-037, the first step of ADR-007) — the twin of
 * `apps/mobile/lib/searchIndex.ts`, deliberately hand-copied.
 *
 * The rule is shared and the wiring is not (ADR-068/069): `searchView`, `searchRoutes`, `nextValidChars` and
 * the rest live in `@nextbus/core` and are called identically by both renderers, while the load order and the
 * cache are per platform — the same split every hook in this directory has.
 *
 * **The load order is stale-while-revalidate, and that is what makes search work offline:** a module memo for
 * this session, then whatever a previous session left in storage, then the network. The cached copy is
 * replaced whenever the edge's version moves. A cold start with nothing cached is the only `loading` there
 * is, and a network failure with a cache in hand is **not** an error — it is yesterday's index, which for
 * searching a route number is very nearly as good.
 *
 * Two things differ from the RN twin, and both are the storage rather than the intent. `safeLocalStorage` is
 * **synchronous**, so the cache read cannot be awaited into a second render — it happens before the first.
 * And the same adapter is what the preferences store writes through, so a browser with storage denied
 * (private mode, a locked-down profile) degrades to network-only here instead of throwing, which is the whole
 * reason that adapter exists.
 */
const CACHE_KEY = 'nextbus.searchIndex.v1'

let memo: SearchIndex | null = null
let inflight: Promise<SearchIndex> | null = null

export interface SearchIndexState {
  index: SearchIndex | null
  /** True only on a cold start with nothing cached yet. */
  loading: boolean
  error: Error | null
}

function fromCache(): SearchIndex | null {
  try {
    const raw = safeLocalStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as SearchIndex) : null
  } catch {
    // A truncated or hand-edited blob is the same as no blob: the network copy is one request away, and
    // throwing here would take the whole screen down over a cache.
    return null
  }
}

function fetchAndCache(): Promise<SearchIndex> {
  if (!inflight) {
    inflight = dataSource
      .getSearchIndex()
      .then((index) => {
        memo = index
        try {
          safeLocalStorage.setItem(CACHE_KEY, JSON.stringify(index))
        } catch {
          // Storage full or denied. The index is in `memo` for this session either way.
        }
        return index
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function useSearchIndex(): SearchIndexState {
  // The cache is read **before the first render**, not in an effect: `safeLocalStorage` is synchronous, so
  // there is no window in which the screen has to show a spinner over an index it already has.
  const [index, setIndex] = useState<SearchIndex | null>(() => memo ?? fromCache())
  const [loading, setLoading] = useState(() => (memo ?? fromCache()) === null)
  const [error, setError] = useState<Error | null>(null)
  // **Whether we started with something to search**, captured once. A network failure is only fatal when it
  // is, and reading `index` in the effect below instead would put it in the dependency array — which re-runs
  // the effect the moment the index arrives, i.e. on success. A ref is the honest shape for "a fact about
  // this mount", and it keeps the effect's dependencies genuinely empty.
  const hadSomethingToSearch = useRef(index !== null)

  useEffect(() => {
    if (memo) return // already the fresh network copy this session
    let active = true
    fetchAndCache()
      .then((fresh) => {
        if (!active) return
        setIndex(fresh)
        setLoading(false)
        setError(null)
      })
      .catch((e: unknown) => {
        // Network failed. Keep the cache if there is one — yesterday's index still searches — and surface
        // the error only when there is nothing at all to search.
        if (active && !hadSomethingToSearch.current) {
          setError(e as Error)
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [])

  return { index, loading, error }
}
