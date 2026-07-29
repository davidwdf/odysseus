// Per-upstream-call coalescing cache for live ETA fetches (WP0-4).
//
// Why this exists: `/v1/nearby` fans out to every member pole of every nearby place, and
// `/v1/stop` does the same for one place. Without coalescing, N concurrent requests for the
// same coordinate each issue their own upstream calls — and the edge cache in `index.ts`
// can't help, because it only starts caching once a response has been produced. This map
// makes the *in-flight* call the unit of sharing: the second caller for a pole awaits the
// first caller's promise instead of opening a second connection (the fan-out is throttled by
// a 6-simultaneous-connection ceiling, so a duplicate call is not free — it displaces a real one).
//
// TTL is 30 s, not the previous 8 s (ADR-057). Upstream refreshes roughly once a minute
// (docs/01, ADR-008), so at 8 s the hit rate is ~0%: misses/second cap at
// `hot_keys ÷ TTL` and the cache never binds. 30 s halves the upstream call rate without
// ever showing an arrival that upstream itself would have called fresh. Staleness is still
// surfaced to the rider from the reading's own `observedAt` (ADR-008), so a cached value is
// labelled honestly rather than presented as new.

import { CLIENT_POLICY_DEFAULTS } from '@nextbus/core'

/**
 * Shared TTL for live ETA data — the coalescer window, the edge `max-age`, **and** the cadence the
 * client is told to poll at.
 *
 * Derived from `ClientPolicy.refreshAfterMs` rather than restating 30, because the two numbers were
 * never independent and writing them down separately is how they came to disagree: the app polled
 * every 20 s against this 30 s window, so one request in three could only ever return the
 * byte-identical cached response. Deriving it means the coupling is visible at the definition, and
 * changing the cadence cannot silently leave the cache behind (ADR-053, ADR-057).
 */
export const ETA_TTL_SEC = CLIENT_POLICY_DEFAULTS.refreshAfterMs / 1000
const TTL_MS = ETA_TTL_SEC * 1000

// Bound the map so a long-lived isolate can't accumulate every pole in Hong Kong. Entries are
// tiny (one promise + a timestamp), so this is generous; the sweep runs only when breached.
const MAX_ENTRIES = 2_000

interface Entry<T> {
  /** Wall-clock ms when the call started. */
  at: number
  value: Promise<T>
}

const entries = new Map<string, Entry<unknown>>()

/** Drop everything past its TTL; if that isn't enough, drop oldest-first. */
function sweep(now: number): void {
  for (const [key, e] of entries) {
    if (now - e.at >= TTL_MS) entries.delete(key)
  }
  if (entries.size <= MAX_ENTRIES) return
  const oldestFirst = [...entries].sort((a, b) => a[1].at - b[1].at)
  for (const [key] of oldestFirst.slice(0, entries.size - MAX_ENTRIES)) entries.delete(key)
}

/**
 * Run `produce()` at most once per `key` per TTL for this isolate, sharing the in-flight
 * promise with every concurrent caller.
 *
 * A rejection is **not** cached: the entry is evicted so the next caller retries, and this
 * call resolves to `fallback` (upstream ETA failures degrade a card, they don't error a
 * screen). Resolved values are shared by reference across callers, so **treat the result as
 * immutable** — every consumer here maps into fresh objects rather than mutating in place.
 */
export function coalesce<T>(key: string, produce: () => Promise<T>, fallback: T): Promise<T> {
  const now = Date.now()
  const hit = entries.get(key)
  if (hit && now - hit.at < TTL_MS) return hit.value as Promise<T>

  const value = produce().catch((err) => {
    if (entries.get(key)?.value === value) entries.delete(key)
    console.warn(`[eta] ${key} failed: ${(err as Error).message}`)
    return fallback
  })
  entries.set(key, { at: now, value })
  if (entries.size > MAX_ENTRIES) sweep(now)
  return value
}

/** Test seam — drops every cached call so a spec starts from a cold isolate. */
export function resetEtaCache(): void {
  entries.clear()
}
