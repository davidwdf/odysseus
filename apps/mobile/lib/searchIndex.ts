import type { SearchIndex } from '@nextbus/core'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useState } from 'react'
import { dataSource } from './datasource'

// On-device search index (ADR-037, the first step of ADR-007). Load order is
// stale-while-revalidate so search/keypad work instantly and offline:
//   module memo (this session) → AsyncStorage (a prior session, offline) → network.
// The network copy replaces the cache whenever the edge's `version` moves.
const CACHE_KEY = 'nextbus.searchIndex.v1'

let memo: SearchIndex | null = null
let inflight: Promise<SearchIndex> | null = null

export interface SearchIndexState {
  index: SearchIndex | null
  /** True only on a cold start with nothing cached yet. */
  loading: boolean
  error: Error | null
}

async function loadFromCache(): Promise<SearchIndex | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as SearchIndex) : null
  } catch {
    return null
  }
}

function fetchAndCache(): Promise<SearchIndex> {
  if (!inflight) {
    inflight = dataSource
      .getSearchIndex()
      .then((idx) => {
        memo = idx
        void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(idx)).catch(() => {})
        return idx
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function useSearchIndex(): SearchIndexState {
  const [index, setIndex] = useState<SearchIndex | null>(memo)
  const [loading, setLoading] = useState(memo === null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (memo) return // already loaded this session — it's the fresh network copy
    let active = true
    void (async () => {
      const cached = await loadFromCache()
      if (active && cached) {
        setIndex(cached)
        setLoading(false)
      }
      try {
        const fresh = await fetchAndCache()
        if (!active) return
        setIndex(fresh)
        setLoading(false)
        setError(null)
      } catch (e) {
        // Network failed: keep the cache if we have one, else surface the error.
        if (active && !cached) {
          setError(e as Error)
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  return { index, loading, error }
}
