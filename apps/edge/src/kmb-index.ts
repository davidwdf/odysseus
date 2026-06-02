import { fetchKmbStatic, type KmbStaticIndex } from '@nextbus/data-normalize'

// Memoize the KMB static index for the isolate's lifetime, shared by /v1/nearby,
// /v1/stop and /v1/route. Production swaps this for the daily-crawl output served
// from KV/R2 (docs/03 "daily crawl"); the seam stays the same.
let indexPromise: Promise<KmbStaticIndex> | null = null

export function getKmbIndex(): Promise<KmbStaticIndex> {
  if (!indexPromise) {
    // Don't cache a rejected build — a transient upstream failure would otherwise
    // poison the isolate until it recycles. Clear it so the next request retries.
    indexPromise = fetchKmbStatic().catch((err) => {
      indexPromise = null
      throw err
    })
  }
  return indexPromise
}
