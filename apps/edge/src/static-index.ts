import { fetchConsolidatedIndex, type StaticIndex } from '@nextbus/data-normalize'

// Memoize the multi-operator (KMB + CTB) static index for the isolate's lifetime,
// shared by /v1/nearby, /v1/stop and /v1/route. Built from the consolidated dataset
// in one fetch (ADR-021). A future own-crawl would write the same shape to KV/R2.
let indexPromise: Promise<StaticIndex> | null = null

export function getStaticIndex(): Promise<StaticIndex> {
  if (!indexPromise) {
    // Don't cache a rejected build — a transient upstream failure would otherwise
    // poison the isolate until it recycles. Clear it so the next request retries.
    indexPromise = fetchConsolidatedIndex().catch((err) => {
      indexPromise = null
      throw err
    })
  }
  return indexPromise
}
