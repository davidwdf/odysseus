import { useRef } from 'react'

/**
 * Keep the **previous** value whenever a new one is equal to it by content.
 *
 * ## The bug this exists for
 *
 * TanStack Query hands back a new object on every refetch. Structural sharing preserves subtrees that
 * did not change, but a route's `stops` array carries each row's `eta` — so a 30-second arrivals
 * refresh produces a new `stops` array on every tick, even though not one coordinate moved.
 *
 * Anything derived from it inherits that churn, and on Route detail the chain ran four deep: the stop
 * coordinates, the path presentation, the drawn line, its bounds — and then `fitBounds`, whose effect
 * saw a "new" box and **re-framed the map every thirty seconds**, throwing away wherever the rider had
 * panned to. Measured before it was fixed: pan away, and 31 seconds later the camera is back on the
 * route. The markers were torn down and rebuilt on the same beat.
 *
 * ## Why by content rather than a signature
 *
 * A hand-written key — stop ids joined, say — is one more thing to keep in step with the value it
 * claims to summarise, and it fails silently in exactly the case nobody tests: a dataset rebuild that
 * moves a stop without changing its id would leave the marker at the old coordinate for ever. Comparing
 * what is actually there cannot drift from what is actually there.
 *
 * `JSON.stringify` rather than a deep-equal walk because the values here are small plain data — a few
 * dozen `{ lat, lng, name }` — and it is one line with no edge cases of its own. It would be the wrong
 * tool for anything holding a `Date`, a `Map`, a function or a cycle; nothing here does, and a caller
 * that needs one should not reach for this.
 */
export function useStableValue<T>(value: T): T {
  const held = useRef<{ key: string; value: T } | null>(null)
  const key = JSON.stringify(value)
  if (held.current === null || held.current.key !== key) held.current = { key, value }
  return held.current.value
}
