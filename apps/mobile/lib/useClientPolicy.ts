import { type ResolvedClientPolicy, resolveClientPolicy } from '@nextbus/core'
import { useQuery } from '@tanstack/react-query'
import { dataSource } from './datasource'

// The served `ClientPolicy` (ADR-053), resolved to six usable numbers for a screen to read.
//
// **Why react-query and not the `searchIndex.ts` shape next door.** That module hand-rolls a
// memo → AsyncStorage → network ladder because the index is megabytes and predates the persisted
// cache. The policy is six numbers, and the persisted query cache (ADR-058) already gives it exactly
// the behaviour we want for free: a cold *offline* start replays the last policy this device was
// served, and a cold first-ever start has nothing, which `resolveClientPolicy` turns into the shipped
// defaults. Re-implementing that ladder for a 100-byte document would be a second cache to keep
// correct.
//
// **This hook never suspends and never returns null.** A screen asking "how many rows?" must get a
// number on the first render or it has to invent one, and an invented number is the drift this whole
// work package exists to remove. So the policy is always resolved, and a screen cannot tell — and
// must not care — whether the value arrived from the edge or from the defaults. The one place that
// distinction is visible on purpose is `source` below, for the workbench readout.

/** Six-hour `staleTime`: the document changes at deploy speed, and its `max-age` is 5 minutes, so
 *  the HTTP layer is what makes a change land promptly. This only stops every screen mount from
 *  re-asking. */
const POLICY_STALE_MS = 6 * 60 * 60 * 1000

export interface ClientPolicyState {
  policy: ResolvedClientPolicy
  /**
   * Where the numbers came from. **Not for layout** — for the workbench readout and for anyone
   * debugging a threshold that looks wrong. A policy that silently never arrives is otherwise
   * invisible: the app keeps working on defaults, which is the point, and also the reason nobody
   * would notice the endpoint had been broken for a month.
   */
  source: 'served' | 'defaults'
}

export function useClientPolicy(): ClientPolicyState {
  const query = useQuery({
    queryKey: ['clientPolicy'],
    queryFn: () => dataSource.getClientPolicy(),
    staleTime: POLICY_STALE_MS,
    // A failed policy fetch is not an error state anybody should see: the defaults are a complete,
    // correct policy. Retry once and stop — the next screen mount past `staleTime` tries again.
    retry: 1,
  })

  return {
    policy: resolveClientPolicy(query.data),
    source: query.data ? 'served' : 'defaults',
  }
}
