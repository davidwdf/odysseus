import type { OperatorId } from '@nextbus/core'
import { EMPTY_FILTER, type RouteFilter } from '@nextbus/core'

/**
 * The Search screen's filter, as URL parameters — the web's answer to a piece of state the RN stack keeps
 * for free.
 *
 * ## Why this is `lib/` and not the screen
 *
 * A URL codec is plumbing, not a decision about what a rider sees: `lib/` is where `preferences.ts`,
 * `appearance.ts` and `serviceWorker.ts` live for the same reason. It is worth saying out loud because
 * `lib/` is also outside `check-no-derivation`'s `POLICED` list, and moving code there **to dodge a gate**
 * would be exactly the failure this repo keeps writing ADRs about. The test is whether the code would still
 * belong here if the gate did not exist, and it would — a screen should no more own its query-string
 * grammar than it owns its storage key.
 *
 * ## Two parameters, not one, and no knowledge of the kernel's chip keys
 *
 * `ops=KMB,CTB` and `cats=night`. The kernel mints and reads chip *keys* with prefixes it owns
 * (`toggleSearchChip`, ADR-091) and nothing here knows that format — this encodes the filter's own two
 * fields, so a change to the chip-key grammar cannot break a rider's bookmark and vice versa.
 *
 * An unrecognised value is passed through rather than dropped: `searchView` decides which chips exist from
 * the index, so a hand-edited URL naming an operator this build has never heard of narrows the list to
 * nothing, which is the honest outcome. Silently deleting it would show a rider unfiltered results under a
 * URL that says otherwise.
 */
export function parseFilter(ops: string | null, cats: string | null): RouteFilter {
  if (ops === null && cats === null) return EMPTY_FILTER
  return {
    operators: splitList(ops) as OperatorId[],
    categories: splitList(cats) as RouteFilter['categories'],
  }
}

export function formatFilter(filter: RouteFilter): { ops: string; cats: string } {
  return { ops: filter.operators.join(','), cats: filter.categories.join(',') }
}

/** `"a,b"` → `["a","b"]`; `null` and `""` → `[]`. Empties dropped so a trailing comma cannot mint one. */
function splitList(value: string | null): string[] {
  const out: string[] = []
  for (const part of (value ?? '').split(',')) {
    const trimmed = part.trim()
    if (trimmed !== '') out.push(trimmed)
  }
  return out
}
